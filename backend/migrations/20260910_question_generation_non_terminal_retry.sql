begin;

-- Keep every eligible coverage target executable. The legacy max-attempt
-- argument remains in the signature so deployed workers can upgrade safely.
create or replace function public.fail_question_generation_job(
    p_job_id uuid,
    p_worker_id text,
    p_expected_word_version bigint,
    p_lease_token uuid,
    p_max_attempts integer,
    p_base_backoff_ms bigint,
    p_max_backoff_ms bigint,
    p_error_code text,
    p_error_detail text,
    p_rejection_reasons jsonb
)
returns setof public.question_generation_jobs
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_now timestamptz := clock_timestamp();
    v_job public.question_generation_jobs%rowtype;
    v_backoff_ms bigint;
begin
    select job.*
    into v_job
    from public.question_generation_jobs as job
    join public.words as word
      on word.id = job.word_id
     and word.user_id = job.user_id
     and word.question_generation_version = job.word_version
    where job.id = p_job_id
      and job.lease_owner = p_worker_id
      and job.word_version = p_expected_word_version
      and job.lease_token = p_lease_token
      and job.status in ('generating', 'validating', 'repairing')
      and job.lease_expires_at > v_now
      and word.mastery_status is distinct from 'mastered'
      and lower(btrim(word.word)) <> 'genaine'
      and btrim(word.word) ~* '^[a-z]+([ ''-][a-z]+)*$'
    for update of job;
    if not found then
        return;
    end if;

    v_backoff_ms := least(
        greatest(1, coalesce(p_max_backoff_ms, 3600000)),
        greatest(1, coalesce(p_base_backoff_ms, 60000))
            * (2 ^ greatest(0, least(v_job.attempt_count - 1, 30)))
    );

    return query
    update public.question_generation_jobs as job
    set status = 'retry_wait',
        next_attempt_at = v_now + make_interval(secs => v_backoff_ms::double precision / 1000.0),
        lease_owner = null,
        lease_expires_at = null,
        lease_token = null,
        last_error_code = coalesce(nullif(p_error_code, ''), 'QUESTION_GENERATION_FAILED'),
        last_error_detail = coalesce(p_error_detail, 'Question generation failed'),
        rejection_reasons = coalesce(p_rejection_reasons, '{}'::jsonb),
        updated_at = v_now
    where job.id = v_job.id
      and job.word_version = v_job.word_version
      and job.lease_token = v_job.lease_token
    returning job.*;
end;
$$;

revoke all on function public.fail_question_generation_job(
    uuid, text, bigint, uuid, integer, bigint, bigint, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.fail_question_generation_job(
    uuid, text, bigint, uuid, integer, bigint, bigint, text, text, jsonb
) to service_role;

notify pgrst, 'reload schema';

commit;
