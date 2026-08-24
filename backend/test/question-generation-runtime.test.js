'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createSupabaseQuestionGenerationJobStore,
    createSupabaseWordLoader,
    createSupabaseReadyVariantPublisher,
    createSupabaseQuestionGenerationService,
    createQuestionGenerationRuntime,
} = require('../question-generation-runtime');

const NOW = '2026-08-03T12:00:00.000Z';

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function createFakeSupabase({ jobs = [], words = [], users = [], cache = [], failCacheUpsert = false } = {}) {
    const state = {
        question_generation_jobs: clone(jobs),
        words: clone(words),
        users: clone(users),
        question_cache: clone(cache),
    };
    const calls = [];
    let sequence = 100;

    function matches(row, filters) {
        return filters.every(filter => {
            if (filter.type === 'eq') return String(row[filter.column]) === String(filter.value);
            if (filter.type === 'in') return filter.values.map(String).includes(String(row[filter.column]));
            if (filter.type === 'gt') return new Date(row[filter.column]).getTime() > new Date(filter.value).getTime();
            return false;
        });
    }

    class Query {
        constructor(table) {
            this.table = table;
            this.mode = 'select';
            this.payload = null;
            this.options = null;
            this.filters = [];
            this.single = false;
        }

        select(columns = '*') {
            this.columns = columns;
            return this;
        }

        upsert(payload, options) {
            this.mode = 'upsert';
            this.payload = Array.isArray(payload) ? clone(payload) : clone(payload);
            this.options = options;
            return this;
        }

        update(payload) {
            this.mode = 'update';
            this.payload = clone(payload);
            return this;
        }

        eq(column, value) {
            this.filters.push({ type: 'eq', column, value });
            return this;
        }

        in(column, values) {
            this.filters.push({ type: 'in', column, values: [...values] });
            return this;
        }
        gt(column, value) { this.filters.push({ type: 'gt', column, value }); return this; }

        maybeSingle() {
            this.single = true;
            return this.execute();
        }

        then(resolve, reject) {
            return this.execute().then(resolve, reject);
        }

        async execute() {
            const rows = state[this.table];
            if (!rows) return { data: null, error: new Error(`Unknown table ${this.table}`) };

            if (this.mode === 'select') {
                const selected = rows.filter(row => matches(row, this.filters)).map(clone);
                calls.push({ type: 'select', table: this.table, filters: clone(this.filters) });
                return { data: this.single ? (selected[0] || null) : selected, error: null };
            }

            if (this.mode === 'upsert') {
                if (this.table === 'question_cache' && failCacheUpsert) {
                    calls.push({ type: 'cache_upsert_failed', rows: clone(this.payload) });
                    return { data: null, error: Object.assign(new Error('cache upsert failed'), { code: 'CACHE_UPSERT_FAILED' }) };
                }
                const incoming = Array.isArray(this.payload) ? this.payload : [this.payload];
                const persisted = [];
                for (const row of incoming) {
                    const existing = this.table === 'question_generation_jobs'
                        ? rows.find(item => item.word_id === row.word_id)
                        : rows.find(item => item.user_id === row.user_id
                            && item.word_id === row.word_id
                            && item.question_fingerprint === row.question_fingerprint);
                    if (existing && this.options?.ignoreDuplicates) {
                        continue;
                    }
                    if (existing) {
                        Object.assign(existing, clone(row));
                        persisted.push(clone(existing));
                    } else {
                        const inserted = { id: row.id || `${this.table}-${sequence++}`, ...clone(row) };
                        rows.push(inserted);
                        persisted.push(clone(inserted));
                    }
                }
                calls.push({
                    type: this.table === 'question_cache' ? 'cache_upsert' : 'job_upsert',
                    rows: clone(incoming),
                    options: clone(this.options),
                });
                return { data: this.single ? (persisted[0] || null) : persisted, error: null };
            }

            const updated = [];
            for (const row of rows.filter(item => matches(item, this.filters))) {
                Object.assign(row, clone(this.payload));
                updated.push(clone(row));
            }
            calls.push({
                type: this.table === 'question_cache' ? 'cache_update' : 'job_update',
                patch: clone(this.payload),
                filters: clone(this.filters),
                updated: clone(updated),
            });
            return { data: this.single ? (updated[0] || null) : updated, error: null };
        }
    }

    const client = {
        from: table => new Query(table),
        rpc: async (name, args) => {
            calls.push({ type: 'rpc', name, args: clone(args) });
            const nowMs = new Date(NOW).getTime();
            const inProgress = ['generating', 'validating', 'repairing'];
            if (name === 'claim_question_generation_jobs') {
                const due = state.question_generation_jobs
                    .filter(row => ['pending', 'retry_wait'].includes(row.status)
                        ? new Date(row.next_attempt_at).getTime() <= nowMs
                        : inProgress.includes(row.status)
                            && (!row.lease_expires_at || new Date(row.lease_expires_at).getTime() <= nowMs))
                    .slice(0, args.p_limit);
                for (const row of due) {
                    row.status = 'generating';
                    row.attempt_count = Number(row.attempt_count || 0) + 1;
                    row.lease_owner = args.p_worker_id;
                    row.lease_expires_at = new Date(nowMs + args.p_lease_duration_ms).toISOString();
                    row.lease_token = `lease-${sequence++}`;
                    row.updated_at = NOW;
                }
                return { data: clone(due), error: null };
            }

            const job = state.question_generation_jobs.find(row => row.id === args.p_job_id);
            const ownsLiveLease = job
                && job.lease_owner === args.p_worker_id
                && job.word_version === args.p_expected_word_version
                && job.lease_token === args.p_lease_token
                && inProgress.includes(job.status)
                && new Date(job.lease_expires_at).getTime() > nowMs;
            if (name === 'renew_question_generation_job') {
                if (!ownsLiveLease) return { data: [], error: null };
                job.lease_expires_at = new Date(nowMs + args.p_lease_duration_ms).toISOString();
                job.updated_at = NOW;
                return { data: [clone(job)], error: null };
            }
            if (name === 'complete_question_generation_job') {
                if (!ownsLiveLease) return { data: [], error: null };
                Object.assign(job, {
                    status: 'ready',
                    next_attempt_at: NOW,
                    lease_owner: null,
                    lease_expires_at: null,
                    last_error_code: null,
                    last_error_detail: null,
                    rejection_reasons: {},
                    updated_at: NOW,
                });
                return { data: [clone(job)], error: null };
            }
            if (name === 'fail_question_generation_job') {
                if (!ownsLiveLease) return { data: [], error: null };
                Object.assign(job, {
                    status: Number(job.attempt_count) >= args.p_max_attempts ? 'needs_manual_review' : 'retry_wait',
                    lease_owner: null,
                    lease_expires_at: null,
                    last_error_code: args.p_error_code,
                    last_error_detail: args.p_error_detail,
                    rejection_reasons: args.p_rejection_reasons,
                    updated_at: NOW,
                });
                return { data: [clone(job)], error: null };
            }
            if (name === 'publish_question_generation_variants') {
                if (!ownsLiveLease) return { data: [], error: null };
                if (failCacheUpsert) {
                    return { data: null, error: Object.assign(new Error('cache publish failed'), { code: 'CACHE_UPSERT_FAILED' }) };
                }
                const variants = args.p_variants;
                const fingerprints = variants.map(row => row.question_fingerprint);
                const oldReady = state.question_cache.filter(row => row.user_id === job.user_id
                    && row.word_id === job.word_id
                    && row.round_type === 'primary'
                    && row.quality_status === 'ready'
                    && !fingerprints.includes(row.question_fingerprint));
                for (const row of oldReady) row.cache_state = 'retired';
                for (const [index, variant] of variants.entries()) {
                    const existing = state.question_cache.find(row => row.user_id === job.user_id
                        && row.word_id === job.word_id
                        && row.question_fingerprint === variant.question_fingerprint);
                    const published = {
                        ...(existing || {}),
                        ...clone(variant),
                        id: existing?.id || `question_cache-${sequence++}`,
                        user_id: job.user_id,
                        word_id: job.word_id,
                        round_type: 'primary',
                        quality_status: 'ready',
                        variant_slot: index + 1,
                        cache_state: index === 0 ? 'active' : 'reserved_next_day',
                    };
                    if (existing) Object.assign(existing, published);
                    else state.question_cache.push(published);
                }
                return {
                    data: [{
                        published: variants.length,
                        retired: oldReady.length,
                        fingerprints,
                    }],
                    error: null,
                };
            }
            return { data: null, error: new Error(`Unknown RPC ${name}`) };
        },
    };

    return { client, state, calls };
}

function generationJob(overrides = {}) {
    return {
        id: 'job-1',
        user_id: 'user-1',
        word_id: 'word-bank-finance',
        status: 'generating',
        attempt_count: 1,
        lease_owner: 'worker-a',
        word_version: 1,
        lease_token: 'lease-1',
        lease_expires_at: '2026-08-03T12:01:00.000Z',
        next_attempt_at: NOW,
        ...overrides,
    };
}

function candidate(questionText, distractors = ['shore', 'desk', 'road']) {
    return {
        question_type: '1',
        question_text: questionText,
        context_zh: '这是与当前英文题干对应的完整中文句子翻译。',
        options: ['bank', ...distractors].map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`),
        option_meanings: ['银行', '岸边', '书桌', '道路'],
        answer: 'A',
        correct_meaning: '银行',
        ai_audit_status: 'approved',
    };
}

test('Supabase job store enqueue is idempotent and atomic claim uses the lease RPC', async () => {
    const existing = generationJob({ status: 'ready', attempt_count: 2, lease_owner: null });
    const due = generationJob({ id: 'job-2', word_id: 'word-2', status: 'pending', attempt_count: 0, lease_owner: null });
    const fake = createFakeSupabase({ jobs: [existing, due] });
    const store = createSupabaseQuestionGenerationJobStore({
        client: fake.client,
        now: () => new Date(NOW),
        leaseDurationMs: 30_000,
    });

    await store.enqueue({ userId: 'user-1', wordId: existing.word_id });
    const claimed = await store.claim({ workerId: 'worker-a', limit: 4 });

    assert.equal(fake.state.question_generation_jobs.length, 2);
    assert.equal(fake.state.question_generation_jobs[0].status, 'ready');
    assert.equal(fake.state.question_generation_jobs[0].attempt_count, 2);
    assert.deepEqual(claimed.map(row => row.id), ['job-2']);
    const rpc = fake.calls.find(call => call.type === 'rpc');
    assert.equal(rpc.name, 'claim_question_generation_jobs');
    assert.deepEqual(rpc.args, {
        p_worker_id: 'worker-a',
        p_limit: 4,
        p_lease_duration_ms: 30_000,
    });
});

test('Supabase job store renews only an unexpired lease owned by the worker', async () => {
    const active = generationJob();
    const fake = createFakeSupabase({ jobs: [active] });
    const store = createSupabaseQuestionGenerationJobStore({
        client: fake.client,
        now: () => new Date(NOW),
        leaseDurationMs: 10 * 60 * 1000,
    });

    const renewed = await store.renew(active, { workerId: 'worker-a' });
    assert.equal(renewed.lease_expires_at, '2026-08-03T12:10:00.000Z');

    const expired = generationJob({
        id: 'job-expired',
        lease_expires_at: '2026-08-03T11:59:59.000Z',
    });
    const staleFake = createFakeSupabase({ jobs: [expired] });
    const staleStore = createSupabaseQuestionGenerationJobStore({
        client: staleFake.client,
        now: () => new Date(NOW),
        leaseDurationMs: 10 * 60 * 1000,
    });
    await assert.rejects(
        staleStore.renew(expired, { workerId: 'worker-a' }),
        error => error.code === 'JOB_LEASE_NOT_OWNED_OR_STALE'
    );
});

test('Supabase job store complete and fail both reject an expired owned lease', async () => {
    const expired = generationJob({ lease_expires_at: '2026-08-03T11:59:59.000Z' });
    const fake = createFakeSupabase({ jobs: [expired] });
    const store = createSupabaseQuestionGenerationJobStore({ client: fake.client, now: () => new Date(NOW) });

    await assert.rejects(
        store.complete(expired, { workerId: 'worker-a' }),
        error => error.code === 'JOB_LEASE_NOT_OWNED_OR_STALE'
    );
    await assert.rejects(
        store.fail(expired, new Error('late failure'), { workerId: 'worker-a' }),
        error => error.code === 'JOB_LEASE_NOT_OWNED_OR_STALE'
    );
    assert.equal(fake.state.question_generation_jobs[0].status, 'generating');
    assert.equal(fake.state.question_generation_jobs[0].last_error_code, undefined);
});

test('Supabase job store complete rejects a database-stale lease owner', async () => {
    const claimed = generationJob();
    const databaseRow = { ...claimed, lease_owner: 'worker-b' };
    const fake = createFakeSupabase({ jobs: [databaseRow] });
    const store = createSupabaseQuestionGenerationJobStore({ client: fake.client, now: () => new Date(NOW) });

    await assert.rejects(
        store.complete(claimed, { workerId: 'worker-a' }),
        error => error.code === 'JOB_LEASE_NOT_OWNED_OR_STALE'
    );
    assert.equal(fake.state.question_generation_jobs[0].status, 'generating');
});

test('Supabase job store fail is conditional on the lease owner', async () => {
    const claimed = generationJob();
    const databaseRow = { ...claimed, lease_owner: 'worker-b' };
    const fake = createFakeSupabase({ jobs: [databaseRow] });
    const store = createSupabaseQuestionGenerationJobStore({ client: fake.client, now: () => new Date(NOW) });

    await assert.rejects(
        store.fail(claimed, new Error('generation failed'), { workerId: 'worker-a' }),
        error => error.code === 'JOB_LEASE_NOT_OWNED_OR_STALE'
    );
    assert.equal(fake.state.question_generation_jobs[0].last_error_code, undefined);
});

test('word loader requires both job user_id and word_id', async () => {
    const fake = createFakeSupabase({
        words: [{ id: 'word-bank-finance', user_id: 'user-1', word: 'bank', meaning_zh: '银行', level: 'middle' }],
    });
    const loadWord = createSupabaseWordLoader({ client: fake.client });

    assert.equal((await loadWord('word-bank-finance', 'user-1')).meaning_zh, '银行');
    assert.equal(await loadWord('word-bank-finance', 'user-2'), null);
    assert.deepEqual(fake.calls.filter(call => call.table === 'words').map(call => call.filters), [
        [
            { type: 'eq', column: 'id', value: 'word-bank-finance' },
            { type: 'eq', column: 'user_id', value: 'user-1' },
        ],
        [
            { type: 'eq', column: 'id', value: 'word-bank-finance' },
            { type: 'eq', column: 'user_id', value: 'user-2' },
        ],
    ]);
});

test('word loader inherits a missing word level from the user learning level', async () => {
    const fake = createFakeSupabase({
        words: [{ id: 'word-no-level', user_id: 'user-1', word: 'bank', meaning_zh: '银行', level: null }],
        users: [{ id: 'user-1', learning_level: 'high' }],
    });
    const loadWord = createSupabaseWordLoader({ client: fake.client });
    const word = await loadWord('word-no-level', 'user-1');
    assert.equal(word.level, String.fromCharCode(0x9ad8, 0x4e2d));
});

test('word loader always uses the current user learning level over a historical word level', async () => {
    const fake = createFakeSupabase({
        words: [{ id: 'word-old-level', user_id: 'user-1', word: 'bank', meaning_zh: '银行', level: 'high' }],
        users: [{ id: 'user-1', learning_level: 'middle' }],
    });
    const loadWord = createSupabaseWordLoader({ client: fake.client });
    const word = await loadWord('word-old-level', 'user-1');
    assert.equal(word.level, String.fromCharCode(0x4e2d, 0x5b66));
});

test('word loader uses the schema default when both word and user levels are missing', async () => {
    const fake = createFakeSupabase({
        words: [{ id: 'word-no-level', user_id: 'user-1', word: 'bank', meaning_zh: '银行', level: null }],
        users: [{ id: 'user-1', learning_level: null }],
    });
    const loadWord = createSupabaseWordLoader({ client: fake.client });
    const word = await loadWord('word-no-level', 'user-1');
    assert.equal(word.level, String.fromCharCode(0x4e2d, 0x5b66));
});

test('publisher rejects any count other than the product invariant of exactly two variants', async () => {
    const fake = createFakeSupabase({ jobs: [generationJob()] });
    const publish = createSupabaseReadyVariantPublisher({ client: fake.client, workerId: 'worker-a' });
    await assert.rejects(
        publish({
            job: generationJob(),
            variants: [
                { ...candidate('First exact question.'), question_fingerprint: 'exact-1' },
                { ...candidate('Second exact question.'), question_fingerprint: 'exact-2' },
                { ...candidate('Third exact question.'), question_fingerprint: 'exact-3' },
            ],
        }),
        error => error.code === 'EXACTLY_TWO_READY_VARIANTS_REQUIRED'
    );
    assert.equal(fake.calls.some(call => call.type === 'rpc'), false);
});
test('generation service publishes two variants before retiring old ready primary rows for that meaning', async () => {
    const fake = createFakeSupabase({
        jobs: [generationJob()],
        words: [{ id: 'word-bank-finance', user_id: 'user-1', word: 'bank', meaning_zh: '银行', level: 'middle' }],
        cache: [{
            id: 'cache-old',
            user_id: 'user-1',
            word_id: 'word-bank-finance',
            round_type: 'primary',
            quality_status: 'ready',
            cache_state: 'active',
            question_fingerprint: 'old-fingerprint',
            question_text: 'Old bank question',
        }],
    });
    const buildCalls = [];
    const service = createSupabaseQuestionGenerationService({
        client: fake.client,
        workerId: 'worker-a',
        buildCandidates: async input => {
            buildCalls.push(input);
            return [
                candidate('She deposited her savings at the bank.'),
                candidate('The bank approved the loan yesterday.', ['branch', 'coin', 'road']),
            ];
        },
    });

    const result = await service.process(generationJob());

    assert.equal(result.readyCount, 2);
    assert.equal(buildCalls.length, 1);
    assert.equal(buildCalls[0].word.id, 'word-bank-finance');
    assert.equal(buildCalls[0].word.user_id, 'user-1');
    assert.equal(buildCalls[0].user.id, 'user-1');
    assert.equal(buildCalls[0].level, String.fromCharCode(0x4e2d, 0x5b66));
    const publishCalls = fake.calls.filter(call => call.type === 'rpc'
        && call.name === 'publish_question_generation_variants');
    assert.equal(publishCalls.length, 1);
    assert.equal(fake.calls.some(call => ['cache_upsert', 'cache_update'].includes(call.type)), false);
    assert.equal(fake.state.question_cache.find(row => row.id === 'cache-old').cache_state, 'retired');
    const newReady = fake.state.question_cache.filter(row => row.id !== 'cache-old');
    assert.equal(newReady.length, 2);
    assert.ok(newReady.every(row => row.user_id === 'user-1'
        && row.word_id === 'word-bank-finance'
        && row.round_type === 'primary'
        && row.quality_status === 'ready'));
    assert.equal(new Set(newReady.map(row => row.question_fingerprint)).size, 2);
});

test('default cache validation rejects ambiguous racket-sport fill-ins before publish', async () => {
    const fake = createFakeSupabase({
        jobs: [generationJob({ word_id: 'word-badminton', user_id: 'user-1' })],
        words: [{ id: 'word-badminton', user_id: 'user-1', word: 'badminton', meaning_zh: String.fromCharCode(0x7fbd, 0x6bdb, 0x7403), level: 'middle' }],
    });
    const service = createSupabaseQuestionGenerationService({
        client: fake.client,
        workerId: 'worker-a',
        maxAttempts: 1,
        buildCandidates: async () => [
            {
                question_type: '1',
                question_text: 'After setting up the net in the backyard, they grabbed their rackets and started a lively game of _____.',
                options: ['A. badminton', 'B. volleyball', 'C. squash', 'D. tennis'],
                answer: 'A',
                correct_meaning: String.fromCharCode(0x7fbd, 0x6bdb, 0x7403),
            },
            {
                question_type: '1',
                question_text: 'They set up the net, picked up their rackets, and began a competitive game of _____.',
                options: ['A. badminton', 'B. volleyball', 'C. squash', 'D. tennis'],
                answer: 'A',
                correct_meaning: String.fromCharCode(0x7fbd, 0x6bdb, 0x7403),
            },
        ],
    });

    await assert.rejects(
        service.process(generationJob({ word_id: 'word-badminton', user_id: 'user-1' })),
        error => error.code === 'INSUFFICIENT_DISTINCT_READY_VARIANTS'
            && error.rejectionReasons.ambiguous_fill_in_context === 2
    );
    assert.equal(fake.calls.some(call => call.type === 'rpc' && call.name === 'publish_question_generation_variants'), false);
});

test('default cache validation rejects type-one candidates without approved AI audit', async () => {
    const fake = createFakeSupabase({
        words: [{ id: 'word-bank-finance', user_id: 'user-1', word: 'bank', meaning_zh: '银行', level: 'middle' }],
    });
    const skipped = { ...candidate('She deposited money at the _____.'), ai_audit_status: 'skipped' };
    const rejected = { ...candidate('The family applied at the _____.'), ai_audit_status: 'rejected' };
    const service = createSupabaseQuestionGenerationService({
        client: fake.client,
        buildCandidates: async () => [skipped, rejected],
        maxAttempts: 1,
    });

    await assert.rejects(
        service.process(generationJob()),
        error => error.code === 'INSUFFICIENT_DISTINCT_READY_VARIANTS'
            && error.rejectionReasons.ai_audit_not_approved === 2
    );
    assert.equal(fake.calls.some(call => call.type === 'rpc' && call.name === 'publish_question_generation_variants'), false);
});

test('insufficient candidates do not write or retire existing ready cache', async () => {
    const old = {
        id: 'cache-old',
        user_id: 'user-1',
        word_id: 'word-bank-finance',
        round_type: 'primary',
        quality_status: 'ready',
        cache_state: 'active',
        question_fingerprint: 'old-fingerprint',
    };
    const fake = createFakeSupabase({
        words: [{ id: 'word-bank-finance', user_id: 'user-1', word: 'bank', meaning_zh: '银行', level: 'middle' }],
        cache: [old],
    });
    const service = createSupabaseQuestionGenerationService({
        client: fake.client,
        buildCandidates: async () => [candidate('Only one usable bank question.')],
        maxAttempts: 2,
    });

    await assert.rejects(
        service.process(generationJob()),
        error => error.code === 'INSUFFICIENT_DISTINCT_READY_VARIANTS'
    );
    assert.deepEqual(fake.state.question_cache, [old]);
    assert.equal(fake.calls.some(call => ['cache_upsert', 'cache_update'].includes(call.type)), false);
});

test('failed new-variant upsert never retires existing ready cache', async () => {
    const old = {
        id: 'cache-old',
        user_id: 'user-1',
        word_id: 'word-bank-finance',
        round_type: 'primary',
        quality_status: 'ready',
        cache_state: 'active',
        question_fingerprint: 'old-fingerprint',
    };
    const fake = createFakeSupabase({
        jobs: [generationJob()],
        cache: [old],
        failCacheUpsert: true,
    });
    const publish = createSupabaseReadyVariantPublisher({ client: fake.client, workerId: 'worker-a' });

    await assert.rejects(
        publish({
            job: generationJob(),
            userId: 'user-1',
            wordId: 'word-bank-finance',
            variants: [
                { ...candidate('First new bank question.'), question_fingerprint: 'new-1' },
                { ...candidate('Second new bank question.'), question_fingerprint: 'new-2' },
            ],
        }),
        error => error.code === 'CACHE_UPSERT_FAILED'
    );
    assert.deepEqual(fake.state.question_cache, [old]);
    assert.equal(fake.calls.some(call => call.type === 'cache_update'), false);
});

test('runtime does not write cache rows when its lease expired before publish', async () => {
    const expired = generationJob({ lease_expires_at: '2026-08-03T11:59:59.000Z' });
    const fake = createFakeSupabase({
        jobs: [expired],
        words: [{ id: expired.word_id, user_id: expired.user_id, word: 'bank', meaning_zh: '银行', level: 'middle' }],
    });
    const runtime = createQuestionGenerationRuntime({
        client: fake.client,
        workerId: 'worker-a',
        now: () => new Date(NOW),
        leaseDurationMs: 10 * 60 * 1000,
        buildCandidates: async () => [
            candidate('She deposited her savings at the bank.'),
            candidate('The bank approved the loan yesterday.', ['branch', 'coin', 'road']),
        ],
        runImmediately: false,
    });

    await assert.rejects(
        runtime.generationService.process(expired),
        error => error.code === 'JOB_LEASE_NOT_OWNED_OR_STALE'
    );
    assert.equal(fake.calls.some(call => ['cache_upsert', 'cache_update'].includes(call.type)), false);
    assert.equal(fake.state.question_generation_jobs[0].status, 'generating');
});

test('runtime gives the candidate builder a lease-renewal callback', async () => {
    const active = generationJob();
    const fake = createFakeSupabase({
        jobs: [active],
        words: [{ id: active.word_id, user_id: active.user_id, word: 'bank', meaning_zh: '银行', level: 'middle' }],
    });
    const runtime = createQuestionGenerationRuntime({
        client: fake.client,
        workerId: 'worker-a',
        now: () => new Date(NOW),
        buildCandidates: async ({ renewLease }) => {
            assert.equal(typeof renewLease, 'function');
            await renewLease();
            return [
                candidate('She deposited her savings at the bank.'),
                candidate('The bank approved the loan yesterday.', ['branch', 'coin', 'road']),
            ];
        },
        runImmediately: false,
    });

    await runtime.generationService.process(active);

    const renewCalls = fake.calls.filter(call =>
        call.type === 'rpc' && call.name === 'renew_question_generation_job'
    );
    assert.equal(renewCalls.length, 2);
});

test('runtime returns its worker and independently testable persistence components', () => {
    const fake = createFakeSupabase();
    const runtime = createQuestionGenerationRuntime({
        client: fake.client,
        workerId: 'worker-a',
        buildCandidates: async () => [],
        runImmediately: false,
    });

    assert.equal(typeof runtime.worker.start, 'function');
    assert.equal(typeof runtime.worker.runOnce, 'function');
    assert.equal(typeof runtime.jobStore.enqueue, 'function');
    assert.equal(typeof runtime.generationService.process, 'function');
    assert.equal(typeof runtime.loadWord, 'function');
    assert.equal(typeof runtime.publishReadyVariants, 'function');
});

test('generation service rejects variants whose Chinese analysis is incomplete', async () => {
    const fake = createFakeSupabase({
        words: [{ id: 'word-bank-finance', user_id: 'user-1', word: 'bank', meaning_zh: '银行', level: 'middle' }],
    });
    const invalid = {
        ...candidate('The student deposited money at the bank after class.'),
        context_zh: '银行',
        option_meanings: ['bank', 'shore', 'desk', 'road'],
        correct_meaning: 'bank',
    };
    const service = createSupabaseQuestionGenerationService({
        client: fake.client,
        buildCandidates: async () => [invalid, { ...invalid, question_text: 'The bank approved a loan for the family.' }],
        maxAttempts: 1,
    });

    await assert.rejects(
        service.process(generationJob()),
        error => error.code === 'INSUFFICIENT_DISTINCT_READY_VARIANTS'
            && error.rejectionReasons.bad_option_meanings >= 2
            && error.rejectionReasons.invalid_context_translation >= 2
    );
    assert.equal(fake.calls.some(call => call.name === 'publish_question_generation_variants'), false);
});

test('runtime records a typed translation failure for retry instead of hiding it', async () => {
    const pending = generationJob({
        status: 'pending',
        attempt_count: 0,
        lease_owner: null,
        lease_token: null,
        lease_expires_at: null,
    });
    const fake = createFakeSupabase({
        jobs: [pending],
        words: [{
            id: pending.word_id,
            user_id: pending.user_id,
            word: 'bank',
            meaning_zh: null,
            level: 'middle',
        }],
    });
    const runtime = createQuestionGenerationRuntime({
        client: fake.client,
        workerId: 'worker-a',
        now: () => new Date(NOW),
        buildCandidates: async () => {
            const error = new Error('Translation provider unavailable');
            error.code = 'TRANSLATION_PROVIDER_UNAVAILABLE';
            throw error;
        },
        runImmediately: false,
    });

    const result = await runtime.worker.runOnce();

    assert.deepEqual(result, { claimed: 1, completed: 0, failed: 1, abandoned: 0, lostLease: 0 });
    assert.equal(fake.state.question_generation_jobs[0].status, 'retry_wait');
    assert.equal(fake.state.question_generation_jobs[0].last_error_code, 'TRANSLATION_PROVIDER_UNAVAILABLE');
});



test('renew, complete, and fail transitions return the claimed version and lease token without application authorization timestamps', async () => {
    const operations = [
        ['renew', 'renew_question_generation_job'],
        ['complete', 'complete_question_generation_job'],
        ['fail', 'fail_question_generation_job'],
    ];
    for (const [method, rpcName] of operations) {
        const fake = createFakeSupabase({ jobs: [generationJob()] });
        const store = createSupabaseQuestionGenerationJobStore({
            client: fake.client,
            now: () => new Date('1999-01-01T00:00:00.000Z'),
            leaseDurationMs: 60_000,
        });
        if (method === 'fail') {
            await store.fail(generationJob(), Object.assign(new Error('generation failed'), {
                code: 'GENERATION_FAILED',
                rejectionReasons: { invalid: 1 },
            }), { workerId: 'worker-a' });
        } else {
            await store[method](generationJob(), { workerId: 'worker-a' });
        }
        const call = fake.calls.find(item => item.type === 'rpc');
        assert.equal(call.name, rpcName);
        assert.equal(Object.keys(call.args).some(key => /before|expires_at|valid_after|updated_at/.test(key)), false);
        assert.equal(call.args.p_expected_word_version, 1);
        assert.equal(call.args.p_lease_token, 'lease-1');
        assert.equal(fake.calls.some(item => item.type === 'job_update'), false);
    }
});

test('publish RPC no-op is translated to JOB_LEASE_NOT_OWNED_OR_STALE with zero cache writes', async () => {
    const staleJob = generationJob({ lease_owner: 'worker-b' });
    const old = {
        id: 'cache-old',
        user_id: staleJob.user_id,
        word_id: staleJob.word_id,
        round_type: 'primary',
        quality_status: 'ready',
        cache_state: 'active',
        question_fingerprint: 'old',
    };
    const fake = createFakeSupabase({ jobs: [staleJob], cache: [old] });
    const publish = createSupabaseReadyVariantPublisher({ client: fake.client, workerId: 'worker-a' });

    await assert.rejects(
        publish({
            job: generationJob(),
            variants: [
                { ...candidate('First atomic question.'), question_fingerprint: 'new-1' },
                { ...candidate('Second atomic question.'), question_fingerprint: 'new-2' },
            ],
        }),
        error => error.code === 'JOB_LEASE_NOT_OWNED_OR_STALE'
    );
    assert.deepEqual(fake.state.question_cache, [old]);
    assert.equal(fake.calls.some(call => ['cache_upsert', 'cache_update'].includes(call.type)), false);
});
