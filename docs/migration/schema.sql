begin;

create type public.wordbot_level as enum ('小学', '中学', '高中', 'CET4_6_TOEFL');
create type public.question_type as enum ('1', '2', '3', '4');
create type public.round_type as enum ('primary', 'review');
create type public.question_quality_status as enum ('pending', 'ready', 'failed', 'stale');
create type public.correctness_status as enum ('correct', 'wrong');
create type public.mastery_status as enum ('pending', 'recognized', 'consolidating', 'mastered');
create type public.multi_definition_status as enum ('yes', 'no', 'unknown');
create type public.answer_confidence as enum ('sure', 'guess');
create type public.question_source as enum ('question_cache', 'live_fallback');

create table public.users (
    id uuid primary key default gen_random_uuid(),
    feishu_record_id text unique,
    username text not null,
    username_key text generated always as (
        lower(regexp_replace(btrim(username), '[[:space:]]+', '', 'g'))
    ) stored,
    password_hash text,
    password_salt text,
    auth_created_at timestamptz,
    parent_username text,
    parent_username_key text generated always as (
        case
            when parent_username is null then null
            else lower(regexp_replace(btrim(parent_username), '[[:space:]]+', '', 'g'))
        end
    ) stored,
    parent_password_hash text,
    parent_password_salt text,
    parent_created_at timestamptz,
    phone text,
    phone_verified_at timestamptz,
    learning_level public.wordbot_level,
    level_changed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint users_username_not_blank check (username_key <> ''),
    constraint users_username_key_unique unique (username_key),
    constraint users_child_credentials_complete check (
        (password_hash is null) = (password_salt is null)
    ),
    constraint users_parent_credentials_complete check (
        (parent_password_hash is null) = (parent_password_salt is null)
    ),
    constraint users_parent_identity_complete check (
        (parent_password_hash is null and parent_username is null)
        or (parent_password_hash is not null and parent_username_key <> '')
    )
);

create table public.words (
    id uuid primary key default gen_random_uuid(),
    feishu_record_id text unique,
    user_id uuid not null references public.users(id) on delete cascade,
    word text not null,
    meaning_en text not null,
    meaning_zh text,
    context_en text,
    context_zh text,
    distractors jsonb not null default '[]'::jsonb,
    old_distractors jsonb not null default '[]'::jsonb,
    level public.wordbot_level,
    mastery_status public.mastery_status not null default 'pending',
    multi_definition public.multi_definition_status,
    source_multi_definition_option_id text,
    error_count integer not null default 0,
    quality_flags text[] not null default '{}'::text[],
    quality_note text,
    entered_at timestamptz not null,
    remembered_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint words_word_not_blank check (btrim(word) <> ''),
    constraint words_meaning_not_blank check (btrim(meaning_en) <> ''),
    constraint words_error_count_nonnegative check (error_count >= 0),
    constraint words_distractors_array check (jsonb_typeof(distractors) = 'array'),
    constraint words_old_distractors_array check (jsonb_typeof(old_distractors) = 'array'),
    constraint words_id_user_unique unique (id, user_id)
);

create table public.parts_of_speech (
    id smallint generated always as identity primary key,
    code text not null unique,
    display_name text not null,
    constraint parts_of_speech_code_not_blank check (btrim(code) <> ''),
    constraint parts_of_speech_display_name_not_blank check (btrim(display_name) <> '')
);

create table public.word_parts_of_speech (
    word_id uuid not null references public.words(id) on delete cascade,
    part_of_speech_id smallint not null references public.parts_of_speech(id) on delete restrict,
    position smallint not null default 1,
    primary key (word_id, part_of_speech_id),
    constraint word_parts_of_speech_position_positive check (position > 0),
    constraint word_parts_of_speech_word_position_unique unique (word_id, position)
);

insert into public.parts_of_speech (code, display_name) values
    ('noun', 'noun'),
    ('verb', 'verb'),
    ('adjective', 'adjective'),
    ('adverb', 'adverb'),
    ('interjection', 'interjection'),
    ('phrasal verb', 'phrasal verb'),
    ('pronoun', 'pronoun'),
    ('suffix', 'suffix'),
    ('determiner', 'determiner'),
    ('numeral', 'numeral'),
    ('preposition', 'preposition'),
    ('verb phrase', 'verb phrase');

create table public.assessments (
    id uuid primary key default gen_random_uuid(),
    feishu_record_id text unique,
    user_id uuid not null references public.users(id) on delete cascade,
    word_id uuid references public.words(id) on delete set null,
    source_word_record_id text,
    test_id text not null,
    is_real_assessment boolean not null default true,
    assessed_at timestamptz not null,
    learning_day date not null,
    question_type public.question_type not null,
    level public.wordbot_level,
    word_snapshot text not null,
    question_text text,
    options jsonb not null default '[]'::jsonb,
    correct_answer text,
    submitted_answer text,
    answer_confidence public.answer_confidence,
    is_correct public.correctness_status,
    source public.question_source,
    assessment_kind text,
    review_round text,
    review_status text,
    source_question_id text,
    source_test_id text,
    migration_flags text[] not null default '{}'::text[],
    created_at timestamptz not null default now(),
    constraint assessments_test_id_not_blank check (btrim(test_id) <> ''),
    constraint assessments_word_snapshot_not_blank check (btrim(word_snapshot) <> ''),
    constraint assessments_options_array check (jsonb_typeof(options) = 'array'),
    constraint assessments_scored_submission_complete check (
        is_correct is null
        or (submitted_answer is not null and answer_confidence is not null)
    )
);

create table public.question_cache (
    id uuid primary key default gen_random_uuid(),
    feishu_record_id text unique,
    user_id uuid not null references public.users(id) on delete cascade,
    word_id uuid not null,
    source_word_record_id text,
    level public.wordbot_level not null,
    question_type public.question_type not null,
    round_type public.round_type not null,
    quality_status public.question_quality_status not null default 'pending',
    question_text text not null,
    context_zh text,
    suffix text,
    options jsonb not null,
    answer text not null,
    option_meanings jsonb not null,
    correct_meaning text,
    ai_audit_status text,
    source_version text,
    used_count bigint not null default 0,
    generated_at timestamptz not null default now(),
    last_used_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint question_cache_word_owner_fk
        foreign key (word_id, user_id)
        references public.words(id, user_id)
        on delete cascade,
    constraint question_cache_question_not_blank check (btrim(question_text) <> ''),
    constraint question_cache_answer_valid check (answer in ('A', 'B', 'C', 'D')),
    constraint question_cache_options_array check (jsonb_typeof(options) = 'array'),
    constraint question_cache_option_meanings_array check (jsonb_typeof(option_meanings) = 'array'),
    constraint question_cache_used_count_nonnegative check (used_count >= 0)
);

create table public.quiz_sessions (
    test_id text primary key,
    user_id uuid not null references public.users(id) on delete cascade,
    questions jsonb not null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default (now() + interval '24 hours'),
    constraint quiz_sessions_test_id_not_blank check (btrim(test_id) <> ''),
    constraint quiz_sessions_questions_array check (jsonb_typeof(questions) = 'array'),
    constraint quiz_sessions_expires_after_created check (expires_at > created_at)
);

-- Login: the unique username-key constraint supplies this index.

-- Quiz word queue: user + level + not-mastered + FIFO by original entry time.
create index words_quiz_queue_idx
    on public.words (user_id, level, entered_at, id)
    where mastery_status <> 'mastered';

-- Word grouping and administrative lookup without imposing false natural-key uniqueness.
create index words_user_word_idx
    on public.words (user_id, lower(word));

-- Same-day de-duplication for submitted real assessments.
create index assessments_same_day_dedup_idx
    on public.assessments (user_id, learning_day, word_id)
    where is_real_assessment and is_correct is not null;

-- Mastery evidence ordered chronologically for a user/meaning row.
create index assessments_mastery_evidence_idx
    on public.assessments (user_id, word_id, assessed_at)
    include (is_correct, question_type, answer_confidence)
    where is_real_assessment and is_correct is not null;

-- History screens group by test and sort newest first.
create index assessments_user_history_idx
    on public.assessments (user_id, assessed_at desc, test_id);

-- Ready cache pool: user + level + round, then least-used/oldest candidates.
create index question_cache_ready_pool_idx
    on public.question_cache (user_id, level, round_type, used_count, generated_at, id)
    include (word_id, question_type)
    where quality_status = 'ready';

-- Queue-to-cache join for each selected word, preserving duplicate cache variants.
create index question_cache_ready_word_idx
    on public.question_cache (user_id, word_id, level, round_type, used_count, generated_at, id)
    where quality_status = 'ready';

-- Source reconciliation during migration and post-cutover audits.
create index assessments_source_word_record_idx
    on public.assessments (source_word_record_id)
    where source_word_record_id is not null;

create index question_cache_source_word_record_idx
    on public.question_cache (source_word_record_id)
    where source_word_record_id is not null;

create index quiz_sessions_user_test_idx
    on public.quiz_sessions (user_id, test_id);

create index quiz_sessions_expires_at_idx
    on public.quiz_sessions (expires_at);

create or replace function public.cleanup_expired_quiz_sessions()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
    deleted_count integer;
begin
    delete from public.quiz_sessions
    where expires_at < now();

    get diagnostics deleted_count = row_count;
    return deleted_count;
end;
$$;

revoke all on function public.cleanup_expired_quiz_sessions() from public;
grant execute on function public.cleanup_expired_quiz_sessions() to service_role;

-- Supabase public-schema tables are deny-by-default until application policies are designed.
alter table public.users enable row level security;
alter table public.words enable row level security;
alter table public.parts_of_speech enable row level security;
alter table public.word_parts_of_speech enable row level security;
alter table public.assessments enable row level security;
alter table public.question_cache enable row level security;
alter table public.quiz_sessions enable row level security;

revoke all on table public.quiz_sessions from anon, authenticated;
grant all on table public.quiz_sessions to service_role;

commit;
