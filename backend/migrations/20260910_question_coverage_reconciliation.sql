begin;

create or replace function public.enqueue_question_generation_job_if_needed(
    p_user_id uuid,
    p_word_id uuid,
    p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_word public.words%rowtype;
    v_learning_level text;
    v_ready_fingerprints integer := 0;
    v_ready_questions integer := 0;
    v_affected integer := 0;
begin
    select word.*
    into v_word
    from public.words as word
    where word.id = p_word_id
      and word.user_id = p_user_id
      and word.mastery_status is distinct from 'mastered'
    for update;
    if not found then
        return false;
    end if;

    if exists (
        select 1
        from pg_catalog.pg_attribute as attribute
        where attribute.attrelid = 'public.users'::regclass
          and attribute.attname = 'learning_level'
          and not attribute.attisdropped
    ) then
        execute 'select learning_level::text from public.users where id = $1'
        into v_learning_level
        using p_user_id;
    else
        -- Compatibility for pre-learning-level schemas while they traverse the
        -- fixed migration chain. Current production schemas always take the
        -- user-level branch above.
        v_learning_level := v_word.level::text;
    end if;
    if v_learning_level is null then
        return false;
    end if;

    select
        count(distinct cache.question_fingerprint),
        count(distinct regexp_replace(lower(btrim(cache.question_text)), '\s+', ' ', 'g'))
    into v_ready_fingerprints, v_ready_questions
    from public.question_cache as cache
    where cache.user_id = p_user_id
      and cache.word_id = p_word_id
      and cache.level::text = v_learning_level
      and cache.round_type = 'primary'
      and cache.quality_status = 'ready'
      and cache.cache_state in ('active', 'reserved_next_day')
      and cache.question_type = '1'
      and lower(btrim(cache.ai_audit_status)) = 'approved'
      and 'unique-answer-v2' = any(string_to_array(coalesce(cache.source_version, ''), '|'))
      and jsonb_typeof(cache.options) = 'array'
      and jsonb_array_length(cache.options) = 4
      and jsonb_typeof(cache.option_meanings) = 'array'
      and jsonb_array_length(cache.option_meanings) = 4
      and cache.answer in ('A', 'B', 'C', 'D')
      and btrim(cache.question_text) <> ''
      and btrim(coalesce(cache.context_zh, '')) <> ''
      and btrim(cache.correct_meaning) <> ''
      and cache.question_fingerprint is not null;

    if coalesce(nullif(p_reason, ''), 'coverage_reconcile') <> 'coverage_reconcile'
       and coalesce(nullif(p_reason, ''), 'coverage_reconcile') <> 'cache_backfill'
       and v_ready_fingerprints >= 2 and v_ready_questions >= 2 then
        return false;
    end if;

    insert into public.question_generation_jobs as question_generation_jobs (
        user_id, word_id, word_version, status, reason, next_attempt_at
    ) values (
        p_user_id,
        p_word_id,
        v_word.question_generation_version,
        'pending',
        coalesce(nullif(p_reason, ''), 'coverage_reconcile'),
        clock_timestamp()
    )
    on conflict (word_id) do update
    set user_id = excluded.user_id,
        word_version = excluded.word_version,
        status = 'pending',
        reason = excluded.reason,
        attempt_count = case
            when question_generation_jobs.word_version <> excluded.word_version then 0
            else question_generation_jobs.attempt_count
        end,
        next_attempt_at = clock_timestamp(),
        lease_owner = null,
        lease_expires_at = null,
        lease_token = null,
        updated_at = clock_timestamp()
    where question_generation_jobs.word_version <> excluded.word_version
       or question_generation_jobs.status in ('ready', 'needs_manual_review');
    get diagnostics v_affected = row_count;
    if v_affected > 0 then
        return true;
    end if;
    return exists (
        select 1
        from public.question_generation_jobs as job
        where job.user_id = p_user_id
          and job.word_id = p_word_id
          and job.word_version = v_word.question_generation_version
          and job.status in ('pending', 'generating', 'validating', 'repairing', 'retry_wait')
    );
end;
$$;

revoke all on function public.enqueue_question_generation_job_if_needed(uuid, uuid, text)
    from public, anon, authenticated, service_role;
grant execute on function public.enqueue_question_generation_job_if_needed(uuid, uuid, text)
    to service_role;

notify pgrst, 'reload schema';

commit;
