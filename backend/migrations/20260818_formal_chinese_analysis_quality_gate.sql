begin;

create or replace function public.validate_formal_challenge_question_quality()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  option_meaning_count integer;
  distinct_option_meaning_count integer;
  non_chinese_option_count integer;
  answer_index integer;
  correct_meaning text;
  context_zh text;
  context_chinese text;
  context_en text;
  english_word_count integer;
  minimum_chinese_length integer;
  snapshot jsonb;
begin
  if nullif(btrim(new.question_fingerprint), '') is null then
    raise exception 'FORMAL_QUIZ_QUALITY_REQUIRED: question_fingerprint';
  end if;

  snapshot := case
    when jsonb_typeof(new.question_snapshot->'question_snapshot') = 'object'
      then new.question_snapshot->'question_snapshot'
    else new.question_snapshot
  end;

  if jsonb_typeof(snapshot->'optionMeanings') is distinct from 'array'
     or jsonb_array_length(snapshot->'optionMeanings') <> 4 then
    raise exception 'FORMAL_QUIZ_QUALITY_REQUIRED: option_meanings';
  end if;

  select count(*), count(distinct lower(btrim(value))), count(*) filter (
    where nullif(btrim(value), '') is null
       or value !~ '[㐀-鿿]'
       or lower(value) like '%中文释义补充%'
  )
  into option_meaning_count, distinct_option_meaning_count, non_chinese_option_count
  from jsonb_array_elements_text(snapshot->'optionMeanings') as item(value);

  if option_meaning_count <> distinct_option_meaning_count then
    raise exception 'FORMAL_QUIZ_QUALITY_REQUIRED: duplicate_option_meanings';
  end if;
  if non_chinese_option_count <> 0 then
    raise exception 'FORMAL_QUIZ_QUALITY_REQUIRED: chinese_option_meanings';
  end if;

  answer_index := ascii(upper(coalesce(snapshot->>'answer', ''))) - ascii('A');
  if answer_index < 0 or answer_index > 3 then
    raise exception 'FORMAL_QUIZ_QUALITY_REQUIRED: answer';
  end if;
  correct_meaning := btrim(snapshot->'optionMeanings'->>answer_index);
  context_zh := btrim(coalesce(snapshot->>'contextCN', ''));
  context_chinese := regexp_replace(context_zh, '[^㐀-鿿]', '', 'g');
  context_en := btrim(coalesce(snapshot->>'context', snapshot->>'stem', ''));
  select count(*)::integer
    into english_word_count
    from regexp_matches(context_en, '[A-Za-z]+([''-][A-Za-z]+)*', 'g');
  minimum_chinese_length := greatest(6, ceil(english_word_count * 0.5)::integer);
  if char_length(context_chinese) < minimum_chinese_length
     or context_chinese = regexp_replace(correct_meaning, '[^㐀-鿿]', '', 'g') then
    raise exception 'FORMAL_QUIZ_QUALITY_REQUIRED: context_zh';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_formal_challenge_question_quality()
  from public, anon, authenticated, service_role;

drop trigger if exists validate_formal_challenge_question_quality
  on public.quiz_challenge_questions;
create trigger validate_formal_challenge_question_quality
before insert or update on public.quiz_challenge_questions
for each row execute function public.validate_formal_challenge_question_quality();

commit;
