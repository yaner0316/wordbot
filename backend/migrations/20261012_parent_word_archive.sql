begin;

alter table public.words add column if not exists deleted_at timestamptz;
create index if not exists words_active_user_entered_idx
    on public.words(user_id, entered_at, id) where deleted_at is null;

create or replace view public.active_words with (security_invoker = true) as
    select * from public.words where deleted_at is null;
revoke all on public.active_words from public, anon, authenticated;
grant select on public.active_words to service_role;

-- claim_question_generation_jobs: retain 20261010_challenge_demand_priority.sql behavior; exclude archived meanings.
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
        join public.active_words as word
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

-- renew_question_generation_job: retain 20260806_word_edit_generation_version.sql behavior; exclude archived meanings.
create or replace function public.renew_question_generation_job(
    p_job_id uuid,
    p_worker_id text,
    p_expected_word_version bigint,
    p_lease_token uuid,
    p_lease_duration_ms bigint
)
returns setof public.question_generation_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
    v_now timestamptz := clock_timestamp();
    v_lease_duration interval;
begin
    v_lease_duration := make_interval(
        secs => greatest(1, coalesce(p_lease_duration_ms, 60000))::double precision / 1000.0
    );
    return query
    update public.question_generation_jobs as job
    set lease_expires_at = v_now + v_lease_duration,
        updated_at = v_now
    from public.active_words as word
    where job.id = p_job_id
      and job.lease_owner = p_worker_id
      and job.word_version = p_expected_word_version
      and job.lease_token = p_lease_token
      and job.status in ('generating', 'validating', 'repairing')
      and job.lease_expires_at > v_now
      and word.id = job.word_id
      and word.user_id = job.user_id
      and word.question_generation_version = job.word_version
      and word.mastery_status <> 'mastered'
      and lower(btrim(word.word)) <> 'genaine'
      and btrim(word.word) ~* '^[a-z]+([ ''-][a-z]+)*$'
    returning job.*;
end;
$$;

-- publish_question_generation_variants: retain 20260819_mandatory_ai_question_audit.sql behavior; exclude archived meanings.
create or replace function public.publish_question_generation_variants(
    p_job_id uuid,
    p_worker_id text,
    p_expected_word_version bigint,
    p_lease_token uuid,
    p_variants jsonb
)
returns table (published integer, retired integer, fingerprints text[])
language plpgsql
security definer
set search_path = public
as $$
declare
    v_now timestamptz := clock_timestamp();
    v_job public.question_generation_jobs%rowtype;
    v_word public.words%rowtype;
    v_user_id uuid;
    v_word_id uuid;
    v_fingerprint_count integer;
    v_question_count integer;
    v_structure_count integer;
    v_retired integer := 0;
begin
    select job.user_id, job.word_id
    into v_user_id, v_word_id
    from public.question_generation_jobs as job
    where job.id = p_job_id;
    if not found then
        return;
    end if;

    select word.*
    into v_word
    from public.active_words as word
    where word.id = v_word_id
      and word.user_id = v_user_id
    for update;
    if not found then
        return;
    end if;

    select job.*
    into v_job
    from public.question_generation_jobs as job
    where job.id = p_job_id
    for update;

    if not found
       or coalesce(btrim(p_worker_id), '') = ''
       or v_job.lease_owner is null
       or v_job.lease_owner is distinct from p_worker_id
       or v_job.word_version is distinct from p_expected_word_version
       or v_job.lease_token is distinct from p_lease_token
       or v_job.status not in ('generating', 'validating', 'repairing')
       or v_job.lease_expires_at is null
       or not (v_job.lease_expires_at > v_now)
       or v_job.user_id is distinct from v_word.user_id
       or v_job.word_id is distinct from v_word.id
       or v_job.word_version is distinct from v_word.question_generation_version
       or v_word.mastery_status = 'mastered'
       or lower(btrim(v_word.word)) = 'genaine'
       or btrim(v_word.word) !~* '^[a-z]+([ ''-][a-z]+)*$' then
        return;
    end if;

    if jsonb_typeof(p_variants) <> 'array'
       or jsonb_array_length(p_variants) <> 2 then
        raise exception 'EXACTLY_TWO_VARIANTS_REQUIRED';
    end if;

    select
        count(distinct nullif(btrim(variant->>'question_fingerprint'), '')),
        count(distinct nullif(regexp_replace(lower(btrim(variant->>'question_text')), '\s+', ' ', 'g'), '')),
        count(*) filter (where
            jsonb_typeof(variant->'options') = 'array'
            and jsonb_array_length(variant->'options') = 4
            and jsonb_typeof(variant->'option_meanings') = 'array'
            and jsonb_array_length(variant->'option_meanings') = 4
            and upper(variant->>'answer') in ('A', 'B', 'C', 'D')
            and nullif(btrim(variant->>'level'), '') is not null
            and (variant->>'question_type') = '1'
            and nullif(btrim(variant->>'correct_meaning'), '') is not null
            and lower(btrim(variant->>'ai_audit_status')) = 'approved'
        )
    into v_fingerprint_count, v_question_count, v_structure_count
    from jsonb_array_elements(p_variants) as item(variant);

    if v_fingerprint_count <> 2 or v_question_count <> 2 then
        raise exception 'DISTINCT_FINGERPRINTS_AND_QUESTION_TEXT_REQUIRED';
    end if;
    if v_structure_count <> 2 then
        raise exception 'INVALID_VARIANT_STRUCTURE';
    end if;

    insert into public.question_cache as cache (
        user_id, word_id, source_word_record_id, level, question_type,
        round_type, quality_status, question_text, context_zh, suffix,
        options, answer, option_meanings, correct_meaning, ai_audit_status,
        source_version, used_count, generated_at, last_used_at, variant_slot,
        cache_state, available_from, question_fingerprint, rejection_reasons,
        updated_at
    )
    select
        v_job.user_id,
        v_job.word_id,
        nullif(variant->>'source_word_record_id', ''),
        (variant->>'level')::public.wordbot_level,
        (variant->>'question_type')::public.question_type,
        'primary'::public.round_type,
        'ready'::public.question_quality_status,
        btrim(variant->>'question_text'),
        nullif(variant->>'context_zh', ''),
        nullif(variant->>'suffix', ''),
        variant->'options',
        upper(variant->>'answer'),
        variant->'option_meanings',
        nullif(variant->>'correct_meaning', ''),
        nullif(variant->>'ai_audit_status', ''),
        nullif(variant->>'source_version', ''),
        greatest(0, coalesce((variant->>'used_count')::bigint, 0)),
        coalesce((variant->>'generated_at')::timestamptz, v_now),
        (variant->>'last_used_at')::timestamptz,
        ordinal::integer,
        case when ordinal = 1 then 'active' else 'reserved_next_day' end,
        case when ordinal = 1 then null else v_now + interval '18 hours' end,
        btrim(variant->>'question_fingerprint'),
        coalesce(variant->'rejection_reasons', '{}'::jsonb),
        v_now
    from jsonb_array_elements(p_variants) with ordinality as item(variant, ordinal)
    on conflict (user_id, word_id, question_fingerprint) do update
    set source_word_record_id = excluded.source_word_record_id,
        level = excluded.level,
        question_type = excluded.question_type,
        round_type = excluded.round_type,
        quality_status = excluded.quality_status,
        question_text = excluded.question_text,
        context_zh = excluded.context_zh,
        suffix = excluded.suffix,
        options = excluded.options,
        answer = excluded.answer,
        option_meanings = excluded.option_meanings,
        correct_meaning = excluded.correct_meaning,
        ai_audit_status = excluded.ai_audit_status,
        source_version = excluded.source_version,
        used_count = cache.used_count,
        generated_at = excluded.generated_at,
        last_used_at = cache.last_used_at,
        variant_slot = excluded.variant_slot,
        cache_state = excluded.cache_state,
        available_from = excluded.available_from,
        rejection_reasons = excluded.rejection_reasons,
        updated_at = excluded.updated_at;

    update public.question_cache as cache
    set cache_state = 'retired',
        updated_at = v_now
    where cache.user_id = v_job.user_id
      and cache.word_id = v_job.word_id
      and cache.round_type = 'primary'
      and cache.quality_status = 'ready'
      and cache.question_fingerprint is not null
      and cache.question_fingerprint not in (
          select btrim(variant->>'question_fingerprint')
          from jsonb_array_elements(p_variants) as item(variant)
      );
    get diagnostics v_retired = row_count;

    return query
    select 2, v_retired, array(
        select btrim(variant->>'question_fingerprint')
        from jsonb_array_elements(p_variants) as item(variant)
        order by variant->>'question_fingerprint'
    );
end;
$$;

-- complete_question_generation_job: retain 20260910_question_generation_checkpoints.sql behavior; exclude archived meanings.
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
    from public.active_words as word
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

-- fail_question_generation_job: retain 20260910_question_generation_non_terminal_retry.sql behavior; exclude archived meanings.
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
    join public.active_words as word
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

-- enqueue_question_generation_job_if_needed: retain 20260910_question_coverage_reconciliation.sql behavior; exclude archived meanings.
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
    from public.active_words as word
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

-- fence_word_question_generation: retain 20260810_word_edit_cache_fk_hardening.sql behavior; exclude archived meanings.
create or replace function public.fence_word_question_generation(
    p_user_id uuid,
    p_word_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    v_now timestamptz := clock_timestamp();
    v_version bigint;
begin
    perform 1
    from public.active_words as word
    where word.id = p_word_id
      and word.user_id = p_user_id
    for update;
    if not found then
        return null;
    end if;

    update public.words as word
    set question_generation_version = greatest(1, word.question_generation_version) + 1,
        updated_at = v_now
    where word.id = p_word_id
      and word.user_id = p_user_id
    returning word.question_generation_version into v_version;

    insert into public.question_generation_jobs (
        user_id, word_id, word_version, status, reason, attempt_count,
        next_attempt_at, lease_owner, lease_expires_at, last_error_code,
        last_error_detail, rejection_reasons, updated_at
    ) values (
        p_user_id, p_word_id, v_version, 'pending', 'word_edit', 0,
        timestamptz '9999-12-31 23:59:59.999+00', null, null, null,
        null, '{}'::jsonb, v_now
    )
    on conflict (word_id) do update
    set user_id = excluded.user_id,
        word_version = excluded.word_version,
        status = excluded.status,
        reason = excluded.reason,
        attempt_count = excluded.attempt_count,
        next_attempt_at = excluded.next_attempt_at,
        lease_owner = null,
        lease_expires_at = null,
        lease_token = null,
        last_error_code = null,
        last_error_detail = null,
        rejection_reasons = '{}'::jsonb,
        updated_at = excluded.updated_at;

    perform public.retire_or_delete_word_question_cache(p_user_id, p_word_id);
    return v_version;
end;
$$;

-- finalize_word_question_generation_edit: retain 20260810_word_edit_cache_fk_hardening.sql behavior; exclude archived meanings.
create or replace function public.finalize_word_question_generation_edit(
    p_user_id uuid,
    p_word_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_now timestamptz := clock_timestamp();
    v_word public.words%rowtype;
begin
    select word.*
    into v_word
    from public.active_words as word
    where word.id = p_word_id
      and word.user_id = p_user_id
    for update;
    if not found then
        return false;
    end if;

    if v_word.mastery_status = 'mastered'
       or lower(btrim(v_word.word)) = 'genaine'
       or btrim(v_word.word) !~* '^[a-z]+([ ''-][a-z]+)*$' then
        perform public.retire_or_delete_word_question_cache(p_user_id, p_word_id);
        delete from public.question_generation_jobs as job
        where job.user_id = p_user_id
          and job.word_id = p_word_id;
        return false;
    end if;

    insert into public.question_generation_jobs (
        user_id, word_id, word_version, status, reason, attempt_count,
        next_attempt_at, lease_owner, lease_expires_at, last_error_code,
        last_error_detail, rejection_reasons, updated_at
    ) values (
        p_user_id, p_word_id, v_word.question_generation_version, 'pending',
        'word_edit', 0, v_now, null, null, null, null, '{}'::jsonb, v_now
    )
    on conflict (word_id) do update
    set user_id = excluded.user_id,
        word_version = excluded.word_version,
        status = excluded.status,
        reason = excluded.reason,
        attempt_count = excluded.attempt_count,
        next_attempt_at = excluded.next_attempt_at,
        lease_owner = null,
        lease_expires_at = null,
        lease_token = null,
        last_error_code = null,
        last_error_detail = null,
        rejection_reasons = '{}'::jsonb,
        updated_at = excluded.updated_at;
    return true;
end;
$$;

-- create_formal_quiz_challenge: retain 20261005_custom_challenges.sql behavior; exclude archived meanings.
create or replace function public.create_formal_quiz_challenge(
    p_user_id uuid,
    p_test_id text,
    p_level text,
    p_questions jsonb,
    p_now timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
    v_challenge_id uuid;
    v_question_id uuid;
    v_item jsonb;
    v_ordinal integer;
    v_meaning_id uuid;
    v_cache_id uuid;
    v_stem text;
    v_meaning_ids uuid[] := '{}'::uuid[];
    v_cache_ids uuid[] := '{}'::uuid[];
    v_now timestamptz := coalesce(p_now, now());
    v_cache public.question_cache%rowtype;
    v_word public.words%rowtype;
begin
    if p_user_id is null or not exists (select 1 from public.users where id = p_user_id) then
        raise exception 'FORMAL_CHALLENGE_USER_INVALID';
    end if;
    if p_test_id is null or btrim(p_test_id) = '' then
        raise exception 'FORMAL_CHALLENGE_TEST_ID_REQUIRED';
    end if;
    if p_level is null or btrim(p_level) = '' then
        raise exception 'FORMAL_CHALLENGE_LEVEL_REQUIRED';
    end if;
    if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) not between 1 and 10 then
        raise exception 'FORMAL_CHALLENGE_COUNT_INVALID';
    end if;

    for v_item, v_ordinal in
        select value, ordinality::integer
        from jsonb_array_elements(p_questions) with ordinality
    loop
        begin
            v_meaning_id := nullif(v_item->>'meaning_id', '')::uuid;
            v_cache_id := nullif(v_item->>'cache_question_id', '')::uuid;
        exception when invalid_text_representation then
            raise exception 'FORMAL_CHALLENGE_CANONICAL_ID_INVALID';
        end;
        if jsonb_array_length(p_questions) < 10 and
           (v_item->>'challengeSize')::integer is distinct from jsonb_array_length(p_questions) then
            raise exception 'FORMAL_CHALLENGE_COUNT_INVALID';
        end if;
        v_stem := nullif(btrim(v_item->>'stem'), '');
        if v_meaning_id is null or v_cache_id is null or v_stem is null then
            raise exception 'FORMAL_CHALLENGE_QUESTION_INVALID';
        end if;
        if v_meaning_id = any(v_meaning_ids) or v_cache_id = any(v_cache_ids) then
            raise exception 'FORMAL_CHALLENGE_DUPLICATE_MEANING_OR_CACHE';
        end if;
        v_meaning_ids := array_append(v_meaning_ids, v_meaning_id);
        v_cache_ids := array_append(v_cache_ids, v_cache_id);

        select * into v_word
        from public.active_words
        where id = v_meaning_id and user_id = p_user_id
        for update;
        if not found or lower(v_word.mastery_status::text) = 'mastered'
           or v_word.entered_at is null or v_word.entered_at > v_now - interval '18 hours' then
            raise exception 'FORMAL_CHALLENGE_MEANING_COOLDOWN';
        end if;

        select * into v_cache
        from public.question_cache
        where id = v_cache_id and user_id = p_user_id and word_id = v_meaning_id
        for update;
        if not found or v_cache.quality_status::text <> 'ready'
           or v_cache.cache_state::text not in ('active', 'reserved_next_day')
           or (v_cache.cache_state::text = 'reserved_next_day'
               and (v_cache.available_from is null or v_cache.available_from > v_now)) then
            raise exception 'FORMAL_CHALLENGE_CACHE_NOT_READY';
        end if;
        if v_cache.level::text <> p_level then raise exception 'FORMAL_CHALLENGE_LEVEL_MISMATCH'; end if;
        if v_cache.question_type::text = '1'
           and lower(btrim(coalesce(v_cache.ai_audit_status, ''))) <> 'approved' then
            raise exception 'FORMAL_CHALLENGE_CACHE_AI_AUDIT_REQUIRED';
        end if;
        if exists (
            select 1 from public.quiz_display_events
            where user_id = p_user_id and meaning_id = v_meaning_id
              and counts_for_cooldown
              and displayed_at > v_now - interval '18 hours'
        ) then
            raise exception 'FORMAL_CHALLENGE_DISPLAY_COOLDOWN';
        end if;
        if exists (
            select 1 from public.quiz_display_events
            where user_id = p_user_id and meaning_id = v_meaning_id
              and history_expires_at > v_now
              and regexp_replace(lower(btrim(stem)), '\s+', ' ', 'g') =
                  regexp_replace(lower(v_stem), '\s+', ' ', 'g')
        ) then
            raise exception 'FORMAL_CHALLENGE_STEM_REUSED';
        end if;
    end loop;

    insert into public.quiz_challenges (test_id, user_id, mode, level, status, created_at, expires_at)
    values (btrim(p_test_id), p_user_id, 'real', p_level, 'active', v_now, v_now + interval '24 hours')
    returning id into v_challenge_id;

    for v_item, v_ordinal in
        select value, ordinality::integer
        from jsonb_array_elements(p_questions) with ordinality
    loop
        v_meaning_id := (v_item->>'meaning_id')::uuid;
        v_cache_id := (v_item->>'cache_question_id')::uuid;
        v_stem := btrim(v_item->>'stem');
        insert into public.quiz_challenge_questions (
            challenge_id, ordinal, meaning_id, cache_question_id,
            question_fingerprint, stem, question_snapshot, displayed_at, history_expires_at
        ) values (
            v_challenge_id, v_ordinal, v_meaning_id, v_cache_id,
            nullif(v_item->>'question_fingerprint', ''), v_stem, v_item,
            v_now, v_now + interval '30 days'
        ) returning id into v_question_id;
        insert into public.quiz_display_events (
            challenge_id, challenge_question_id, user_id, meaning_id, cache_question_id,
            question_fingerprint, stem, displayed_at, history_expires_at
        ) values (
            v_challenge_id, v_question_id, p_user_id, v_meaning_id, v_cache_id,
            nullif(v_item->>'question_fingerprint', ''), v_stem, v_now, v_now + interval '30 days'
        );
    end loop;

    return jsonb_build_object(
        'challenge_id', v_challenge_id,
        'test_id', btrim(p_test_id),
        'mode', 'real',
        'level', p_level,
        'question_count', jsonb_array_length(p_questions),
        'displayed_at', v_now
    );
end;
$$;

-- reconcile_word_mastery_status: retain 20260814_reconcile_word_mastery_status.sql behavior; exclude archived meanings.
create or replace function public.reconcile_word_mastery_status(
    p_user_id uuid,
    p_word_id uuid,
    p_expected_mastery_status text,
    p_expected_remembered_at timestamptz,
    p_new_mastery_status text,
    p_new_remembered_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_now timestamptz := clock_timestamp();
    v_word public.words%rowtype;
    v_new_version bigint;
    v_crosses_mastered boolean;
begin
    if p_expected_mastery_status not in ('pending', 'recognized', 'consolidating', 'mastered')
       or p_new_mastery_status not in ('pending', 'recognized', 'consolidating', 'mastered') then
        raise exception 'INVALID_MASTERY_STATUS' using errcode = '22023';
    end if;

    select word.*
    into v_word
    from public.active_words as word
    where word.id = p_word_id
      and word.user_id = p_user_id
    for update;

    if not found
       or v_word.mastery_status::text is distinct from p_expected_mastery_status
       or v_word.remembered_at is distinct from p_expected_remembered_at then
        return false;
    end if;

    v_crosses_mastered := (v_word.mastery_status::text = 'mastered')
        is distinct from (p_new_mastery_status = 'mastered');

    if not v_crosses_mastered then
        update public.words as word
        set mastery_status = p_new_mastery_status::public.mastery_status,
            remembered_at = p_new_remembered_at,
            updated_at = v_now
        where word.id = p_word_id
          and word.user_id = p_user_id;
        return true;
    end if;

    update public.words as word
    set mastery_status = p_new_mastery_status::public.mastery_status,
        remembered_at = p_new_remembered_at,
        question_generation_version = greatest(1, word.question_generation_version) + 1,
        updated_at = v_now
    where word.id = p_word_id
      and word.user_id = p_user_id
    returning word.question_generation_version into v_new_version;

    perform public.retire_or_delete_word_question_cache(p_user_id, p_word_id);

    if p_new_mastery_status = 'mastered' then
        delete from public.question_generation_jobs as job
        where job.user_id = p_user_id
          and job.word_id = p_word_id;
        return true;
    end if;

    insert into public.question_generation_jobs (
        user_id, word_id, word_version, status, reason, attempt_count,
        next_attempt_at, lease_owner, lease_expires_at, lease_token,
        last_error_code, last_error_detail, rejection_reasons, updated_at
    ) values (
        p_user_id, p_word_id, v_new_version, 'pending', 'word_edit', 0,
        v_now, null, null, null, null, null, '{}'::jsonb, v_now
    )
    on conflict (word_id) do update
    set user_id = excluded.user_id,
        word_version = excluded.word_version,
        status = excluded.status,
        reason = excluded.reason,
        attempt_count = excluded.attempt_count,
        next_attempt_at = excluded.next_attempt_at,
        lease_owner = null,
        lease_expires_at = null,
        lease_token = null,
        last_error_code = null,
        last_error_detail = null,
        rejection_reasons = '{}'::jsonb,
        updated_at = excluded.updated_at;

    return true;
end;
$$;

-- save_question_generation_checkpoint: retain 20260910_question_generation_checkpoints.sql behavior; exclude archived meanings.
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
    from public.active_words as word
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

-- request_challenge_question_supply: retain 20261010_challenge_demand_priority.sql behavior; exclude archived meanings.
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
           select 1 from public.active_words word where word.id = requested.id and word.user_id = p_user_id
       )) then
        raise exception 'CHALLENGE_SELECTION_INVALID';
    end if;
    -- Match the edit path's word-before-job lock order; never bypass its fence.
    for v_id in select word.id from public.active_words word
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
          and job.word_version = (select word.question_generation_version from public.active_words word where word.id = v_id);
        return query select job.* from public.question_generation_jobs job where job.word_id = v_id and job.user_id = p_user_id;
    end loop;
end;
$$;

-- The service first verifies a parent session; the RPC verifies ownership
-- for every requested record before any mutation. Repeats are idempotent.
create or replace function public.archive_words(p_user_id uuid, p_record_ids text[])
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_ids uuid[];
    v_id uuid;
    v_deleted integer := 0;
begin
    if p_user_id is null or coalesce(cardinality(p_record_ids), 0) not between 1 and 100
       or exists (select 1 from unnest(p_record_ids) id where id is null or btrim(id) = '') then
        raise exception 'WORD_SELECTION_INVALID' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(p_record_ids) as requested(id) where not exists (
        select 1 from public.words word where word.user_id = p_user_id
          and (word.id::text = requested.id or to_jsonb(word)->>'feishu_record_id' = requested.id)
    )) then
        raise exception 'WORD_NOT_FOUND' using errcode = '22023';
    end if;
    -- Lock all targets in stable order, matching generation's word-before-job order.
    select array_agg(locked.id) into v_ids from (
        select word.id from public.words word where word.user_id = p_user_id
          and (word.id::text = any(p_record_ids) or to_jsonb(word)->>'feishu_record_id' = any(p_record_ids))
        order by word.id for update
    ) locked;
    foreach v_id in array v_ids loop
        if exists (select 1 from public.words where id=v_id and deleted_at is null) then
            update public.words set deleted_at=clock_timestamp(), updated_at=clock_timestamp(),
                question_generation_version=greatest(1, question_generation_version)+1
                where id=v_id and user_id=p_user_id;
            -- Old/migrated history may hydrate its analysis from a cache even
            -- without a challenge FK. Preserve every row; none stays selectable.
            update public.question_cache set cache_state='retired', updated_at=clock_timestamp()
                where word_id=v_id and user_id=p_user_id;
            delete from public.question_generation_jobs where word_id=v_id and user_id=p_user_id;
            v_deleted := v_deleted + 1;
        end if;
    end loop;
    return jsonb_build_object('success', true, 'deleted', v_deleted, 'recordIds', to_jsonb(p_record_ids));
end;
$$;
revoke all on function public.archive_words(uuid, text[]) from public, anon, authenticated, service_role;
grant execute on function public.archive_words(uuid, text[]) to service_role;

notify pgrst, 'reload schema';
commit;
