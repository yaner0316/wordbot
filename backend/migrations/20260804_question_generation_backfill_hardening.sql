begin;

create or replace function public.wordbot_question_generation_revision()
returns text
language sql
immutable
security invoker
set search_path = public
as $$
    select '20260804'::text
$$;

revoke all on function public.wordbot_question_generation_revision()
    from public, anon, authenticated;
grant execute on function public.wordbot_question_generation_revision()
    to service_role;

notify pgrst, 'reload schema';

commit;
