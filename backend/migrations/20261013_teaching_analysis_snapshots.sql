begin;

-- Additive only: do not rewrite history or retire/rebuild legacy approved caches.
alter table public.question_cache add column if not exists teaching_analysis jsonb;
alter table public.assessments add column if not exists teaching_analysis jsonb;

create or replace function public.is_valid_teaching_analysis(a jsonb, stem text, opts jsonb, answer text)
returns boolean language plpgsql immutable security invoker set search_path = pg_catalog
as $$
declare item jsonb; expected text; seen text[] := array[]::text[]; target text;
begin
  if a is null or stem is null or answer is null or a->>'schemaVersion' is distinct from '1'
     or jsonb_typeof(a->'options') is distinct from 'array'
     or jsonb_array_length(a->'options') <> 4
     or jsonb_typeof(opts) is distinct from 'array' or jsonb_array_length(opts) <> 4
     or answer not in ('A','B','C','D') then return false; end if;
  expected := lower(regexp_replace(opts->>(ascii(answer)-65),'^[A-D]\.\s*','','g'));
  if char_length(coalesce(a->>'clue','')) < 3
     or position(lower(a->>'clue') in lower(stem)) = 0
     or coalesce(a->>'clue','') ~ '_{3,}'
     or coalesce(a->>'clueReason','') !~ '[㐀-鿿]' or char_length(coalesce(a->>'clueReason','')) < 8
     or coalesce(a->>'correctReason','') !~ '[㐀-鿿]' or char_length(coalesce(a->>'correctReason','')) < 8
     or lower(a->>'correctWord') is distinct from expected then return false; end if;
  for item in select value from jsonb_array_elements(a->'options') loop
    target := lower(item->>'word');
    if target is null or target = any(seen)
       or not exists(select 1 from jsonb_array_elements_text(opts) as o(value) where lower(regexp_replace(value,'^[A-D]\.\s*','','g')) = target)
       or jsonb_typeof(item->'fits') is distinct from 'boolean'
       or coalesce(item->>'meaning','') !~ '[㐀-鿿]'
       or coalesce(item->>'reason','') !~ '[㐀-鿿]' or char_length(coalesce(item->>'reason','')) < 8
       or (item->>'fits')::boolean is distinct from (target = expected) then return false; end if;
    seen := array_append(seen,target);
  end loop;
  return true;
end;
$$;
revoke all on function public.is_valid_teaching_analysis(jsonb,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.is_valid_teaching_analysis(jsonb,text,jsonb,text) to service_role;

-- Extend the installed publisher in place, preserving leases, edit/archive fences
-- and every existing ACL instead of substituting an older full RPC definition.
do $$
declare def text;
begin
  select pg_get_functiondef('public.publish_question_generation_variants(uuid,text,bigint,uuid,jsonb)'::regprocedure) into def;
  if position('teaching_analysis' in def) = 0 then
    if position('options, answer, option_meanings, correct_meaning' in def) = 0 then raise exception 'TEACHING_PUBLISHER_LAYOUT_UNEXPECTED'; end if;
    def := replace(def,'options, answer, option_meanings, correct_meaning','options, answer, option_meanings, teaching_analysis, correct_meaning');
    def := replace(def,'variant->''option_meanings'',','variant->''option_meanings'', variant->''teaching_analysis'',');
    def := replace(def,'option_meanings = excluded.option_meanings,','option_meanings = excluded.option_meanings, teaching_analysis = excluded.teaching_analysis,');
    execute def;
  end if;
end;
$$;

do $$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.question_cache'::regclass and conname='question_cache_teaching_analysis_valid') then
    alter table public.question_cache add constraint question_cache_teaching_analysis_valid check (
      not ('teaching-analysis-v1' = any(string_to_array(coalesce(source_version,''),'|')))
      or public.is_valid_teaching_analysis(teaching_analysis,question_text,options,answer)
    );
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.assessments'::regclass and conname='assessment_teaching_analysis_valid') then
    alter table public.assessments add constraint assessment_teaching_analysis_valid check (
      teaching_analysis is null or public.is_valid_teaching_analysis(teaching_analysis,question_text,options,correct_answer)
    );
  end if;
end;
$$;

create or replace function public.validate_formal_teaching_snapshot()
returns trigger language plpgsql security invoker set search_path = pg_catalog
as $$
declare cache public.question_cache%rowtype; snapshot jsonb;
begin
  select * into cache from public.question_cache where id=new.cache_question_id;
  if 'teaching-analysis-v1' = any(string_to_array(coalesce(cache.source_version,''),'|')) then
    snapshot := coalesce(new.question_snapshot->'question_snapshot',new.question_snapshot);
    if snapshot->'teachingAnalysis' is distinct from cache.teaching_analysis
       or not public.is_valid_teaching_analysis(snapshot->'teachingAnalysis',new.stem,snapshot->'options',snapshot->>'answer') then
      raise exception 'FORMAL_TEACHING_SNAPSHOT_REQUIRED';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.validate_formal_teaching_snapshot() from public,anon,authenticated,service_role;
drop trigger if exists validate_formal_teaching_snapshot on public.quiz_challenge_questions;
create trigger validate_formal_teaching_snapshot before insert or update on public.quiz_challenge_questions for each row execute function public.validate_formal_teaching_snapshot();

notify pgrst,'reload schema';
commit;
