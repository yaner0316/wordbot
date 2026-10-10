begin;

alter table public.question_generation_jobs
    add column if not exists demand_requested_at timestamptz,
    add column if not exists demand_priority_until timestamptz;

create or replace function public.request_challenge_question_supply(p_user_id uuid, p_word_ids uuid[])
returns setof public.question_generation_jobs
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_id uuid;
    v_now timestamptz := clock_timestamp();
begin
    if p_user_id is null or p_word_ids is null or cardinality(p_word_ids) > 10
       or exists (select 1 from unnest(p_word_ids) id where id is null)
       or cardinality(p_word_ids) <> (select count(distinct id) from unnest(p_word_ids) id)
       or exists (select 1 from unnest(p_word_ids) as requested(id) where not exists (
           select 1 from public.words word where word.id = requested.id and word.user_id = p_user_id
       )) then
        raise exception 'CHALLENGE_SELECTION_INVALID';
    end if;
    -- Match the edit path's word-before-job lock order; never bypass its fence.
    for v_id in select word.id from public.words word
        where word.id = any(p_word_ids) and word.user_id = p_user_id
          and word.mastery_status is distinct from 'mastered'
          and lower(btrim(word.word)) <> 'genaine'
          and btrim(word.word) ~* '^[a-z]+([ ''-][a-z]+)*$'
        order by word.id for update
    loop
        if exists (select 1 from public.question_generation_jobs job
            where job.word_id = v_id and job.next_attempt_at >= timestamptz '9999-01-01') then
            continue;
        end if;
        perform public.enqueue_question_generation_job_if_needed(p_user_id, v_id, 'cache_backfill');
        update public.question_generation_jobs job
        set next_attempt_at = least(job.next_attempt_at, v_now),
            demand_requested_at = v_now, demand_priority_until = v_now + interval '2 minutes'
        where job.word_id = v_id and job.user_id = p_user_id
          and job.status in ('pending', 'retry_wait')
          and (job.demand_requested_at is null or job.demand_requested_at <= v_now - interval '5 minutes')
          and job.word_version = (select word.question_generation_version from public.words word where word.id = v_id);
        return query select job.* from public.question_generation_jobs job where job.word_id = v_id and job.user_id = p_user_id;
    end loop;
end;
$$;

revoke all on function public.request_challenge_question_supply(uuid, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.request_challenge_question_supply(uuid, uuid[]) to service_role;

create or replace function public.claim_question_generation_jobs(
    p_worker_id text,
    p_limit integer,
    p_lease_duration_ms bigint
)
returns setof public.question_generation_jobs
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_now timestamptz := clock_timestamp();
    v_lease_duration interval;
begin
    if coalesce(trim(p_worker_id), '') = '' then
        raise exception 'WORKER_ID_REQUIRED';
    end if;
    v_lease_duration := make_interval(
        secs => greatest(1, coalesce(p_lease_duration_ms, 60000))::double precision / 1000.0
    );

    return query
    with last_service as (
        select history.user_id, max(history.updated_at) as last_served_at
        from public.question_generation_jobs as history
        where history.attempt_count > 0
        group by history.user_id
    ), eligible as (
        select job.id, job.next_attempt_at, job.created_at,
            service.last_served_at,
            row_number() over (
                partition by job.user_id
                order by coalesce(job.demand_priority_until > v_now, false) desc, job.next_attempt_at, job.created_at, job.id
            ) as user_job_rank
        from public.question_generation_jobs as job
        join public.words as word
          on word.id = job.word_id
         and word.user_id = job.user_id
         and word.question_generation_version = job.word_version
        left join last_service as service on service.user_id = job.user_id
        where (
            (job.status in ('pending', 'retry_wait') and job.next_attempt_at <= v_now)
            or (job.status in ('generating', 'validating', 'repairing')
                and (job.lease_expires_at is null or job.lease_expires_at <= v_now))
        )
          and word.mastery_status is distinct from 'mastered'
          and lower(btrim(word.word)) <> 'genaine'
          and btrim(word.word) ~* '^[a-z]+([ ''-][a-z]+)*$'
    ), due as (
        select job.id
        from public.question_generation_jobs as job
        join eligible on eligible.id = job.id
        order by eligible.user_job_rank, eligible.last_served_at asc nulls first,
            eligible.next_attempt_at, eligible.created_at, job.id
        for update of job skip locked
        limit greatest(0, least(coalesce(p_limit, 0), 100))
    )
    update public.question_generation_jobs as job
    set status = 'generating',
        attempt_count = job.attempt_count + 1,
        lease_owner = p_worker_id,
        lease_expires_at = v_now + v_lease_duration,
        lease_token = gen_random_uuid(),
        updated_at = v_now
    from due
    where job.id = due.id
    returning job.*;
end;
$$;

notify pgrst, 'reload schema';
commit;
