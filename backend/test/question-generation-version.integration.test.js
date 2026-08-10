'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { PGlite } = require('@electric-sql/pglite');
const { MIGRATION_PATHS, VERIFICATION_SQL } = require('../scripts/apply-question-generation-migrations');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const WORD_ID = '22222222-2222-4222-8222-222222222222';

const BASE_SCHEMA_SQL = `
create role anon;
create role authenticated;
create role service_role;

create type public.wordbot_level as enum ('elementary', 'middle', 'high', 'CET4_6_TOEFL');
create type public.question_type as enum ('1', '2', '3', '4');
create type public.round_type as enum ('primary', 'review');
create type public.question_quality_status as enum ('pending', 'ready', 'failed', 'stale');
create type public.mastery_status as enum ('pending', 'recognized', 'consolidating', 'mastered');

create table public.users (
    id uuid primary key,
    username text not null
);

create table public.words (
    id uuid primary key,
    user_id uuid not null references public.users(id) on delete cascade,
    word text not null,
    meaning_en text not null,
    meaning_zh text,
    context_en text,
    level public.wordbot_level,
    mastery_status public.mastery_status not null default 'pending',
    entered_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (id, user_id)
);

create table public.question_cache (
    id uuid primary key default gen_random_uuid(),
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
    foreign key (word_id, user_id) references public.words(id, user_id) on delete cascade
);

insert into public.users (id, username) values ('${USER_ID}', 'qiuqiu');
insert into public.words (id, user_id, word, meaning_en, context_en, level)
values ('${WORD_ID}', '${USER_ID}', 'apple', 'a fruit', 'The child ate an apple.', 'middle');
`;

function variantsJson() {
    return JSON.stringify([
        {
            source_word_record_id: 'rec-apple',
            level: 'middle',
            question_type: '1',
            question_text: 'The child ate an ___ after school.',
            context_zh: 'The child ate an apple after school.',
            options: ['A. apple', 'B. pear', 'C. plum', 'D. peach'],
            answer: 'A',
            option_meanings: ['apple meaning', 'pear meaning', 'plum meaning', 'peach meaning'],
            correct_meaning: 'a fruit',
            question_fingerprint: 'apple-v1-a',
        },
        {
            source_word_record_id: 'rec-apple',
            level: 'middle',
            question_type: '1',
            question_text: 'She packed an ___ in her lunch box.',
            context_zh: 'She packed an apple in her lunch box.',
            options: ['A. apple', 'B. grape', 'C. melon', 'D. lemon'],
            answer: 'A',
            option_meanings: ['apple meaning', 'grape meaning', 'melon meaning', 'lemon meaning'],
            correct_meaning: 'a fruit',
            question_fingerprint: 'apple-v1-b',
        },
    ]);
}

async function createDatabase() {
    const db = new PGlite();
    await db.exec(BASE_SCHEMA_SQL);
    for (const migrationPath of MIGRATION_PATHS) {
        await db.exec(await fs.readFile(migrationPath, 'utf8'));
    }
    return db;
}

async function fenceWord(db) {
    await db.query(
        'select * from public.fence_word_question_generation($1::uuid, $2::uuid)',
        [USER_ID, WORD_ID]
    );
}

test('migration verification SQL executes against the real versioned PGlite schema', async () => {
    const db = await createDatabase();
    try {
        const result = await db.query(VERIFICATION_SQL);
        assert.equal(result.rows[0].job_lease_token_column, true);
    } finally {
        await db.close();
    }
});
test('a no-job word edit fence prevents a later backfill claim and stale publication', async () => {
    const db = await createDatabase();
    try {
        const before = await db.query(
            'select count(*)::integer as count from public.question_generation_jobs where word_id = $1::uuid',
            [WORD_ID]
        );
        assert.equal(before.rows[0].count, 0);

        await fenceWord(db);
        await db.query(
            "select public.enqueue_question_generation_job_if_needed($1::uuid, $2::uuid, 'cache_backfill')",
            [USER_ID, WORD_ID]
        );
        const claim = await db.query(
            "select * from public.claim_question_generation_jobs('old-worker', 1, 60000)"
        );

        if (claim.rows.length > 0) {
            await db.query(
                'update public.words set meaning_en = $1, updated_at = clock_timestamp() where id = $2::uuid',
                ['an edible fruit', WORD_ID]
            );
            await db.query(
                'delete from public.question_cache where user_id = $1::uuid and word_id = $2::uuid',
                [USER_ID, WORD_ID]
            );
            await db.query(
                'select * from public.publish_question_generation_variants($1::uuid, $2, $3::bigint, $4::uuid, $5::jsonb)',
                [
                    claim.rows[0].id,
                    'old-worker',
                    claim.rows[0].word_version,
                    claim.rows[0].lease_token,
                    variantsJson(),
                ]
            );
        }

        const cache = await db.query(
            'select count(*)::integer as count from public.question_cache where word_id = $1::uuid',
            [WORD_ID]
        );
        assert.equal(cache.rows[0].count, 0, 'an obsolete worker must not republish cache after invalidation');
        assert.equal(claim.rows.length, 0, 'a job created after the fence must not be claimable');
    } finally {
        await db.close();
    }
});

test('a fenced cache referenced by a formal challenge is retired instead of deleted', async () => {
    const db = await createDatabase();
    try {
        const cache = await db.query(`
            insert into public.question_cache (
                user_id, word_id, level, question_type, round_type, quality_status,
                question_text, options, answer, option_meanings, correct_meaning,
                variant_slot, cache_state, question_fingerprint
            ) values (
                $1::uuid, $2::uuid, 'middle', '1', 'primary', 'ready',
                'The child ate an ___.', '[]'::jsonb, 'A', '[]'::jsonb,
                'a fruit', 1, 'active', 'fk-protected-cache'
            ) returning id
        `, [USER_ID, WORD_ID]);
        const challenge = await db.query(`
            insert into public.quiz_challenges (test_id, user_id, level, expires_at)
            values ('fk-protection-test', $1::uuid, 'middle', now() + interval '1 hour')
            returning id
        `, [USER_ID]);
        await db.query(`
            insert into public.quiz_challenge_questions (
                challenge_id, ordinal, meaning_id, cache_question_id, stem, question_snapshot, history_expires_at
            ) values ($1::uuid, 1, $2::uuid, $3::uuid, 'The child ate an ___.', '{}'::jsonb, now() + interval '30 days')
        `, [challenge.rows[0].id, WORD_ID, cache.rows[0].id]);

        await fenceWord(db);

        const preserved = await db.query(
            'select cache_state from public.question_cache where id = $1::uuid',
            [cache.rows[0].id]
        );
        assert.deepEqual(preserved.rows, [{ cache_state: 'retired' }]);
    } finally {
        await db.close();
    }
});

test('publish rejects an obsolete job version even if stale lease fields remain', async () => {
    const db = await createDatabase();
    try {
        await db.query(
            "select public.enqueue_question_generation_job_if_needed($1::uuid, $2::uuid, 'cache_backfill')",
            [USER_ID, WORD_ID]
        );
        const claim = await db.query(
            "select * from public.claim_question_generation_jobs('old-worker', 1, 60000)"
        );
        assert.equal(claim.rows.length, 1);

        const oldVersion = claim.rows[0].word_version;
        const oldLeaseToken = claim.rows[0].lease_token;
        await db.query(
            'select * from public.fence_word_question_generation($1::uuid, $2::uuid)',
            [USER_ID, WORD_ID]
        );
        await db.query(`
            update public.question_generation_jobs
            set word_version = $1,
                status = 'generating',
                lease_owner = 'old-worker',
                lease_expires_at = clock_timestamp() + interval '1 hour',
                lease_token = $2::uuid
            where id = $3::uuid
        `, [oldVersion, oldLeaseToken, claim.rows[0].id]);

        const publish = await db.query(
            'select * from public.publish_question_generation_variants($1::uuid, $2, $3::bigint, $4::uuid, $5::jsonb)',
            [
                claim.rows[0].id,
                'old-worker',
                oldVersion,
                oldLeaseToken,
                variantsJson(),
            ]
        );
        const cache = await db.query(
            'select count(*)::integer as count from public.question_cache where word_id = $1::uuid',
            [WORD_ID]
        );
        assert.equal(publish.rows.length, 0);
        assert.equal(cache.rows[0].count, 0);
    } finally {
        await db.close();
    }
});

for (const editCase of [
    {
        name: 'mastered',
        updateSql: "update public.words set mastery_status = 'mastered' where id = $1::uuid",
    },
    {
        name: 'invalid',
        updateSql: "update public.words set word = 'genaine' where id = $1::uuid",
    },
]) {
    test(`${editCase.name} edit finalization removes cache and its fenced job`, async () => {
        const db = await createDatabase();
        try {
            await db.query(`
                insert into public.question_cache (
                    user_id, word_id, level, question_type, round_type, quality_status,
                    question_text, options, answer, option_meanings, correct_meaning,
                    variant_slot, cache_state, question_fingerprint
                ) values (
                    $1::uuid, $2::uuid, 'middle', '1', 'primary', 'ready',
                    'The child ate an ___.', '["A. apple", "B. pear", "C. plum", "D. peach"]'::jsonb,
                    'A', '["apple meaning", "pear meaning", "plum meaning", "peach meaning"]'::jsonb,
                    'a fruit', 1, 'active', 'existing-cache'
                )
            `, [USER_ID, WORD_ID]);
            await db.query(
                'select * from public.fence_word_question_generation($1::uuid, $2::uuid)',
                [USER_ID, WORD_ID]
            );
            await db.query(editCase.updateSql, [WORD_ID]);
            await db.query(
                'select public.finalize_word_question_generation_edit($1::uuid, $2::uuid)',
                [USER_ID, WORD_ID]
            );

            const state = await db.query(`
                select
                    (select count(*)::integer from public.question_cache where word_id = $1::uuid) as cache_count,
                    (select count(*)::integer from public.question_generation_jobs where word_id = $1::uuid) as job_count
            `, [WORD_ID]);
            assert.deepEqual(state.rows[0], { cache_count: 0, job_count: 0 });
        } finally {
            await db.close();
        }
    });
}

test('fencing one meaning does not block a same-spelling different word_id', async () => {
    const db = await createDatabase();
    const otherWordId = '33333333-3333-4333-8333-333333333333';
    try {
        await db.query(`
            insert into public.words (id, user_id, word, meaning_en, context_en, level)
            values ($1::uuid, $2::uuid, 'apple', 'a technology company', 'Apple announced a product.', 'middle')
        `, [otherWordId, USER_ID]);
        await db.query(
            'select * from public.fence_word_question_generation($1::uuid, $2::uuid)',
            [USER_ID, WORD_ID]
        );

        const claim = await db.query(
            "select * from public.claim_question_generation_jobs('worker-2', 10, 60000)"
        );
        assert.deepEqual(claim.rows.map(row => row.word_id), [otherWordId]);
    } finally {
        await db.close();
    }
});

test('question generation migrations remain idempotent with the version protocol', async () => {
    const db = await createDatabase();
    try {
        for (const migrationPath of MIGRATION_PATHS) {
            await db.exec(await fs.readFile(migrationPath, 'utf8'));
        }
        const jobs = await db.query(
            'select count(*)::integer as count from public.question_generation_jobs'
        );
        assert.equal(jobs.rows[0].count, 0);
    } finally {
        await db.close();
    }
});

test('an old claim cannot publish through a newer lease that reuses the same worker id', async () => {
    const db = await createDatabase();
    try {
        await db.query(
            "select public.enqueue_question_generation_job_if_needed($1::uuid, $2::uuid, 'cache_backfill')",
            [USER_ID, WORD_ID]
        );
        const firstClaim = await db.query(
            "select * from public.claim_question_generation_jobs('shared-worker', 1, 60000)"
        );
        assert.equal(firstClaim.rows.length, 1);

        await db.query(
            'select * from public.fence_word_question_generation($1::uuid, $2::uuid)',
            [USER_ID, WORD_ID]
        );
        await db.query(
            'update public.words set meaning_en = $1 where id = $2::uuid',
            ['an edible fruit', WORD_ID]
        );
        await db.query(
            'select public.finalize_word_question_generation_edit($1::uuid, $2::uuid)',
            [USER_ID, WORD_ID]
        );
        const secondClaim = await db.query(
            "select * from public.claim_question_generation_jobs('shared-worker', 1, 60000)"
        );
        assert.equal(secondClaim.rows.length, 1);
        assert.equal(secondClaim.rows[0].id, firstClaim.rows[0].id);
        assert.notEqual(secondClaim.rows[0].word_version, firstClaim.rows[0].word_version);

        const oldPublish = await db.query(
            'select * from public.publish_question_generation_variants($1::uuid, $2, $3::bigint, $4::uuid, $5::jsonb)',
            [
                firstClaim.rows[0].id,
                'shared-worker',
                firstClaim.rows[0].word_version,
                firstClaim.rows[0].lease_token,
                variantsJson(),
            ]
        );
        const cache = await db.query(
            'select count(*)::integer as count from public.question_cache where word_id = $1::uuid',
            [WORD_ID]
        );
        assert.equal(cache.rows[0].count, 0);
        assert.equal(oldPublish.rows.length, 0, 'the old claim must not borrow the newer same-worker lease');
    } finally {
        await db.close();
    }
});
