begin;

-- Consumption and its replacement request commit together, including replacement
-- questions. No HTTP request, page revisit or next-day quiz is needed to enqueue.
create or replace function public.enqueue_consumed_question_replacement()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
    perform public.enqueue_question_generation_job_if_needed(
        new.user_id, new.meaning_id, 'cache_backfill'
    );
    return new;
end;
$$;

revoke all on function public.enqueue_consumed_question_replacement()
    from public, anon, authenticated;
grant execute on function public.enqueue_consumed_question_replacement() to service_role;

drop trigger if exists quiz_display_replenish on public.quiz_display_events;
create trigger quiz_display_replenish
after insert on public.quiz_display_events
for each row execute function public.enqueue_consumed_question_replacement();

commit;
