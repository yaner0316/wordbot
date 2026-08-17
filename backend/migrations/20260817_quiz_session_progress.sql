begin;

alter table public.quiz_sessions
    add column if not exists session_state jsonb not null default '{}'::jsonb,
    add column if not exists updated_at timestamptz not null default now();

comment on column public.quiz_sessions.session_state is
    'Client-safe draft progress: currentQuestion and answers.';

create or replace function public.touch_quiz_sessions_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

revoke all on function public.touch_quiz_sessions_updated_at()
    from public, anon, authenticated;
grant execute on function public.touch_quiz_sessions_updated_at()
    to service_role;

do $$
begin
    if not exists (
        select 1
        from pg_catalog.pg_trigger
        where tgrelid = 'public.quiz_sessions'::regclass
          and tgname = 'quiz_sessions_updated_at_trigger'
          and not tgisinternal
    ) then
        create trigger quiz_sessions_updated_at_trigger
            before update on public.quiz_sessions
            for each row execute function public.touch_quiz_sessions_updated_at();
    end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
