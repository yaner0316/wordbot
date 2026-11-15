-- Prepared locally. Apply only as part of the coordinated backend/frontend release.
-- Add the band without rewriting existing users, answers or cache rows.
alter type public.wordbot_level add value if not exists '小学低年级';

begin;
create or replace function public.is_current_question_policy(v jsonb)
returns boolean language sql immutable security invoker set search_path=pg_catalog
as $$
 select coalesce(
  'context-learning-v3'=any(string_to_array(v->>'source_version','|'))
  and 'unique-answer-v3'=any(string_to_array(v->>'source_version','|'))
  and v->'teaching_analysis'->>'policy'='context-learning-v3'
  and v->'teaching_analysis'->>'auditMethod'='blind-completion-v6'
  and v->'teaching_analysis'->'stemReview'->>'policy'='context-learning-v3'
  and v->'teaching_analysis'->'stemReview'->>'approved'='true'
  and v->'teaching_analysis'->>'senseVerified'='true'
  and v->'teaching_analysis'->'contentReview'->>'policy'='question-content-v3'
  and v->'teaching_analysis'->'contentReview'->'translation'->>'accurate'='true'
  and public.is_valid_teaching_analysis(v->'teaching_analysis',v->>'question_text',v->'options',v->>'answer'),false);
$$;
revoke all on function public.is_current_question_policy(jsonb) from public,anon,authenticated;
grant execute on function public.is_current_question_policy(jsonb) to service_role;

-- Extend installed RPCs, preserving current leases, archive fences and ACLs.
do $$
declare signature text; def text; marker text;
begin
 foreach signature in array array[
  'public.publish_question_generation_variants(uuid,text,bigint,uuid,jsonb)',
  'public.publish_question_generation_practice_variant(uuid,text,bigint,uuid,jsonb)'
 ] loop
  select pg_get_functiondef(signature::regprocedure) into def;
  def:=replace(def,chr(13),'');
  if position('QUESTION_POLICY_RETIRED' in def)=0 then
   marker := '    select' || chr(10) || '        count(distinct nullif(btrim(variant->>''question_fingerprint''), '''')),';
   if position(marker in def)=0 then raise exception 'POLICY_PUBLISHER_LAYOUT_UNEXPECTED: %',signature; end if;
   def:=replace(def,marker,
    '    if exists(select 1 from jsonb_array_elements(p_variants) as x(value) where not public.is_current_question_policy(value)) then raise exception ''QUESTION_POLICY_RETIRED''; end if;' || chr(10) || marker);
   def:=replace(def,'''unique-answer-v2''','''unique-answer-v3''');
   def:=replace(def,'and existing.cache_state = ''active'' and existing.ai_audit_status = ''approved''',
    'and existing.cache_state = ''active'' and existing.ai_audit_status = ''approved'' and public.is_current_question_policy(to_jsonb(existing))');
   execute def;
  end if;
 end loop;
 select pg_get_functiondef('public.enqueue_question_generation_job_if_needed(uuid,uuid,text)'::regprocedure) into def;
  def:=replace(def,chr(13),'');
 if position('public.is_current_question_policy' in def)=0 then
  marker := 'and ''unique-answer-v2'' = any(string_to_array(coalesce(cache.source_version, ''''), ''|''))';
  if position(marker in def)=0 then raise exception 'POLICY_COVERAGE_LAYOUT_UNEXPECTED'; end if;
  execute replace(def,marker,'and public.is_current_question_policy(to_jsonb(cache))');
 end if;
 -- Retire the old independent Chinese-gloss distinctness veto.
 select pg_get_functiondef('public.validate_formal_challenge_question_quality()'::regprocedure) into def;
  def:=replace(def,chr(13),'');
 def:=regexp_replace(def,'  if option_meaning_count <> distinct_option_meaning_count then.*?end if;','', 's');
 execute def;
end;
$$;

-- A previous worker cannot insert/rewrite a ready question under the old policy.
-- Usage and retirement updates of existing old rows remain legal; history is intact.
create or replace function public.guard_question_policy_write()
returns trigger language plpgsql security invoker set search_path=pg_catalog
as $$
begin
 if new.quality_status::text='ready' and new.cache_state::text in ('active','reserved_next_day')
  and not public.is_current_question_policy(to_jsonb(new)) then
  if tg_op='INSERT' then raise exception 'QUESTION_POLICY_RETIRED'; end if;
  if (to_jsonb(new)-array['used_count','last_used_at','updated_at','cache_state','available_from'])
     is distinct from (to_jsonb(old)-array['used_count','last_used_at','updated_at','cache_state','available_from'])
     or old.quality_status::text<>'ready' or old.cache_state::text not in ('active','reserved_next_day') then
   raise exception 'QUESTION_POLICY_RETIRED';
  end if;
 end if;
 return new;
end;
$$;
revoke all on function public.guard_question_policy_write() from public,anon,authenticated,service_role;
drop trigger if exists guard_question_policy_write on public.question_cache;
create trigger guard_question_policy_write before insert or update on public.question_cache
 for each row execute function public.guard_question_policy_write();

-- Covers random, selected practice and replacement paths without touching old snapshots.
create or replace function public.guard_new_question_policy_snapshot()
returns trigger language plpgsql security invoker set search_path=pg_catalog
as $$
declare cache public.question_cache%rowtype;
begin
 if tg_op='UPDATE' and new.cache_question_id is not distinct from old.cache_question_id then return new; end if;
 select * into cache from public.question_cache where id=new.cache_question_id;
 if not found or not public.is_current_question_policy(to_jsonb(cache)) then raise exception 'QUESTION_POLICY_RETIRED'; end if;
 return new;
end;
$$;
revoke all on function public.guard_new_question_policy_snapshot() from public,anon,authenticated,service_role;
drop trigger if exists guard_new_question_policy_snapshot on public.quiz_challenge_questions;
create trigger guard_new_question_policy_snapshot before insert or update on public.quiz_challenge_questions
 for each row execute function public.guard_new_question_policy_snapshot();
notify pgrst,'reload schema';
commit;
