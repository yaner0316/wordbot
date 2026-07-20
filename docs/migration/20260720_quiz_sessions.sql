begin;

create table if not exists public.quiz_sessions (
    test_id text primary key,
    user_id uuid not null references public.users(id) on delete cascade,
    questions jsonb not null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default (now() + interval '24 hours'),
    constraint quiz_sessions_test_id_not_blank check (btrim(test_id) <> ''),
    constraint quiz_sessions_questions_array check (jsonb_typeof(questions) = 'array'),
    constraint quiz_sessions_expires_after_created check (expires_at > created_at)
);

create index if not exists quiz_sessions_user_test_idx
    on public.quiz_sessions (user_id, test_id);

create index if not exists quiz_sessions_expires_at_idx
    on public.quiz_sessions (expires_at);

alter table public.quiz_sessions enable row level security;

revoke all on table public.quiz_sessions from anon, authenticated;
grant all on table public.quiz_sessions to service_role;

create or replace function public.cleanup_expired_quiz_sessions()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
    deleted_count integer;
begin
    delete from public.quiz_sessions
    where expires_at < now();

    get diagnostics deleted_count = row_count;
    return deleted_count;
end;
$$;

revoke all on function public.cleanup_expired_quiz_sessions() from public;
grant execute on function public.cleanup_expired_quiz_sessions() to service_role;

commit;
