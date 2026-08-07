begin;

alter table public.quiz_challenges
    drop constraint if exists quiz_challenges_status_valid;
alter table public.quiz_challenges
    add constraint quiz_challenges_status_valid
    check (status in ('active', 'replacement_pending', 'submitted', 'void'));

create or replace function public.invalidate_formal_quiz_question(
    p_user_id uuid,
    p_test_id text,
    p_challenge_question_id uuid,
    p_reason text,
    p_now timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
    v_challenge_id uuid;
    v_cache_question_id uuid;
    v_now timestamptz := coalesce(p_now, now());
    v_invalidated integer;
begin
    if p_user_id is null or p_challenge_question_id is null then
        raise exception 'FORMAL_BAD_QUESTION_ID_REQUIRED';
    end if;
    if p_test_id is null or btrim(p_test_id) = '' then
        raise exception 'FORMAL_CHALLENGE_TEST_ID_REQUIRED';
    end if;
    if p_reason is null or btrim(p_reason) = '' then
        raise exception 'FORMAL_CHALLENGE_INVALID_REASON_REQUIRED';
    end if;

    select c.id, q.cache_question_id
      into v_challenge_id, v_cache_question_id
      from public.quiz_challenges c
      join public.quiz_challenge_questions q on q.challenge_id = c.id
     where c.user_id = p_user_id
       and c.test_id = btrim(p_test_id)
       and c.status in ('active', 'replacement_pending')
       and q.id = p_challenge_question_id
     for update;
    if not found then
        raise exception 'FORMAL_CHALLENGE_QUESTION_NOT_ACTIVE';
    end if;

    update public.quiz_display_events
       set invalidated_at = coalesce(invalidated_at, v_now),
           invalid_reason = coalesce(invalid_reason, btrim(p_reason)),
           counts_for_cooldown = false
     where challenge_id = v_challenge_id
       and challenge_question_id = p_challenge_question_id
       and invalidated_at is null;
    get diagnostics v_invalidated = row_count;
    if v_invalidated = 0 then
        raise exception 'FORMAL_BAD_QUESTION_ALREADY_INVALIDATED';
    end if;

    update public.question_cache
       set cache_state = 'replace_pending', updated_at = v_now
     where id = v_cache_question_id
       and user_id = p_user_id;

    update public.quiz_challenges
       set status = 'replacement_pending'
     where id = v_challenge_id;

    return jsonb_build_object(
        'invalidated', true,
        'replacement_required', true,
        'challenge_id', v_challenge_id,
        'challenge_question_id', p_challenge_question_id,
        'cache_question_id', v_cache_question_id
    );
end;
$$;

create or replace function public.replace_formal_quiz_question(
    p_user_id uuid,
    p_test_id text,
    p_challenge_question_id uuid,
    p_cache_question_id uuid,
    p_stem text,
    p_question_fingerprint text,
    p_question_snapshot jsonb,
    p_now timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
    v_challenge_id uuid;
    v_meaning_id uuid;
    v_old_cache_question_id uuid;
    v_now timestamptz := coalesce(p_now, now());
    v_available_from timestamptz;
begin
    if p_user_id is null or p_challenge_question_id is null or p_cache_question_id is null then
        raise exception 'FORMAL_REPLACEMENT_ID_REQUIRED';
    end if;
    if p_test_id is null or btrim(p_test_id) = '' then
        raise exception 'FORMAL_CHALLENGE_TEST_ID_REQUIRED';
    end if;
    if p_stem is null or btrim(p_stem) = '' or jsonb_typeof(p_question_snapshot) <> 'object' then
        raise exception 'FORMAL_REPLACEMENT_QUESTION_INVALID';
    end if;

    select c.id, q.meaning_id, q.cache_question_id
      into v_challenge_id, v_meaning_id, v_old_cache_question_id
      from public.quiz_challenges c
      join public.quiz_challenge_questions q on q.challenge_id = c.id
     where c.user_id = p_user_id
       and c.test_id = btrim(p_test_id)
       and c.status in ('active', 'replacement_pending')
       and q.id = p_challenge_question_id
       and exists (
           select 1 from public.quiz_display_events e
            where e.challenge_id = c.id
              and e.challenge_question_id = q.id
              and e.invalidated_at is not null
       )
     for update;
    if not found then
        raise exception 'FORMAL_REPLACEMENT_QUESTION_NOT_PENDING';
    end if;

    select available_from into v_available_from
      from public.question_cache
     where id = p_cache_question_id
       and user_id = p_user_id
       and word_id = v_meaning_id
       and quality_status::text = 'ready'
       and cache_state::text in ('active', 'reserved_next_day')
       -- A reserved backup is normally delayed until its scheduled day. A
       -- voided formal question is the explicit exception: it never counted
       -- for learning or cooldown, so replacement must be immediate.
     for update;
    if not found then
        raise exception 'FORMAL_REPLACEMENT_CACHE_NOT_READY';
    end if;
    if p_cache_question_id = v_old_cache_question_id then
        raise exception 'FORMAL_REPLACEMENT_CACHE_MUST_DIFFER';
    end if;
    if exists (
        select 1 from public.quiz_display_events e
         where e.user_id = p_user_id
           and e.meaning_id = v_meaning_id
           and e.counts_for_cooldown
           and e.displayed_at > v_now - interval '18 hours'
    ) then
        raise exception 'FORMAL_REPLACEMENT_DISPLAY_COOLDOWN';
    end if;

    update public.question_cache set cache_state = 'retired', updated_at = v_now
     where id = v_old_cache_question_id and user_id = p_user_id;
    update public.question_cache set cache_state = 'active', available_from = null, updated_at = v_now
     where id = p_cache_question_id and user_id = p_user_id;
    update public.quiz_challenge_questions
       set cache_question_id = p_cache_question_id,
           question_fingerprint = nullif(btrim(p_question_fingerprint), ''),
           stem = btrim(p_stem),
           question_snapshot = p_question_snapshot,
           displayed_at = v_now,
           history_expires_at = v_now + interval '30 days'
     where id = p_challenge_question_id and challenge_id = v_challenge_id;
    update public.quiz_challenges
       set status = 'active'
     where id = v_challenge_id;
    insert into public.quiz_display_events (
        challenge_id, challenge_question_id, user_id, meaning_id, cache_question_id,
        question_fingerprint, stem, displayed_at, history_expires_at
    ) values (
        v_challenge_id, p_challenge_question_id, p_user_id, v_meaning_id, p_cache_question_id,
        nullif(btrim(p_question_fingerprint), ''), btrim(p_stem), v_now, v_now + interval '30 days'
    );

    return jsonb_build_object(
        'replaced', true,
        'challenge_id', v_challenge_id,
        'challenge_question_id', p_challenge_question_id,
        'cache_question_id', p_cache_question_id,
        'displayed_at', v_now
    );
end;
$$;

revoke all on function public.invalidate_formal_quiz_question(uuid, text, uuid, text, timestamptz)
    from public, anon, authenticated;
grant execute on function public.invalidate_formal_quiz_question(uuid, text, uuid, text, timestamptz)
    to service_role;
revoke all on function public.replace_formal_quiz_question(uuid, text, uuid, uuid, text, text, jsonb, timestamptz)
    from public, anon, authenticated;
grant execute on function public.replace_formal_quiz_question(uuid, text, uuid, uuid, text, text, jsonb, timestamptz)
    to service_role;

notify pgrst, 'reload schema';
commit;
