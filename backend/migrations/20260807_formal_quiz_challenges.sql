begin;

create table if not exists public.quiz_challenges (
    id uuid primary key default gen_random_uuid(),
    test_id text not null unique,
    user_id uuid not null references public.users(id) on delete cascade,
    mode text not null default 'real',
    level text not null,
    status text not null default 'active',
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default (now() + interval '24 hours'),
    submitted_at timestamptz,
    session_state jsonb not null default '{"currentQuestion":0,"answers":[]}'::jsonb,
    constraint quiz_challenges_test_id_not_blank check (btrim(test_id) <> ''),
    constraint quiz_challenges_mode_real check (mode = 'real'),
    constraint quiz_challenges_status_valid check (status in ('active', 'submitted', 'void')),
    constraint quiz_challenges_expires_after_created check (expires_at > created_at),
    constraint quiz_challenges_session_state_object check (jsonb_typeof(session_state) = 'object')
);

create table if not exists public.quiz_challenge_questions (
    id uuid primary key default gen_random_uuid(),
    challenge_id uuid not null references public.quiz_challenges(id) on delete cascade,
    ordinal smallint not null,
    meaning_id uuid not null references public.words(id) on delete restrict,
    cache_question_id uuid not null references public.question_cache(id) on delete restrict,
    question_fingerprint text,
    stem text not null,
    question_snapshot jsonb not null,
    displayed_at timestamptz not null default now(),
    history_expires_at timestamptz not null,
    constraint quiz_challenge_questions_ordinal_valid check (ordinal between 1 and 10),
    constraint quiz_challenge_questions_stem_not_blank check (btrim(stem) <> ''),
    constraint quiz_challenge_questions_snapshot_object check (jsonb_typeof(question_snapshot) = 'object'),
    unique (challenge_id, ordinal),
    unique (challenge_id, meaning_id),
    unique (challenge_id, cache_question_id)
);

create table if not exists public.quiz_display_events (
    id uuid primary key default gen_random_uuid(),
    challenge_id uuid not null references public.quiz_challenges(id) on delete cascade,
    challenge_question_id uuid not null references public.quiz_challenge_questions(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    meaning_id uuid not null references public.words(id) on delete restrict,
    cache_question_id uuid not null references public.question_cache(id) on delete restrict,
    question_fingerprint text,
    stem text not null,
    displayed_at timestamptz not null default now(),
    history_expires_at timestamptz not null,
    counts_for_cooldown boolean not null default true,
    invalidated_at timestamptz,
    invalid_reason text,
    constraint quiz_display_events_stem_not_blank check (btrim(stem) <> ''),
    constraint quiz_display_events_history_after_display check (history_expires_at >= displayed_at)
);

create index if not exists quiz_challenges_user_status_idx
    on public.quiz_challenges (user_id, status, created_at desc);
create index if not exists quiz_challenge_questions_meaning_idx
    on public.quiz_challenge_questions (meaning_id, displayed_at desc);
create index if not exists quiz_display_events_meaning_time_idx
    on public.quiz_display_events (user_id, meaning_id, displayed_at desc);
create index if not exists quiz_display_events_meaning_stem_idx
    on public.quiz_display_events (user_id, meaning_id, stem);

alter table public.quiz_challenges enable row level security;
alter table public.quiz_challenge_questions enable row level security;
alter table public.quiz_display_events enable row level security;

revoke all on table public.quiz_challenges from public, anon, authenticated;
revoke all on table public.quiz_challenge_questions from public, anon, authenticated;
revoke all on table public.quiz_display_events from public, anon, authenticated;
grant all on table public.quiz_challenges to service_role;
grant all on table public.quiz_challenge_questions to service_role;
grant all on table public.quiz_display_events to service_role;

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
    if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) <> 10 then
        raise exception 'FORMAL_CHALLENGE_REQUIRES_TEN';
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
        if not found or v_word.entered_at > v_now - interval '18 hours' then
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
        'question_count', 10,
        'displayed_at', v_now
    );
end;
$$;

revoke all on function public.create_formal_quiz_challenge(uuid, text, text, jsonb, timestamptz)
    from public, anon, authenticated;
grant execute on function public.create_formal_quiz_challenge(uuid, text, text, jsonb, timestamptz)
    to service_role;

notify pgrst, 'reload schema';
commit;
