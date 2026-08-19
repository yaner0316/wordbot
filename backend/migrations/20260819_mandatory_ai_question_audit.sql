begin;

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

revoke all on function public.publish_question_generation_variants(uuid, text, bigint, uuid, jsonb)
    from public, anon, authenticated;
grant execute on function public.publish_question_generation_variants(uuid, text, bigint, uuid, jsonb)
    to service_role;

notify pgrst, 'reload schema';

commit;
