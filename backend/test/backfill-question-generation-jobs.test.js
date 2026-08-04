'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    parseArgs,
    planQuestionGenerationJobBackfill,
    createPlanFingerprint,
    backfillQuestionGenerationJobs,
    createSupabaseDependencies,
} = require('../scripts/backfill-question-generation-jobs');

function word(overrides = {}) {
    return {
        id: 'word-1',
        user_id: 'user-1',
        word: 'bank',
        meaning_zh: '银行',
        mastery_status: 'pending',
        ...overrides,
    };
}

function cache(overrides = {}) {
    return {
        user_id: 'user-1',
        word_id: 'word-1',
        round_type: 'primary',
        quality_status: 'ready',
        question_fingerprint: 'fingerprint-1',
        ...overrides,
    };
}

test('plans jobs only for unmastered meanings with fewer than two distinct ready primary fingerprints', () => {
    const words = [
        word(),
        word({ id: 'word-2', meaning_zh: '河岸' }),
        word({ id: 'word-3', word: 'apple', meaning_zh: '苹果', mastery_status: 'mastered' }),
        word({ id: 'word-4', word: 'pear', meaning_zh: '梨' }),
    ];
    const cacheRows = [
        cache(),
        cache({ question_fingerprint: 'fingerprint-1' }),
        cache({ word_id: 'word-2', question_fingerprint: 'fingerprint-a' }),
        cache({ word_id: 'word-2', question_fingerprint: 'fingerprint-b' }),
        cache({ word_id: 'word-3', question_fingerprint: 'fingerprint-a' }),
        cache({ word_id: 'word-4', round_type: 'review', question_fingerprint: 'fingerprint-a' }),
        cache({ word_id: 'word-4', quality_status: 'rejected', question_fingerprint: 'fingerprint-b' }),
        cache({ word_id: 'word-4', question_fingerprint: '' }),
    ];

    const plan = planQuestionGenerationJobBackfill({ words, cacheRows, jobs: [] });

    assert.deepEqual(plan.jobs.map(job => [job.user_id, job.word_id]), [
        ['user-1', 'word-1'],
        ['user-1', 'word-4'],
    ]);
    assert.equal(plan.summary.eligibleMeanings, 3);
    assert.equal(plan.summary.alreadyReady, 1);
    assert.equal(plan.summary.alreadyQueued, 0);
});

test('treats same spelling meanings as independent user_id + word_id identities', () => {
    const plan = planQuestionGenerationJobBackfill({
        words: [
            word({ id: 'bank-bank', meaning_zh: '银行' }),
            word({ id: 'bank-river', meaning_zh: '河岸' }),
        ],
        cacheRows: [
            cache({ word_id: 'bank-bank', question_fingerprint: 'bank-a' }),
            cache({ word_id: 'bank-bank', question_fingerprint: 'bank-b' }),
        ],
        jobs: [],
    });

    assert.deepEqual(plan.jobs.map(job => job.word_id), ['bank-river']);
});

test('skips an existing job so repeated backfills are idempotent', () => {
    const plan = planQuestionGenerationJobBackfill({
        words: [word()],
        cacheRows: [],
        jobs: [{ user_id: 'user-1', word_id: 'word-1', status: 'pending' }],
    });

    assert.equal(plan.jobs.length, 0);
    assert.equal(plan.summary.alreadyQueued, 1);
});

test('loads pages with an id keyset and never uses offset ranges', async () => {
    const operations = [];
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({
        id: String(index + 1).padStart(4, '0'),
    }));
    const pages = new Map([
        ['', firstPage],
        ['1000', [{ id: '1001' }]],
    ]);
    const dependencies = createSupabaseDependencies({
        from(table) {
            assert.equal(table, 'words');
            let lastId = '';
            const query = {
                select(columns) {
                    operations.push(['select', columns]);
                    return this;
                },
                eq(column, value) {
                    operations.push(['eq', column, value]);
                    return this;
                },
                gt(column, value) {
                    operations.push(['gt', column, value]);
                    lastId = value;
                    return this;
                },
                order(column, options) {
                    operations.push(['order', column, options]);
                    return this;
                },
                limit(value) {
                    operations.push(['limit', value]);
                    return this;
                },
                then(resolve, reject) {
                    return Promise.resolve({ data: pages.get(lastId) || [], error: null }).then(resolve, reject);
                },
            };
            return query;
        },
    });

    const rows = await dependencies.loadWords();

    assert.equal(rows.length, 1001);
    assert.deepEqual(operations.filter(operation => operation[0] === 'gt'), [
        ['gt', 'id', '1000'],
    ]);
    assert.deepEqual(operations.filter(operation => operation[0] === 'limit'), [
        ['limit', 1000],
        ['limit', 1000],
    ]);
    assert.equal(operations.some(operation => operation[0] === 'range'), false);
});

test('creates one deterministic fingerprint for the same sorted plan', () => {
    const jobs = [
        { user_id: 'user-2', word_id: 'word-2', reason: 'cache_backfill' },
        { user_id: 'user-1', word_id: 'word-1', reason: 'cache_backfill' },
    ];
    const forward = createPlanFingerprint({ userId: null, jobs });
    const reversed = createPlanFingerprint({ userId: null, jobs: [...jobs].reverse() });

    assert.match(forward, /^[a-f0-9]{64}$/);
    assert.equal(forward, reversed);
});

test('apply uses the conditional enqueue RPC for every planned meaning', async () => {
    const calls = [];
    const client = {
        from(table) {
            const rows = table === 'words' ? [word()] : [];
            return {
                select() { return this; },
                order() { return this; },
                limit() { return this; },
                range() { return this; },
                upsert() { return Promise.resolve({ error: null }); },
                then(resolve, reject) {
                    return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
                },
            };
        },
        async rpc(name, params) {
            calls.push([name, params]);
            return { data: true, error: null };
        },
    };
    const dependencies = createSupabaseDependencies(client);
    const dryRun = await backfillQuestionGenerationJobs(dependencies);
    const result = await backfillQuestionGenerationJobs(dependencies, {
        apply: true,
        planFingerprint: dryRun.planFingerprint,
    });

    assert.equal(result.enqueued, 1);
    assert.deepEqual(calls, [[
        'enqueue_question_generation_job_if_needed',
        {
            p_user_id: 'user-1',
            p_word_id: 'word-1',
            p_reason: 'cache_backfill',
        },
    ]]);
});

test('reports a false conditional enqueue as skipped, not applied or failed', async () => {
    const client = {
        from(table) {
            const rows = table === 'words' ? [word()] : [];
            return {
                select() { return this; },
                order() { return this; },
                limit() { return this; },
                then(resolve, reject) {
                    return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
                },
            };
        },
        async rpc() {
            return { data: false, error: null };
        },
    };
    const dependencies = createSupabaseDependencies(client);
    const dryRun = await backfillQuestionGenerationJobs(dependencies);
    const result = await backfillQuestionGenerationJobs(dependencies, {
        apply: true,
        planFingerprint: dryRun.planFingerprint,
    });

    assert.equal(result.enqueued, 0);
    assert.equal(result.applied, 0);
    assert.equal(result.skipped, 1);
    assert.equal(result.failed, 0);
    assert.deepEqual(result.progress, {
        total: 1,
        attempted: 1,
        applied: 0,
        skipped: 1,
        failed: 0,
    });
});

test('rejects reusing an old fingerprint after a partially failed apply', async () => {
    const persistedJobs = [];
    const dependencies = {
        loadWords: async () => [word({ id: 'word-1' }), word({ id: 'word-2' })],
        loadQuestionCache: async () => [],
        loadJobs: async () => [...persistedJobs],
        enqueueJob: async job => {
            if (job.word_id === 'word-1') {
                persistedJobs.push({ ...job, status: 'pending' });
                return;
            }
            throw new Error('temporary database error');
        },
    };
    const dryRun = await backfillQuestionGenerationJobs(dependencies);
    const firstApply = await backfillQuestionGenerationJobs(dependencies, {
        apply: true,
        planFingerprint: dryRun.planFingerprint,
    });

    assert.equal(firstApply.applied, 1);
    assert.equal(firstApply.failed, 1);
    await assert.rejects(
        () => backfillQuestionGenerationJobs(dependencies, {
            apply: true,
            planFingerprint: dryRun.planFingerprint,
        }),
        /PLAN_FINGERPRINT_(?:MISMATCH|INVALIDATED)/,
    );
});

test('defaults to dry-run and never calls enqueueJob', async () => {
    let writes = 0;
    const result = await backfillQuestionGenerationJobs({
        loadWords: async () => [word()],
        loadQuestionCache: async () => [],
        loadJobs: async () => [],
        enqueueJob: async () => { writes += 1; },
    });

    assert.equal(result.mode, 'dry-run');
    assert.equal(result.planned, 1);
    assert.equal(result.enqueued, 0);
    assert.equal(writes, 0);
    assert.match(result.planFingerprint, /^[a-f0-9]{64}$/);
});

test('requires the exact reviewed dry-run fingerprint before apply', async () => {
    const writes = [];
    const dependencies = {
        loadWords: async () => [word()],
        loadQuestionCache: async () => [],
        loadJobs: async () => [],
        enqueueJob: async job => writes.push(job),
    };
    const dryRun = await backfillQuestionGenerationJobs(dependencies);

    await assert.rejects(
        () => backfillQuestionGenerationJobs(dependencies, { apply: true }),
        /PLAN_FINGERPRINT_REQUIRED/
    );
    await assert.rejects(
        () => backfillQuestionGenerationJobs(dependencies, {
            apply: true,
            planFingerprint: '0'.repeat(64),
        }),
        /PLAN_FINGERPRINT_MISMATCH/
    );
    assert.equal(writes.length, 0);

    const result = await backfillQuestionGenerationJobs(dependencies, {
        apply: true,
        planFingerprint: dryRun.planFingerprint,
    });

    assert.equal(result.mode, 'apply');
    assert.equal(result.enqueued, 1);
    assert.equal(result.applied, 1);
    assert.equal(result.failed, 0);
    assert.deepEqual(result.progress, {
        total: 1,
        attempted: 1,
        applied: 1,
        skipped: 0,
        failed: 0,
    });
    assert.deepEqual(writes, [{
        user_id: 'user-1',
        word_id: 'word-1',
        reason: 'cache_backfill',
    }]);
});

test('reports applied failed and progress when individual enqueues fail', async () => {
    const words = [word({ id: 'word-1' }), word({ id: 'word-2' })];
    const dependencies = {
        loadWords: async () => words,
        loadQuestionCache: async () => [],
        loadJobs: async () => [],
        enqueueJob: async job => {
            if (job.word_id === 'word-1') throw new Error('temporary database error');
        },
    };
    const dryRun = await backfillQuestionGenerationJobs(dependencies);
    const result = await backfillQuestionGenerationJobs(dependencies, {
        apply: true,
        planFingerprint: dryRun.planFingerprint,
    });

    assert.equal(result.enqueued, 1);
    assert.equal(result.applied, 1);
    assert.equal(result.failed, 1);
    assert.deepEqual(result.progress, {
        total: 2,
        attempted: 2,
        applied: 1,
        skipped: 0,
        failed: 1,
    });
    assert.deepEqual(result.failures, [{
        user_id: 'user-1',
        word_id: 'word-1',
        error: 'temporary database error',
    }]);
});

test('parses safe CLI defaults and requires an exact --apply flag to write', () => {
    assert.deepEqual(parseArgs([]), {
        apply: false,
        userId: null,
        planFingerprint: null,
        help: false,
    });
    assert.deepEqual(parseArgs([
        '--apply',
        '--user-id', 'user-1',
        '--plan-fingerprint', 'a'.repeat(64),
    ]), {
        apply: true,
        userId: 'user-1',
        planFingerprint: 'a'.repeat(64),
        help: false,
    });
    assert.throws(() => parseArgs(['--apply=true']), /UNKNOWN_ARGUMENT/);
    assert.throws(() => parseArgs(['--user-id']), /USER_ID_VALUE_REQUIRED/);
    assert.throws(() => parseArgs(['--plan-fingerprint']), /PLAN_FINGERPRINT_VALUE_REQUIRED/);
});
