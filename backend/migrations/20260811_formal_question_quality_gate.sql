begin;

-- Stage 1 formal-question write gate.
-- Existing historical rows are not rewritten by this migration; only new or
-- updated formal challenge questions are rejected when their cache identity is
-- incomplete or their option meanings are duplicated.

create or replace function public.validate_formal_challenge_question_quality()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  option_meaning_count integer;
  distinct_option_meaning_count integer;
begin
  if nullif(btrim(new.question_fingerprint), '') is null then
    raise exception 'FORMAL_QUIZ_QUALITY_REQUIRED: question_fingerprint';
  end if;

  if jsonb_typeof(new.question_snapshot->'optionMeanings') <> 'array'
     or jsonb_array_length(new.question_snapshot->'optionMeanings') <> 4 then
    raise exception 'FORMAL_QUIZ_QUALITY_REQUIRED: option_meanings';
  end if;

  select count(*), count(distinct lower(btrim(value)))
    into option_meaning_count, distinct_option_meaning_count
  from jsonb_array_elements_text(new.question_snapshot->'optionMeanings') as item(value);

  if option_meaning_count <> distinct_option_meaning_count then
    raise exception 'FORMAL_QUIZ_QUALITY_REQUIRED: duplicate_option_meanings';
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
