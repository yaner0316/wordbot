begin;

-- Restore the accepted assessment schema without rewriting existing history.
alter table if exists public.assessments
  add column if not exists context_zh text;

notify pgrst, 'reload schema';

commit;
