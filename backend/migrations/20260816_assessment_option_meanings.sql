begin;

-- Persist the option-meaning snapshot already written by the submit path.
alter table if exists public.assessments
  add column if not exists option_meanings jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';

commit;
