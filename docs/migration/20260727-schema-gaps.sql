-- WordBot schema gaps identified by the 2026-07-27 read-only audit.
-- Apply only after explicit production approval and a fresh backup.

begin;

alter table public.quiz_sessions
    add column if not exists updated_at timestamptz not null default now();

alter table public.assessments
    add column if not exists parent_review_id text;

create index if not exists assessments_parent_review_idx
    on public.assessments (user_id, parent_review_id, review_status)
    where parent_review_id is not null;

create or replace function public.touch_quiz_sessions_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

do $$
begin
    if not exists (
        select 1
        from pg_trigger
        where tgrelid = 'public.quiz_sessions'::regclass
          and tgname = 'quiz_sessions_updated_at_trigger'
    ) then
        create trigger quiz_sessions_updated_at_trigger
            before update on public.quiz_sessions
            for each row execute function public.touch_quiz_sessions_updated_at();
    end if;
end;
$$;

notify pgrst, 'reload schema';

commit;