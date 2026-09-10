begin;

alter table public.question_generation_jobs
    add column if not exists generation_checkpoint jsonb not null default '{}'::jsonb;

create or replace function public.save_question_generation_checkpoint(
    p_job_id uuid,
    p_worker_id text,
    p_expected_word_version bigint,
    p_lease_token uuid,
    p_checkpoint jsonb
)
returns setof public.question_generation_jobs
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_now timestamptz := clock_timestamp();
begin
    if jsonb_typeof(coalesce(p_checkpoint, '{}'::jsonb)) <> 'object' then
        raise exception 'generation checkpoint must be a JSON object';
    end if;

    return query
    update public.question_generation_jobs as job
    set generation_checkpoint = coalesce(p_checkpoint, '{}'::jsonb),
        updated_at = v_now
    from public.words as word
    where job.id = p_job_id
      and job.lease_owner = p_worker_id
      and job.word_version = p_expected_word_version
      and job.lease_token = p_lease_token
      and job.status in ('generating', 'validating', 'repairing')
      and job.lease_expires_at > v_now
      and word.id = job.word_id
      and word.user_id = job.user_id
      and word.question_generation_version = job.word_version
      and word.mastery_status is distinct from 'mastered'
    returning job.*;
end;
$$;

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
                order by job.next_attempt_at, job.created_at, job.id
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

create or replace function public.complete_question_generation_job(
    p_job_id uuid,
    p_worker_id text,
    p_expected_word_version bigint,
    p_lease_token uuid
)
returns setof public.question_generation_jobs
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_now timestamptz := clock_timestamp();
begin
    return query
    update public.question_generation_jobs as job
    set status = 'ready',
        next_attempt_at = v_now,
        lease_owner = null,
        lease_expires_at = null,
        lease_token = null,
        last_error_code = null,
        last_error_detail = null,
        rejection_reasons = '{}'::jsonb,
        generation_checkpoint = '{}'::jsonb,
        updated_at = v_now
    from public.words as word
    where job.id = p_job_id
      and job.lease_owner = p_worker_id
      and job.word_version = p_expected_word_version
      and job.lease_token = p_lease_token
      and job.status in ('generating', 'validating', 'repairing')
      and job.lease_expires_at > v_now
      and word.id = job.word_id
      and word.user_id = job.user_id
      and word.question_generation_version = job.word_version
      and word.mastery_status is distinct from 'mastered'
      and lower(btrim(word.word)) <> 'genaine'
      and btrim(word.word) ~* '^[a-z]+([ ''-][a-z]+)*$'
    returning job.*;
end;
$$;

revoke all on function public.save_question_generation_checkpoint(uuid, text, bigint, uuid, jsonb)
    from public, anon, authenticated;
grant execute on function public.save_question_generation_checkpoint(uuid, text, bigint, uuid, jsonb)
    to service_role;

revoke all on function public.complete_question_generation_job(uuid, text, bigint, uuid)
    from public, anon, authenticated;
grant execute on function public.complete_question_generation_job(uuid, text, bigint, uuid)
    to service_role;

revoke all on function public.claim_question_generation_jobs(text, integer, bigint)
    from public, anon, authenticated;
grant execute on function public.claim_question_generation_jobs(text, integer, bigint)
    to service_role;

notify pgrst, 'reload schema';

commit;
