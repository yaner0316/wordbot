begin;

alter table public.words
    add column if not exists question_generation_version bigint not null default 1;

alter table public.question_generation_jobs
    add column if not exists word_version bigint not null default 1,
    add column if not exists lease_token uuid;

drop function if exists public.renew_question_generation_job(uuid, text, bigint);
drop function if exists public.publish_question_generation_variants(uuid, text, jsonb);
drop function if exists public.complete_question_generation_job(uuid, text);
drop function if exists public.fail_question_generation_job(
    uuid, text, integer, bigint, bigint, text, text, jsonb
);

do $$
begin
    if not exists (
        select 1
        from pg_catalog.pg_constraint
        where conrelid = 'public.words'::regclass
          and conname = 'words_question_generation_version_positive'
    ) then
        alter table public.words
            add constraint words_question_generation_version_positive
            check (question_generation_version > 0);
    end if;

    if not exists (
        select 1
        from pg_catalog.pg_constraint
        where conrelid = 'public.question_generation_jobs'::regclass
          and conname = 'question_generation_jobs_word_version_positive'
    ) then
        alter table public.question_generation_jobs
            add constraint question_generation_jobs_word_version_positive
            check (word_version > 0);
    end if;
end;
$$;

update public.question_generation_jobs as job
set word_version = word.question_generation_version
from public.words as word
where word.id = job.word_id
  and word.user_id = job.user_id
  and job.word_version is distinct from word.question_generation_version;

-- Formal challenge questions retain a restricted reference to their cache
-- snapshot. Retire referenced rows and physically delete only unreferenced
-- rows. Use dynamic SQL because this migration runs before the formal
-- challenge table on a fresh database.
do $$
begin
    if to_regclass('public.quiz_challenge_questions') is null then
        execute $sql$
            delete from public.question_cache as cache
            using public.words as word
            where word.id = cache.word_id
              and word.user_id = cache.user_id
              and (
                  word.mastery_status = 'mastered'
                  or lower(btrim(word.word)) = 'genaine'
                  or btrim(word.word) !~* '^[a-z]+([ ''-][a-z]+)*$'
              )
        $sql$;
    else
        execute $sql$
            update public.question_cache as cache
            set cache_state = 'retired',
                updated_at = clock_timestamp()
            from public.words as word
            where word.id = cache.word_id
              and word.user_id = cache.user_id
              and (
                  word.mastery_status = 'mastered'
                  or lower(btrim(word.word)) = 'genaine'
                  or btrim(word.word) !~* '^[a-z]+([ ''-][a-z]+)*$'
              )
              and exists (
                  select 1
                  from public.quiz_challenge_questions as challenge_question
                  where challenge_question.cache_question_id = cache.id
              )
        $sql$;

        execute $sql$
            delete from public.question_cache as cache
            using public.words as word
            where word.id = cache.word_id
              and word.user_id = cache.user_id
              and (
                  word.mastery_status = 'mastered'
                  or lower(btrim(word.word)) = 'genaine'
                  or btrim(word.word) !~* '^[a-z]+([ ''-][a-z]+)*$'
              )
              and not exists (
                  select 1
                  from public.quiz_challenge_questions as challenge_question
                  where challenge_question.cache_question_id = cache.id
              )
        $sql$;
    end if;
end;
$$;

delete from public.question_generation_jobs as job
using public.words as word
where word.id = job.word_id
  and word.user_id = job.user_id
  and (
      word.mastery_status = 'mastered'
      or lower(btrim(word.word)) = 'genaine'
      or btrim(word.word) !~* '^[a-z]+([ ''-][a-z]+)*$'
  );

create or replace function public.wordbot_question_generation_revision()
returns text
language sql
immutable
security invoker
set search_path = public
as $$
    select '20260806-versioned-word-edit'::text
$$;

create or replace function public.enqueue_question_generation_job_for_new_word()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.mastery_status = 'mastered'
       or lower(btrim(new.word)) = 'genaine'
       or btrim(new.word) !~* '^[a-z]+([ ''-][a-z]+)*$' then
        return new;
    end if;

    insert into public.question_generation_jobs (
        user_id,
        word_id,
        word_version,
        status,
        reason,
        next_attempt_at
    ) values (
        new.user_id,
        new.id,
        new.question_generation_version,
        'pending',
        'word_entry',
        clock_timestamp()
    ) on conflict (word_id) do nothing;
    return new;
end;
$$;

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
    from public.words as word
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
        user_id,
        word_id,
        word_version,
        status,
        reason,
        attempt_count,
        next_attempt_at,
        lease_owner,
        lease_expires_at,
        last_error_code,
        last_error_detail,
        rejection_reasons,
        updated_at
    ) values (
        p_user_id,
        p_word_id,
        v_version,
        'pending',
        'word_edit',
        0,
        timestamptz '9999-12-31 23:59:59.999+00',
        null,
        null,
        null,
        null,
        '{}'::jsonb,
        v_now
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

    delete from public.question_cache as cache
    where cache.user_id = p_user_id
      and cache.word_id = p_word_id;

    return v_version;
end;
$$;

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
    from public.words as word
    where word.id = p_word_id
      and word.user_id = p_user_id
    for update;
    if not found then
        return false;
    end if;

    if v_word.mastery_status = 'mastered'
       or lower(btrim(v_word.word)) = 'genaine'
       or btrim(v_word.word) !~* '^[a-z]+([ ''-][a-z]+)*$' then
        delete from public.question_cache as cache
        where cache.user_id = p_user_id
          and cache.word_id = p_word_id;

        delete from public.question_generation_jobs as job
        where job.user_id = p_user_id
          and job.word_id = p_word_id;
        return false;
    end if;

    insert into public.question_generation_jobs (
        user_id,
        word_id,
        word_version,
        status,
        reason,
        attempt_count,
        next_attempt_at,
        lease_owner,
        lease_expires_at,
        last_error_code,
        last_error_detail,
        rejection_reasons,
        updated_at
    ) values (
        p_user_id,
        p_word_id,
        v_word.question_generation_version,
        'pending',
        'word_edit',
        0,
        v_now,
        null,
        null,
        null,
        null,
        '{}'::jsonb,
        v_now
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

create or replace function public.claim_question_generation_jobs(
    p_worker_id text,
    p_limit integer,
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
    if coalesce(trim(p_worker_id), '') = '' then
        raise exception 'WORKER_ID_REQUIRED';
    end if;
    v_lease_duration := make_interval(
        secs => greatest(1, coalesce(p_lease_duration_ms, 60000))::double precision / 1000.0
    );

    return query
    with due as (
        select job.id
        from public.question_generation_jobs as job
        join public.words as word
          on word.id = job.word_id
         and word.user_id = job.user_id
         and word.question_generation_version = job.word_version
        where (
            (
                job.status in ('pending', 'retry_wait')
                and job.next_attempt_at <= v_now
            ) or (
                job.status in ('generating', 'validating', 'repairing')
                and (job.lease_expires_at is null or job.lease_expires_at <= v_now)
            )
        )
          and word.mastery_status <> 'mastered'
          and lower(btrim(word.word)) <> 'genaine'
          and btrim(word.word) ~* '^[a-z]+([ ''-][a-z]+)*$'
        order by job.next_attempt_at asc, job.created_at asc, job.id asc
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
      and word.mastery_status <> 'mastered'
      and lower(btrim(word.word)) <> 'genaine'
      and btrim(word.word) ~* '^[a-z]+([ ''-][a-z]+)*$'
    returning job.*;
end;
$$;

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
    from public.words as word
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

create or replace function public.complete_question_generation_job(
    p_job_id uuid,
    p_worker_id text,
    p_expected_word_version bigint,
    p_lease_token uuid
)
returns setof public.question_generation_jobs
language plpgsql
security definer
set search_path = public
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
      and word.mastery_status <> 'mastered'
      and lower(btrim(word.word)) <> 'genaine'
      and btrim(word.word) ~* '^[a-z]+([ ''-][a-z]+)*$'
    returning job.*;
end;
$$;

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
set search_path = public
as $$
declare
    v_now timestamptz := clock_timestamp();
    v_job public.question_generation_jobs%rowtype;
    v_backoff_ms bigint;
    v_manual_review boolean;
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
      and word.mastery_status <> 'mastered'
      and lower(btrim(word.word)) <> 'genaine'
      and btrim(word.word) ~* '^[a-z]+([ ''-][a-z]+)*$'
    for update of job;
    if not found then
        return;
    end if;

    v_manual_review := v_job.attempt_count >= greatest(1, coalesce(p_max_attempts, 5));
    v_backoff_ms := least(
        greatest(1, coalesce(p_max_backoff_ms, 3600000)),
        greatest(1, coalesce(p_base_backoff_ms, 60000))
            * (2 ^ greatest(0, least(v_job.attempt_count - 1, 30)))
    );

    return query
    update public.question_generation_jobs as job
    set status = case when v_manual_review then 'needs_manual_review' else 'retry_wait' end,
        next_attempt_at = case
            when v_manual_review then v_now
            else v_now + make_interval(secs => v_backoff_ms::double precision / 1000.0)
        end,
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

create or replace function public.enqueue_question_generation_job_if_needed(
    p_user_id uuid,
    p_word_id uuid,
    p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_word public.words%rowtype;
    v_ready_fingerprints integer := 0;
    v_ready_questions integer := 0;
    v_affected integer := 0;
begin
    select word.*
    into v_word
    from public.words as word
    where word.id = p_word_id
      and word.user_id = p_user_id
    for update;
    if not found then
        return false;
    end if;

    if v_word.mastery_status = 'mastered'
       or lower(btrim(v_word.word)) = 'genaine'
       or btrim(v_word.word) !~* '^[a-z]+([ ''-][a-z]+)*$' then
        return false;
    end if;

    select
        count(distinct question_fingerprint),
        count(distinct regexp_replace(lower(btrim(question_text)), '\s+', ' ', 'g'))
    into v_ready_fingerprints, v_ready_questions
    from public.question_cache
    where user_id = p_user_id
      and word_id = p_word_id
      and round_type = 'primary'
      and quality_status = 'ready'
      and cache_state in ('active', 'reserved_next_day')
      and question_type = '1'
      and jsonb_typeof(options) = 'array'
      and jsonb_array_length(options) = 4
      and jsonb_typeof(option_meanings) = 'array'
      and jsonb_array_length(option_meanings) = 4
      and answer in ('A', 'B', 'C', 'D')
      and btrim(question_text) <> ''
      and not exists (
          select 1
          from jsonb_array_elements_text(options) as option_value(value)
          where option_value.value !~ '^[A-D]\.\s+\S'
      )
      and not exists (
          select 1
          from jsonb_array_elements_text(option_meanings) as meaning_value(value)
          where btrim(meaning_value.value) = ''
             or meaning_value.value !~ U&'[\4E00-\9FFF]'
      )
      and btrim(correct_meaning) <> ''
      and question_fingerprint is not null;

    if coalesce(nullif(p_reason, ''), '') = 'cache_backfill'
       or v_ready_fingerprints < 2
       or v_ready_questions < 2 then
        insert into public.question_generation_jobs (
            user_id, word_id, word_version, status, reason, next_attempt_at
        ) values (
            p_user_id,
            p_word_id,
            v_word.question_generation_version,
            'pending',
            coalesce(nullif(p_reason, ''), 'backfill'),
            clock_timestamp()
        )
        on conflict (word_id) do update
        set user_id = excluded.user_id,
            word_version = excluded.word_version,
            status = 'pending',
            reason = excluded.reason,
            attempt_count = 0,
            next_attempt_at = clock_timestamp(),
            lease_owner = null,
            lease_expires_at = null,
            lease_token = null,
            last_error_code = null,
            last_error_detail = null,
            rejection_reasons = '{}'::jsonb,
            updated_at = clock_timestamp()
        where question_generation_jobs.word_version <> excluded.word_version
           or question_generation_jobs.status in ('ready', 'needs_manual_review');
        get diagnostics v_affected = row_count;
    end if;
    return v_affected > 0;
end;
$$;

revoke all on function public.wordbot_question_generation_revision()
    from public, anon, authenticated;
grant execute on function public.wordbot_question_generation_revision()
    to service_role;

revoke all on function public.enqueue_question_generation_job_for_new_word()
    from public, anon, authenticated;

revoke all on function public.fence_word_question_generation(uuid, uuid)
    from public, anon, authenticated;
grant execute on function public.fence_word_question_generation(uuid, uuid)
    to service_role;

revoke all on function public.finalize_word_question_generation_edit(uuid, uuid)
    from public, anon, authenticated;
grant execute on function public.finalize_word_question_generation_edit(uuid, uuid)
    to service_role;

revoke all on function public.claim_question_generation_jobs(text, integer, bigint)
    from public, anon, authenticated;
grant execute on function public.claim_question_generation_jobs(text, integer, bigint)
    to service_role;

revoke all on function public.renew_question_generation_job(uuid, text, bigint, uuid, bigint)
    from public, anon, authenticated;
grant execute on function public.renew_question_generation_job(uuid, text, bigint, uuid, bigint)
    to service_role;

revoke all on function public.publish_question_generation_variants(uuid, text, bigint, uuid, jsonb)
    from public, anon, authenticated;
grant execute on function public.publish_question_generation_variants(uuid, text, bigint, uuid, jsonb)
    to service_role;

revoke all on function public.complete_question_generation_job(uuid, text, bigint, uuid)
    from public, anon, authenticated;
grant execute on function public.complete_question_generation_job(uuid, text, bigint, uuid)
    to service_role;

revoke all on function public.fail_question_generation_job(uuid, text, bigint, uuid, integer, bigint, bigint, text, text, jsonb)
    from public, anon, authenticated;
grant execute on function public.fail_question_generation_job(uuid, text, bigint, uuid, integer, bigint, bigint, text, text, jsonb)
    to service_role;

revoke all on function public.enqueue_question_generation_job_if_needed(uuid, uuid, text)
    from public, anon, authenticated, service_role;
grant execute on function public.enqueue_question_generation_job_if_needed(uuid, uuid, text)
    to service_role;

notify pgrst, 'reload schema';

commit;
