begin;

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
        from public.words
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

revoke all on function public.create_formal_quiz_challenge(uuid, text, text, jsonb, timestamptz)
    from public, anon, authenticated;
grant execute on function public.create_formal_quiz_challenge(uuid, text, text, jsonb, timestamptz)
    to service_role;


commit;
