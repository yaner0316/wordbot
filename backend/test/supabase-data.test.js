const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { hashPassword } = require('../auth-service');

const {
    createSupabaseDataAdapter: createRawSupabaseDataAdapter,
    generateReplacementContextWithAI,
    hydrateFormalChallengeSnapshot,
} = require('../supabase-data');

const DEFAULT_TEST_CONTEXT_TRANSLATION = '这是当前英文题干对应的完整中文句子翻译';

function createSupabaseDataAdapter(client, options = {}) {
    const requestedTranslateWords = options.translateWords || (async words =>
        Object.fromEntries(words.map(word => [word, `中文释义-${word}`])));
    const translateWords = async words => {
        const translated = await requestedTranslateWords(words);
        return Object.fromEntries(words.map(word => {
            const base = String(translated?.[word] || '').trim();
            return [word, `${base || '中文释义'}-${word}`];
        }));
    };
    return createRawSupabaseDataAdapter(client, {
        translateContext: async () => DEFAULT_TEST_CONTEXT_TRANSLATION,
        ...options,
        translateWords,
    });
}

const MIDDLE = String.fromCharCode(0x4e2d, 0x5b66);
const contextualDistractorsForTest = async ({ excludedDistractors = [] }) => excludedDistractors.length
    ? ['delta', 'echo', 'foxtrot']
    : ['alpha', 'bravo', 'charlie'];

test('Supabase data adapter exposes database-backed child authentication', async () => {
    const salt = '00112233445566778899aabbccddeeff';
    const client = createFakeSupabase({
        users: [{
            id: 'user-test',
            username: 'test_user',
            username_key: 'test_user',
            password_hash: hashPassword('goodpass', salt),
            password_salt: salt,
            auth_created_at: '2026-08-16T00:00:00.000Z',
        }],
    });
    const adapter = createSupabaseDataAdapter(client);

    assert.deepEqual(
        await adapter.loginUser({ username: 'TEST_USER', password: 'goodpass' }),
        { user: 'test_user' }
    );
});

test('Supabase data adapter exposes database-backed admin user enumeration', async () => {
    const client = createFakeSupabase({
        users: [
            { id: 'user-2', username: 'yusi', username_key: 'yusi' },
            { id: 'user-1', username: 'Draggy', username_key: 'draggy' },
        ],
    });
    const adapter = createSupabaseDataAdapter(client);

    assert.deepEqual(await adapter.getAllUsers(), ['Draggy', 'yusi']);
});

test('Supabase data adapter exposes maintenance operations without a Feishu dependency', async () => {
    const adapter = createSupabaseDataAdapter(createFakeSupabase());

    assert.deepEqual(await adapter.deleteUserTestData('missing-user'), {
        success: true,
        deleted: 0,
        rebuilt: 0,
    });
    assert.deepEqual(await adapter.backfillTranslations('missing-user'), {
        cnFilled: 0,
        cnSkipped: 0,
        ctxFilled: 0,
        ctxSkipped: 0,
        total: 0,
    });
});

test('Supabase stats derive progress and quiz metrics from words and assessments', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
        words: [
            { id: 'word-1', user_id: 'user-1', word: 'apple', mastery_status: 'pending' },
            { id: 'word-2', user_id: 'user-1', word: 'banana', mastery_status: 'pending' },
            { id: 'word-3', user_id: 'user-1', word: 'cherry', mastery_status: 'pending' },
            { id: 'word-4', user_id: 'user-1', word: 'date', mastery_status: 'pending' },
        ],
        assessments: [
            { id: 'assessment-1', user_id: 'user-1', word_id: 'word-1', source_word_record_id: 'word-1', test_id: 'real-quiz-1', assessed_at: '2026-07-20T00:00:00.000Z', question_type: '1', is_correct: 'correct', submitted_answer: 'A|sure' },
            { id: 'assessment-2', user_id: 'user-1', word_id: 'word-1', source_word_record_id: 'word-1', test_id: 'real-quiz-2', assessed_at: '2026-07-21T00:00:00.000Z', question_type: '2', is_correct: 'correct', submitted_answer: 'A|sure' },
            { id: 'assessment-3', user_id: 'user-1', word_id: 'word-2', source_word_record_id: 'word-2', test_id: 'real-quiz-1', assessed_at: '2026-07-20T00:00:00.000Z', question_type: '1', is_correct: 'wrong', submitted_answer: 'B|sure' },
            { id: 'assessment-4', user_id: 'user-1', word_id: 'word-3', source_word_record_id: 'word-3', test_id: 'real-quiz-2', assessed_at: '2026-07-21T00:00:00.000Z', question_type: '3', is_correct: 'correct', submitted_answer: 'A|guess' },
            { id: 'assessment-5', user_id: 'user-1', word_id: 'word-4', source_word_record_id: 'word-4', test_id: 'real-review-1', assessment_kind: 'review', assessed_at: '2026-07-21T00:00:00.000Z', question_type: '4', is_correct: 'correct', submitted_answer: 'A|sure' },
        ],
    });
    const adapter = createSupabaseDataAdapter(client);

    assert.deepEqual(await adapter.getStats('qiuqiu'), {
        user: 'qiuqiu',
        totalWords: 4,
        totalMeanings: 4,
        masteredWords: 1,
        recognizedWords: 1,
        consolidatingWords: 1,
        unseenWords: 1,
        pendingWords: 3,
        masteryStageCounts: { mastered: 1, consolidating: 1, recognized: 1, unseen: 1 },
        totalTests: 2,
        totalQuestions: 4,
        correctCount: 3,
        accuracyRate: '75.0%',
        lastTestTime: new Date('2026-07-21T00:00:00.000Z').getTime(),
    });

    assert.deepEqual(await adapter.getAllStats(), [await adapter.getStats('qiuqiu')]);
});

test('formal challenge hydration restores the canonical word when an old snapshot omitted it', () => {
    const question = hydrateFormalChallengeSnapshot(
        { context: 'I ate an _____.', options: ['A. apple', 'B. pear', 'C. desk', 'D. book'], answer: 'A' },
        { id: 'challenge-question-1', ordinal: 1, meaning_id: 'word-1', cache_question_id: 'cache-1', stem: 'I ate an _____.' },
        { question_text: 'I ate an _____.', options: ['A. apple', 'B. pear', 'C. desk', 'D. book'], answer: 'A', question_type: 1 },
        { id: 'word-1', feishu_record_id: 'rec-word-1', word: 'apple' },
    );
    assert.equal(question.word, 'apple');
    assert.equal(question.wordRecordId, 'rec-word-1');
});

test('Supabase game state persists shared minutes and garden state', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
    });
    const adapter = createSupabaseDataAdapter(client);
    await adapter.saveGameState('qiuqiu', {
        minutes: 12,
        claimIds: ['quiz-1'],
        garden: { hearts: 3, feed: 2, outfit: '草帽', visits: 1 },
    });
    assert.deepEqual(await adapter.getGameState('qiuqiu'), {
        minutes: 12,
        claimIds: ['quiz-1'],
        garden: {
            hearts: 3,
            feed: 2,
            outfit: '草帽',
            visits: 1,
            lastAction: 'idle',
            lastGain: {},
        },
    });
});
function createFakeSupabase(seed = {}, options = {}) {
    const operations = [];
    const readOperations = [];
    const db = {
        users: [],
        words: [],
        assessments: [],
        question_cache: [],
        question_generation_jobs: [],
        quiz_sessions: [],
        game_states: [],
        parts_of_speech: [],
        word_parts_of_speech: [],
        ...seed,
    };
    db.question_cache = db.question_cache.map(row => {
        const isTypeOne = String(row.question_type || '1') === '1';
        if (!isTypeOne || Object.prototype.hasOwnProperty.call(row, 'context_zh')) return row;
        return {
            ...row,
            context_zh: DEFAULT_TEST_CONTEXT_TRANSLATION,
        };
    });

    function matchesLike(value, pattern) {
        assert.equal(pattern, 'test-%', 'fake Supabase only implements the LIKE pattern used by quiz sessions');
        return String(value ?? '').startsWith('test-');
    }

    function matches(row, filters) {
        return filters.every(filter => {
            if (filter.type === 'eq') return row[filter.column] === filter.value;
            if (filter.type === 'in') return filter.values.includes(row[filter.column]);
            if (filter.type === 'gt') return row[filter.column] > filter.value;
            if (filter.type === 'lt') return row[filter.column] < filter.value;
            if (filter.type === 'lte') return row[filter.column] <= filter.value;
            if (filter.type === 'like') return matchesLike(row[filter.column], filter.value);
            if (filter.type === 'not' && filter.operator === 'like') {
                return !matchesLike(row[filter.column], filter.value);
            }
            return true;
        });
    }

    class Query {
        constructor(table) {
            this.table = table;
            this.filters = [];
            this.orders = [];
            this.limitCount = null;
            this.operation = 'select';
            this.payload = null;
        }

        select(columns) { this.selectColumns = columns; return this; }
        order(column, orderOptions = {}) {
            this.orders.push({ column, ascending: orderOptions.ascending !== false });
            return this;
        }
        range() { return Promise.resolve(this._result()); }
        limit(count) { this.limitCount = count; return this; }
        eq(column, value) { this.filters.push({ type: 'eq', column, value }); return this; }
        in(column, values) { this.filters.push({ type: 'in', column, values }); return this; }
        gt(column, value) { this.filters.push({ type: 'gt', column, value }); return this; }
        lt(column, value) { this.filters.push({ type: 'lt', column, value }); return this; }
        lte(column, value) { this.filters.push({ type: 'lte', column, value }); return this; }
        like(column, value) { this.filters.push({ type: 'like', column, value }); return this; }
        not(column, operator, value) {
            this.filters.push({ type: 'not', column, operator, value });
            return this;
        }

        insert(payload) {
            this.operation = 'insert';
            this.payload = Array.isArray(payload) ? payload : [payload];
            return this;
        }

        upsert(payload, upsertOptions = {}) {
            this.operation = 'upsert';
            this.payload = Array.isArray(payload) ? payload : [payload];
            this.upsertOptions = upsertOptions;
            return this;
        }

        update(payload) {
            this.operation = 'update';
            this.payload = payload;
            return this;
        }

        delete() {
            this.operation = 'delete';
            return this;
        }

        maybeSingle() {
            const { data, error } = this._result();
            return Promise.resolve({ data: data?.[0] || null, error });
        }

        single() {
            const { data, error } = this._result();
            return Promise.resolve({ data: data?.[0] || null, error });
        }

        then(resolve, reject) {
            return Promise.resolve(this._result()).then(resolve, reject);
        }

        _result() {
            const tableRows = db[this.table];
            if (!tableRows) return { data: null, error: new Error(`unknown table ${this.table}`) };

            const operation = {
                table: this.table,
                operation: this.operation,
                filters: this.filters.map(filter => ({ ...filter })),
                orders: this.orders.map(order => ({ ...order })),
                limitCount: this.limitCount,
                payload: Array.isArray(this.payload)
                    ? this.payload.map(row => ({ ...row }))
                    : this.payload && { ...this.payload },
                upsertOptions: this.upsertOptions && { ...this.upsertOptions },
                selectColumns: this.selectColumns,
            };
            if (this.operation !== 'select') {
                options.beforeOperation?.({ ...operation, db, operations });
                operations.push(operation);
            } else {
                readOperations.push(operation);
            }

            if (this.operation === 'update' && options.failUpdateForOnce === this.table) {
                options.failUpdateForOnce = null;
                return { data: null, error: new Error('forced ' + this.table + ' update failure') };
            }
            if (this.operation === 'update' && options.failUpdateFor === this.table) {
                return { data: null, error: new Error('forced ' + this.table + ' update failure') };
            }
            if (this.operation === 'upsert' && options.failUpsertFor === this.table) {
                return { data: null, error: new Error('forced ' + this.table + ' upsert failure') };
            }
            if (this.operation === 'delete' && options.failDeleteForOnce === this.table) {
                options.failDeleteForOnce = null;
                return { data: null, error: new Error(`forced ${this.table} delete failure`) };
            }
            if (this.operation === 'delete' && options.failDeleteFor === this.table) {
                return { data: null, error: new Error(`forced ${this.table} delete failure`) };
            }

            if (this.operation === 'insert' || this.operation === 'upsert') {
                const missingColumns = options.missingColumns?.[this.table] || [];
                const missingColumn = missingColumns.find(column =>
                    this.payload.some(row => Object.prototype.hasOwnProperty.call(row, column))
                );
                if (missingColumn) {
                    return {
                        data: null,
                        error: {
                            code: 'PGRST204',
                            message: "Could not find the '" + missingColumn + "' column of '" + this.table + "' in the schema cache",
                        },
                    };
                }
                const hasQuestionCacheConflict = candidate => tableRows.some(existingRow =>
                    existingRow.user_id === candidate.user_id
                    && existingRow.word_id === candidate.word_id
                    && existingRow.question_fingerprint === candidate.question_fingerprint
                );
                if (this.table === 'question_cache' && this.operation === 'insert'
                    && this.payload.some(hasQuestionCacheConflict)) {
                    return {
                        data: null,
                        error: {
                            code: '23505',
                            message: 'duplicate key value violates unique constraint question_cache_user_id_word_id_question_fingerprint_key',
                        },
                    };
                }
                if (this.table === 'question_cache' && this.operation === 'upsert') {
                    const payloadFingerprints = this.payload
                        .filter(row => row.question_fingerprint)
                        .map(row => [row.user_id, row.word_id, row.question_fingerprint].join('|'));
                    if (new Set(payloadFingerprints).size !== payloadFingerprints.length) {
                        return {
                            data: null,
                            error: {
                                code: '21000',
                                message: 'ON CONFLICT DO UPDATE command cannot affect row a second time',
                            },
                        };
                    }
                }
                const inserted = this.payload.map(row => {
                    const next = { ...row };
                    if (!next.id && ['words', 'assessments', 'question_cache'].includes(this.table)) {
                        next.id = `${this.table}-${tableRows.length + 1}`;
                    }
                    if (this.operation === 'upsert' && this.table === 'quiz_sessions') {
                        const existing = tableRows.find(existingRow => existingRow.test_id === next.test_id);
                        if (existing) {
                            Object.assign(existing, next);
                            return existing;
                        }
                    }
                    if (this.operation === 'upsert' && this.table === 'question_cache'
                        && this.upsertOptions.onConflict === 'user_id,word_id,question_fingerprint') {
                        const existing = tableRows.find(existingRow =>
                            existingRow.user_id === next.user_id
                            && existingRow.word_id === next.word_id
                            && existingRow.question_fingerprint === next.question_fingerprint
                        );
                        if (existing) {
                            const existingId = existing.id;
                            Object.assign(existing, next);
                            existing.id = existingId;
                            return existing;
                        }
                    }
                    if (this.operation === 'upsert' && this.table === 'question_generation_jobs'
                        && this.upsertOptions.onConflict === 'word_id') {
                        const existing = tableRows.find(existingRow => existingRow.word_id === next.word_id);
                        if (existing) {
                            const existingId = existing.id;
                            Object.assign(existing, next);
                            existing.id = existingId;
                            return existing;
                        }
                    }
                    tableRows.push(next);
                    return next;
                });
                return { data: inserted, error: null };
            }

            let rows = tableRows.filter(row => matches(row, this.filters));
            if (this.operation === 'delete') {
                for (let index = tableRows.length - 1; index >= 0; index--) {
                    if (matches(tableRows[index], this.filters)) tableRows.splice(index, 1);
                }
                return { data: rows, error: null };
            }
            if (this.operation === 'update') {
                rows = rows.map(row => {
                    Object.assign(row, this.payload);
                    return row;
                });
            }
            for (const order of this.orders.slice().reverse()) {
                rows.sort((left, right) => {
                    const comparison = String(left[order.column] ?? '').localeCompare(String(right[order.column] ?? ''));
                    return order.ascending ? comparison : -comparison;
                });
            }
            const rowLimits = [this.limitCount, options.maxSelectRows].filter(Number.isInteger);
            if (rowLimits.length) rows = rows.slice(0, Math.min(...rowLimits));
            return { data: rows, error: null };
        }
    }

    return {
        async rpc(name, args) {
            operations.push({ table: 'rpc', operation: 'rpc', name, args: { ...args } });
            if (options.failRpcName === name) return { data: null, error: new Error(`forced ${name} failure`) };
            if (options.failRpcNameOnce === name) {
                options.failRpcNameOnce = null;
                return { data: null, error: new Error(`forced ${name} failure`) };
            }
            if (name === 'fence_word_question_generation') {
                const word = db.words.find(row => row.id === args.p_word_id && row.user_id === args.p_user_id);
                if (!word) return { data: null, error: null };
                word.question_generation_version = Number(word.question_generation_version || 1) + 1;
                const job = db.question_generation_jobs.find(row => row.word_id === word.id);
                const patch = { user_id: word.user_id, word_id: word.id, word_version: word.question_generation_version, status: 'pending', reason: 'word_edit', attempt_count: 0, next_attempt_at: '9999-12-31T23:59:59.999Z', lease_owner: null, lease_expires_at: null, lease_token: null, last_error_code: null, last_error_detail: null, rejection_reasons: {} };
                if (job) Object.assign(job, patch);
                else db.question_generation_jobs.push({ id: `job-${db.question_generation_jobs.length + 1}`, ...patch });
                db.question_cache = db.question_cache.filter(row => row.user_id !== word.user_id || row.word_id !== word.id);
                return { data: word.question_generation_version, error: null };
            }
            if (name === 'finalize_word_question_generation_edit') {
                const word = db.words.find(row => row.id === args.p_word_id && row.user_id === args.p_user_id);
                if (!word) return { data: false, error: null };
                const eligible = word.mastery_status !== 'mastered' && String(word.word || '').toLowerCase() !== 'genaine' && /^[a-z]+([ '-][a-z]+)*$/i.test(String(word.word || '').trim());
                if (!eligible) {
                    db.question_cache = db.question_cache.filter(row => row.user_id !== word.user_id || row.word_id !== word.id);
                    db.question_generation_jobs = db.question_generation_jobs.filter(row => row.user_id !== word.user_id || row.word_id !== word.id);
                    return { data: false, error: null };
                }
                const job = db.question_generation_jobs.find(row => row.word_id === word.id);
                const patch = { user_id: word.user_id, word_id: word.id, word_version: word.question_generation_version, status: 'pending', reason: 'word_edit', attempt_count: 0, next_attempt_at: 'rpc-now', lease_owner: null, lease_expires_at: null, lease_token: null, last_error_code: null, last_error_detail: null, rejection_reasons: {} };
                if (job) Object.assign(job, patch);
                else db.question_generation_jobs.push({ id: `job-${db.question_generation_jobs.length + 1}`, ...patch });
                return { data: true, error: null };
            }
            if (name !== 'enqueue_question_generation_job_if_needed') return { data: null, error: new Error(`unknown rpc ${name}`) };
            if (options.rpcDataFalseAlways) return { data: false, error: null };
            if (options.rpcDataFalseOnce) {
                options.rpcDataFalseOnce = false;
                return { data: false, error: null };
            }
            const job = db.question_generation_jobs.find(row => row.word_id === args.p_word_id && row.user_id === args.p_user_id);
            if (!job) {
                db.question_generation_jobs.push({
                    id: `job-${db.question_generation_jobs.length + 1}`,
                    user_id: args.p_user_id,
                    word_id: args.p_word_id,
                    status: 'pending',
                    reason: args.p_reason,
                    attempt_count: 0,
                });
                return { data: true, error: null };
            }
            if (['ready', 'needs_manual_review'].includes(job.status)) {
                Object.assign(job, {
                    status: 'pending', reason: args.p_reason, attempt_count: 0,
                    next_attempt_at: 'rpc-now', lease_owner: null, lease_expires_at: null,
                    last_error_code: null, last_error_detail: null, rejection_reasons: {}, updated_at: 'rpc-now',
                });
                return { data: true, error: null };
            }
            return { data: false, error: null };
        },
        db,
        queries: [],
        readOperations,
        operations,
        from(table) {
            this.queries.push(table);
            return new Query(table);
        },
    };
}

function seededClient() {
    return createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
        words: [{
            id: 'word-1',
            feishu_record_id: 'rec-word-1',
            user_id: 'user-1',
            word: 'Apple',
            meaning_en: 'a fruit',
            level: MIDDLE,
            mastery_status: 'pending',
            entered_at: '2026-07-18T00:00:00.000Z',
        }],
        question_cache: [{
            id: 'cache-1',
            feishu_record_id: 'rec-cache-1',
            user_id: 'user-1',
            word_id: 'word-1',
            used_count: 4,
        }],
        parts_of_speech: [
            { id: 1, code: 'noun', display_name: 'noun' },
            { id: 2, code: 'adjective', display_name: 'adjective' },
        ],
    });
}

test('submitAssessment resolves username and source word record to Supabase foreign keys', async () => {
    const client = seededClient();
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '中文释义'])),
    });

    const row = await adapter.submitAssessment({
        username: 'qiuqiu',
        word: 'Apple',
        sourceWordRecordId: 'rec-word-1',
        testId: 'real-gate4-test',
        questionType: 1,
        correctness: 'correct',
        yourAnswer: 'A',
        confidence: 'sure',
        source: 'question_cache',
        recordTime: '2026-07-19T10:30:00.000Z',
        level: MIDDLE,
        questionText: 'I ate an _____.',
        options: ['A. Apple', 'B. Pear', 'C. Chair', 'D. Desk'],
        correctAnswer: 'A',
    });

    assert.equal(row.user_id, 'user-1');
    assert.equal(row.word_id, 'word-1');
    assert.equal(row.source_word_record_id, 'rec-word-1');
    assert.equal(row.word_snapshot, 'Apple');
    assert.equal(row.question_type, '1');
    assert.equal(row.is_correct, 'correct');
    assert.equal(row.submitted_answer, 'A');
    assert.equal(row.answer_confidence, 'sure');
    assert.equal(row.learning_day, '2026-07-19');
});

test('updateWordMastery updates the resolved user word row', async () => {
    const client = seededClient();
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '中文释义'])),
    });

    const rows = await adapter.updateWordMastery('qiuqiu', 'Apple', 'mastered');

    assert.equal(rows.length, 1);
    assert.equal(client.db.words[0].mastery_status, 'mastered');
    assert.ok(client.db.words[0].remembered_at);
});

test('quiz mastery fences and finalizes only the exact same-spelling meaning, and retries after finalize failure', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
        words: [
            { id: 'word-1', feishu_record_id: 'rec-1', user_id: 'user-1', word: 'bank', meaning_en: 'finance', mastery_status: 'pending' },
            { id: 'word-2', feishu_record_id: 'rec-2', user_id: 'user-1', word: 'bank', meaning_en: 'river', mastery_status: 'pending' },
        ],
        question_cache: [{ id: 'cache-1', user_id: 'user-1', word_id: 'word-1' }, { id: 'cache-2', user_id: 'user-1', word_id: 'word-2' }],
        question_generation_jobs: [{ id: 'job-1', user_id: 'user-1', word_id: 'word-1', status: 'generating' }, { id: 'job-2', user_id: 'user-1', word_id: 'word-2', status: 'ready' }],
    }, { failRpcNameOnce: 'finalize_word_question_generation_edit' });
    const adapter = createSupabaseDataAdapter(client);
    await assert.rejects(adapter.updateWordMastery('qiuqiu', 'bank', 'mastered', { sourceWordRecordId: 'rec-1' }));
    await adapter.updateWordMastery('qiuqiu', 'bank', 'mastered', { sourceWordRecordId: 'rec-1' });
    assert.deepEqual(client.db.question_cache.map(row => row.id), ['cache-2']);
    assert.deepEqual(client.db.question_generation_jobs.map(row => row.id), ['job-2']);
    assert.equal(client.db.words.find(row => row.id === 'word-2').mastery_status, 'pending');
});
test('updateWord maps editable fields to the recordId-owned Supabase word', async () => {
    const client = seededClient();
    client.db.words.push({
        id: 'word-2', feishu_record_id: 'rec-word-2', user_id: 'user-1',
        word: 'Apple', meaning_en: 'a technology company', mastery_status: 'pending',
    });
    client.db.parts_of_speech.push({ id: 3, code: 'verb', display_name: 'verb' });
    const adapter = createSupabaseDataAdapter(client);
    await adapter.updateWord('qiuqiu', 'Apple', {
        recordId: 'rec-word-2', word: 'apple', meaning: 'a technology company',
        cnMeaning: '????', pos: 'verb', context: 'Apple announced a product.',
        distractors: ['pear', 'banana', 'orange'], status: 'recognized',
        qualityFlags: ['reviewed'], qualityNote: 'confirmed',
    });
    const updated = client.db.words.find(row => row.id === 'word-2');
    assert.equal(updated.word, 'apple');
    assert.equal(updated.meaning_en, 'a technology company');
    assert.equal(updated.meaning_zh, '????');
    assert.equal(updated.context_en, 'Apple announced a product.');

    assert.deepEqual(updated.distractors, ['pear', 'banana', 'orange']);
    assert.equal(updated.mastery_status, 'recognized');
    assert.deepEqual(updated.quality_flags, ['reviewed']);
    assert.equal(updated.quality_note, 'confirmed');
    assert.deepEqual(client.db.word_parts_of_speech.filter(row => row.word_id === 'word-2').map(row => row.part_of_speech_id), [3]);
});
test('updateWord normalizes quality flag strings to the words text array', async () => {
    const cases = [
        { value: '', expected: [] },
        { value: '["reviewed", " needs_context ", ""]', expected: ['reviewed', 'needs_context'] },
        { value: 'reviewed, needs_context, ', expected: ['reviewed', 'needs_context'] },
        { value: ['reviewed', ' needs_context ', ''], expected: ['reviewed', ' needs_context ', ''] },
    ];

    for (const { value, expected } of cases) {
        const client = seededClient();
        await createSupabaseDataAdapter(client).updateWord('qiuqiu', 'Apple', {
            recordId: 'rec-word-1',
            qualityFlags: value,
        });
        assert.deepEqual(client.db.words.find(row => row.id === 'word-1').quality_flags, expected);
    }
});

test('updateWord gives recordId priority when a conflicting wordId is supplied', async () => {
    const client = seededClient();
    client.db.words.push({
        id: 'word-2', feishu_record_id: 'rec-word-2', user_id: 'user-1',
        word: 'Apple', meaning_en: 'a technology company', mastery_status: 'pending',
    });

    await createSupabaseDataAdapter(client).updateWord('qiuqiu', 'Apple', {
        recordId: 'rec-word-2', wordId: 'word-1', meaning: 'an updated technology company meaning',
    });

    assert.equal(client.db.words.find(row => row.id === 'word-1').meaning_en, 'a fruit');
    assert.equal(client.db.words.find(row => row.id === 'word-2').meaning_en, 'an updated technology company meaning');
});

test('updateWord fences the exact meaning with RPCs before word and POS writes', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
        words: [
            { id: 'word-finance', feishu_record_id: 'rec-finance', user_id: 'user-1', word: 'bank', meaning_en: 'financial institution', mastery_status: 'pending' },
            { id: 'word-river', feishu_record_id: 'rec-river', user_id: 'user-1', word: 'bank', meaning_en: 'river edge', mastery_status: 'pending' },
        ],
        question_cache: [{ id: 'cache-river', user_id: 'user-1', word_id: 'word-river' }],
        parts_of_speech: [{ id: 1, code: 'noun', display_name: 'noun' }],
    });
    await createSupabaseDataAdapter(client).updateWord('qiuqiu', 'bank', {
        recordId: 'rec-finance', meaning: 'a financial institution', pos: 'noun',
    });
    const rpcNames = client.operations.filter(row => row.operation === 'rpc').map(row => row.name);
    const fenceIndex = client.operations.findIndex(row => row.operation === 'rpc' && row.name === 'fence_word_question_generation');
    const wordIndex = client.operations.findIndex(row => row.table === 'words' && row.operation === 'update');
    const posIndex = client.operations.findIndex(row => row.table === 'word_parts_of_speech' && row.operation === 'delete');
    const finalizeIndex = client.operations.findIndex(row => row.operation === 'rpc' && row.name === 'finalize_word_question_generation_edit');
    assert.deepEqual(rpcNames, ['fence_word_question_generation', 'finalize_word_question_generation_edit']);
    assert.ok(fenceIndex < wordIndex && wordIndex < posIndex && posIndex < finalizeIndex);
    assert.deepEqual(client.db.question_generation_jobs.map(row => row.word_id), ['word-finance']);
    assert.deepEqual(client.db.question_cache.map(row => row.id), ['cache-river']);
});

test('mastered and invalid edits finalize by removing only their fenced cache and job', async () => {
    for (const fields of [{ status: 'mastered' }, { word: 'genaine' }]) {
        const client = createFakeSupabase({
            users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
            words: [{ id: 'word-1', feishu_record_id: 'rec-1', user_id: 'user-1', word: 'apple', meaning_en: 'fruit', mastery_status: 'pending' }],
            question_cache: [{ id: 'cache-1', user_id: 'user-1', word_id: 'word-1' }],
            question_generation_jobs: [{ id: 'job-1', user_id: 'user-1', word_id: 'word-1', status: 'generating' }],
        });
        await createSupabaseDataAdapter(client).updateWord('qiuqiu', 'apple', { recordId: 'rec-1', ...fields });
        assert.deepEqual(client.db.question_cache, []);
        assert.deepEqual(client.db.question_generation_jobs, []);
    }
});

test('same update payload recovers after POS, word, or finalize failure', async () => {
    const cases = [
        { fields: { pos: 'noun' }, options: { failDeleteForOnce: 'word_parts_of_speech' } },
        { fields: { context: 'An apple fell.' }, options: { failUpdateForOnce: 'words' } },
        { fields: { context: 'An apple fell.' }, options: { failRpcNameOnce: 'finalize_word_question_generation_edit' } },
    ];
    for (const testCase of cases) {
        const client = createFakeSupabase({
            users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
            words: [{ id: 'word-1', feishu_record_id: 'rec-1', user_id: 'user-1', word: 'apple', meaning_en: 'fruit', mastery_status: 'pending' }],
            parts_of_speech: [{ id: 1, code: 'noun', display_name: 'noun' }],
        }, testCase.options);
        const adapter = createSupabaseDataAdapter(client);
        const payload = { recordId: 'rec-1', ...testCase.fields };
        await assert.rejects(adapter.updateWord('qiuqiu', 'apple', payload));
        await adapter.updateWord('qiuqiu', 'apple', payload);
        assert.equal(client.db.question_generation_jobs.length, 1);
        assert.equal(client.db.question_generation_jobs[0].status, 'pending');
        assert.equal(client.db.question_generation_jobs[0].lease_owner, null);
    }
});
test('updateWord rejects an unowned recordId instead of changing a same-spelling word', async () => {
    const client = seededClient();
    client.db.words.push({
        id: 'word-other', feishu_record_id: 'rec-other', user_id: 'user-2',
        word: 'Apple', meaning_en: 'other user word', mastery_status: 'pending',
    });
    const adapter = createSupabaseDataAdapter(client);
    await assert.rejects(
        adapter.updateWord('qiuqiu', 'Apple', { recordId: 'rec-other', meaning: 'wrong target' }),
        /WORD_NOT_FOUND/
    );
    assert.equal(client.db.words.find(row => row.id === 'word-1').meaning_en, 'a fruit');
});

test('incrementCacheUsedCount resolves Feishu cache IDs before updating used_count', async () => {
    const client = seededClient();
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '中文释义'])),
    });

    const row = await adapter.incrementCacheUsedCount('rec-cache-1');

    assert.equal(row.id, 'cache-1');
    assert.equal(row.used_count, 5);
    assert.ok(row.last_used_at);
});

test('incrementCacheUsedCount resolves database cache rows by source word record id', async () => {
    const client = seededClient();
    client.db.question_cache.push({
        id: 'cache-source-id',
        feishu_record_id: null,
        source_word_record_id: 'rec-source-word-1',
        user_id: 'user-1',
        word_id: 'word-1',
        round_type: 'primary',
        used_count: 0,
    });
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '中文释义'])),
    });

    const row = await adapter.incrementCacheUsedCount('rec-source-word-1');

    assert.equal(row.id, 'cache-source-id');
    assert.equal(row.used_count, 1);
});

test('addWord inserts a word and ordered parts of speech junction rows', async () => {
    const client = seededClient();
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '中文释义'])),
    });

    const row = await adapter.addWord({
        username: 'qiuqiu',
        word: 'candid',
        meaning: 'honest and direct',
        level: MIDDLE,
        partsOfSpeech: 'n., adjective',
        recordTime: '2026-07-19T12:00:00.000Z',
    });

    assert.equal(row.user_id, 'user-1');
    assert.equal(row.word, 'candid');
    assert.equal(row.meaning_en, 'honest and direct');
    assert.equal(row.mastery_status, 'pending');
    assert.deepEqual(client.db.word_parts_of_speech.slice(-2), [
        { word_id: row.id, part_of_speech_id: 1, position: 1 },
        { word_id: row.id, part_of_speech_id: 2, position: 2 },
    ]);
});

test('addWords inserts multiple words through Supabase addWord path', async () => {
    const client = seededClient();
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '中文释义'])),
    });

    const result = await adapter.addWords('qiuqiu', [
        { word: 'orange', meaning: 'a citrus fruit', level: MIDDLE, POS: ['noun'] },
        { Word: 'brisk', Meaning: 'quick and active', Level: MIDDLE, POS: 'adj.' },
    ]);

    assert.equal(result.success, true);
    assert.equal(result.count, 2);
    assert.deepEqual(result.errors, []);
    assert.equal(client.db.words.at(-2).word, 'orange');
    assert.equal(client.db.words.at(-1).word, 'brisk');
    assert.deepEqual(client.db.word_parts_of_speech.slice(-2), [
        { word_id: client.db.words.at(-2).id, part_of_speech_id: 1, position: 1 },
        { word_id: client.db.words.at(-1).id, part_of_speech_id: 2, position: 1 },
    ]);
});

test('stats and formal quiz word reads do not join the parent-only parts-of-speech table', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
        words: [{ id: 'word-1', user_id: 'user-1', word: 'apple', mastery_status: 'pending' }],
        assessments: [],
    });
    const adapter = createSupabaseDataAdapter(client);

    await adapter.getStats('qiuqiu');
    await adapter.getQuizWordsForUser('qiuqiu');

    assert.equal(client.readOperations.some(row => row.table === 'word_parts_of_speech'), false);
    assert.ok(client.readOperations.filter(row => row.table === 'words').length >= 2);
    assert.ok(client.readOperations.filter(row => row.table === 'assessments').length >= 1);
});

test('addWords requires confirmation before inserting a spelling that already exists for the child', async () => {
    const client = seededClient();
    const adapter = createSupabaseDataAdapter(client);
    const before = client.db.words.length;

    const result = await adapter.addWords('qiuqiu', [
        { word: 'apple', cnMeaning: '另一个释义' },
    ]);

    assert.equal(result.success, false);
    assert.equal(result.code, 'DUPLICATE_WORD_CONFIRMATION_REQUIRED');
    assert.equal(result.count, 0);
    assert.equal(client.db.words.length, before);
    assert.equal(result.duplicateWords[0].word, 'apple');
});

test('addWords reports a per-entry generation-job failure as a failed result', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
    }, { failUpsertFor: 'question_generation_jobs' });
    const adapter = createSupabaseDataAdapter(client);
    const result = await adapter.addWords('qiuqiu', [
        { word: 'new-word', meaning: 'a definition' },
    ]);

    assert.equal(result.success, false);
    assert.equal(result.count, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /questionGenerationJob/);
});

test('question cache status summarizes Supabase rows by level', async () => {
    const client = seededClient();
    client.db.quiz_display_events = [];
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '中文释义'])),
    });
    client.db.question_cache[0] = {
        ...client.db.question_cache[0],
        level: MIDDLE,
        round_type: 'primary',
        quality_status: 'ready',
        question_type: 1,
        question_fingerprint: 'fp-status-1',
        question_text: 'I ate an _____ after lunch.',
        options: ['A. apple', 'B. pear', 'C. chair', 'D. desk'],
        answer: 'A',
        option_meanings: ['水果', '水果', '座位', '家具'],
        correct_meaning: String.fromCharCode(0x6c34, 0x679c),
        generated_at: '2026-07-19T12:00:00.000Z',
    };
    client.db.question_cache[0].option_meanings = ['水果', '梨子', '座位', '家具'];

    const status = await adapter.getQuestionCacheStatus('qiuqiu');

    assert.equal(status.configured, true);
    assert.equal(status.total, 1);
    assert.equal(status.ready, 1);
    assert.equal(status.byLevel[MIDDLE].ready, 1);
});

test('learning settings checks only the selected level cache without scanning quiz history', async () => {
    const client = createFakeSupabase({
        users: [{
            id: 'user-1',
            username: 'qiuqiu',
            username_key: 'qiuqiu',
            learning_level: MIDDLE,
        }],
        words: [{ id: 'word-1', user_id: 'user-1', word: 'apple', level: MIDDLE }],
        assessments: [{ id: 'assessment-1', user_id: 'user-1', word_id: 'word-1' }],
        question_generation_jobs: [{ id: 'job-1', user_id: 'user-1', status: 'ready' }],
        question_cache: Array.from({ length: 12 }, (_, index) => ({
            id: 'cache-' + (index + 1),
            user_id: 'user-1',
            level: index === 11 ? String.fromCharCode(0x9ad8, 0x4e2d) : MIDDLE,
            quality_status: 'ready',
            cache_state: 'active',
        })),
    });
    const adapter = createSupabaseDataAdapter(client);

    const settings = await adapter.getUserLearningSettings('qiuqiu');

    assert.equal(settings.questionCacheStatus, 'ready');
    assert.deepEqual(client.queries, ['users', 'question_cache']);
});

test('question cache status reports formal eligible meanings by level', async () => {
    const OTHER = 'CET4_6_TOEFL';
    const now = Date.now();
    const oldEnteredAt = new Date(now - (20 * 60 * 60 * 1000)).toISOString();
    const recentEnteredAt = new Date(now - (17 * 60 * 60 * 1000)).toISOString();
    const cacheRow = (id, wordId, level, overrides = {}) => {
        const targetWord = {
            'word-1': 'bank',
            'word-2': 'apple',
            'word-3': 'river',
            'word-4': 'recent',
        }[wordId];
        return {
            id,
            user_id: 'user-1',
            word_id: wordId,
            word: targetWord,
            level,
            round_type: 'primary',
            quality_status: 'ready',
            cache_state: 'active',
            variant_slot: Number(id.slice(-1)),
            question_fingerprint: `fp-${id}`,
            question_type: 1,
            question_text: `We used the word ${targetWord} naturally in example ${id}.`,
            options: [`A. ${targetWord}`, `B. chair-${id}`, `C. pencil-${id}`, `D. window-${id}`],
            answer: 'A',
            option_meanings: ['正确词义', '错误词义一', '错误词义二', '错误词义三'],
            correct_meaning: '正确词义',
            ...overrides,
        };
    };
    const client = createFakeSupabase({
        users: [{
            id: 'user-1',
            username: 'qiuqiu',
            username_key: 'qiuqiu',
            learning_level: MIDDLE,
        }],
        words: [
            { id: 'word-1', user_id: 'user-1', word: 'bank', meaning_en: 'financial institution', level: MIDDLE, entered_at: oldEnteredAt },
            { id: 'word-2', user_id: 'user-1', word: 'apple', meaning_en: 'fruit', level: MIDDLE, entered_at: oldEnteredAt },
            { id: 'word-3', user_id: 'user-1', word: 'river', meaning_en: 'waterway', level: OTHER, entered_at: oldEnteredAt },
            { id: 'word-4', user_id: 'user-1', word: 'recent', meaning_en: 'new', level: MIDDLE, entered_at: recentEnteredAt },
        ],
        question_cache: [
            cacheRow('cache-11', 'word-1', MIDDLE),
            cacheRow('cache-12', 'word-1', MIDDLE),
            cacheRow('cache-21', 'word-2', MIDDLE),
            cacheRow('cache-22', 'word-2', MIDDLE, { cache_state: 'retired' }),
            cacheRow('cache-31', 'word-3', OTHER),
            cacheRow('cache-32', 'word-3', OTHER),
            cacheRow('cache-41', 'word-4', MIDDLE),
            cacheRow('cache-42', 'word-4', MIDDLE),
        ],
        quiz_display_events: [
            {
                id: 'display-11', user_id: 'user-1', meaning_id: 'word-1',
                stem: 'We used the word bank naturally in example cache-11.',
                displayed_at: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
                history_expires_at: new Date(now + 29 * 24 * 60 * 60 * 1000).toISOString(),
                counts_for_cooldown: true,
            },
            {
                id: 'display-12', user_id: 'user-1', meaning_id: 'word-1',
                stem: 'We used the word bank naturally in example cache-12.',
                displayed_at: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
                history_expires_at: new Date(now + 29 * 24 * 60 * 60 * 1000).toISOString(),
                counts_for_cooldown: true,
            },
        ],
    });
    const adapter = createSupabaseDataAdapter(client);

    const status = await adapter.getQuestionCacheStatus('qiuqiu');

    assert.deepEqual(status.eligibleReadyMeaningsByLevel, {
        [String.fromCharCode(0x5c0f, 0x5b66)]: 0,
        [MIDDLE]: 0,
        [String.fromCharCode(0x9ad8, 0x4e2d)]: 0,
        [OTHER]: 1,
    });
    assert.equal(status.eligibleReadyMeanings, 0);
});

test('formal display event reader preserves the real table shape without fabricating test_id', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
        quiz_display_events: [{
            id: 'display-real-shape', user_id: 'user-1', meaning_id: 'meaning-1',
            stem: 'A real display _____ stem.',
            displayed_at: '2026-08-11T00:00:00.000Z',
            history_expires_at: '2026-09-10T00:00:00.000Z',
            counts_for_cooldown: true,
        }],
    });

    const [event] = await createSupabaseDataAdapter(client).getFormalDisplayEventsForUser('qiuqiu');
    assert.equal(Object.hasOwn(event, 'test_id'), false);
    assert.equal(event.meaning_id, 'meaning-1');
    assert.equal(event.history_expires_at, '2026-09-10T00:00:00.000Z');
});

test('getQuestionCache normalizes known elementary mojibake before enum filtering', async () => {
    const ELEMENTARY = String.fromCharCode(0x5c0f, 0x5b66);
    const MOJIBAKE_ELEMENTARY = String.fromCodePoint(0x0421, 0x0467);
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'test_user', username_key: 'test_user' }],
        words: [{
            id: 'word-1',
            feishu_record_id: 'rec-word-1',
            user_id: 'user-1',
            word: 'corn',
            meaning_en: 'yellow food',
            level: ELEMENTARY,
            mastery_status: 'pending',
        }],
        question_cache: [{
            id: 'cache-1',
            feishu_record_id: 'rec-cache-1',
            user_id: 'user-1',
            word_id: 'word-1',
            level: ELEMENTARY,
            round_type: 'primary',
            quality_status: 'ready',
            question_type: 1,
            question_text: 'I eat _____.',
            options: ['A. corn', 'B. desk', 'C. run', 'D. blue'],
            answer: 'A',
            used_count: 0,
            generated_at: '2026-07-19T12:00:00.000Z',
            question_fingerprint: 'cache-1-fingerprint',
        }],
    });
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '中文释义'])),
    });

    const rows = await adapter.getQuestionCache('test_user', MOJIBAKE_ELEMENTARY, 'primary');

    assert.equal(rows.length, 1);
    assert.equal(rows[0].level, ELEMENTARY);
});

test('getQuestionCache excludes ready rows without a question fingerprint', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
        words: [{ id: 'word-1', feishu_record_id: 'rec-word-1', user_id: 'user-1', word: 'apple', level: MIDDLE }],
        question_cache: [
            {
                id: 'missing-fingerprint', user_id: 'user-1', word_id: 'word-1', level: MIDDLE,
                round_type: 'primary', quality_status: 'ready', cache_state: 'active', question_fingerprint: null,
            },
            {
                id: 'valid-fingerprint', user_id: 'user-1', word_id: 'word-1', level: MIDDLE,
                round_type: 'primary', quality_status: 'ready', cache_state: 'active', question_fingerprint: 'valid-fingerprint',
            },
        ],
    });

    const rows = await createSupabaseDataAdapter(client).getQuestionCache('qiuqiu', MIDDLE, 'primary');

    assert.deepEqual(rows.map(row => row.id), ['valid-fingerprint']);
});
test('rebuildQuestionCacheForUser writes ready elementary cache rows to Supabase', async () => {
    const ELEMENTARY = String.fromCharCode(0x5c0f, 0x5b66);
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: ELEMENTARY }],
        words: [
            ['corn', 'A yellow food that grows on a tall plant.'],
            ['cheek', 'The soft side of your face.'],
            ['roll', 'To move by turning over and over.'],
            ['puppy', 'A young dog.'],
            ['kitten', 'A young cat.'],
            ['chick', 'A baby bird.'],
            ['climb', 'To go up something.'],
            ['sweater', 'Warm clothes for the top of your body.'],
            ['clap', 'To hit your hands together to make a sound.'],
            ['swing', 'A seat that moves back and forth.'],
        ].map(([word, meaning], index) => ({
            id: `word-${index + 1}`,
            feishu_record_id: `rec-word-${index + 1}`,
            user_id: 'user-1',
            word,
            meaning_en: meaning,
            meaning_zh: meaning,
            level: ELEMENTARY,
            mastery_status: 'pending',
            entered_at: `2026-07-19T00:00:${String(index).padStart(2, '0')}.000Z`,
        })),
        assessments: [],
        question_cache: [],
    });
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '中文释义'])),
        generateContext: async word => `A second friendly sentence uses ${word} today.`,
        generateDistractors: contextualDistractorsForTest,
    });

    const result = await adapter.rebuildQuestionCacheForUser('qiuqiu');
    assert.equal(result.configured, true);
    assert.equal(result.level, ELEMENTARY);
    assert.equal(result.count, 20);
    const cornQuestion = client.db.question_cache.find(row =>
        row.word_id === 'word-1' && row.round_type === 'primary'
    );
    assert.match(cornQuestion.question_text, /dinner today/);
    assert.equal(client.db.question_cache.filter(row =>
        row.user_id === 'user-1' &&
        row.level === ELEMENTARY &&
        row.round_type === 'primary' &&
        row.quality_status === 'ready'
    ).length, 20);
});

test('updateUserLearningSettings updates Supabase user level and removes stale cache', async () => {
    const ELEMENTARY = String.fromCharCode(0x5c0f, 0x5b66);
    const HIGH = String.fromCharCode(0x9ad8, 0x4e2d);
    const client = createFakeSupabase({
        users: [{
            id: 'user-1',
            username: 'qiuqiu',
            username_key: 'qiuqiu',
            learning_level: HIGH,
            level_changed_at: null,
        }],
        words: [],
        assessments: [],
        question_cache: [{
            id: 'cache-1',
            user_id: 'user-1',
            word_id: 'word-1',
            level: HIGH,
            quality_status: 'ready',
        }],
    });
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '中文释义'])),
    });

    const result = await adapter.updateUserLearningSettings('qiuqiu', ELEMENTARY);

    assert.equal(result.success, true);
    assert.equal(result.settings.learningLevel, ELEMENTARY);
    assert.equal(client.db.users[0].learning_level, ELEMENTARY);
    assert.ok(client.db.users[0].level_changed_at);
    assert.equal(client.db.question_cache.length, 0);
});

test('updateUserLearningSettings repairs missing migrated user level despite cooldown timestamp', async () => {
    const HIGH = String.fromCharCode(0x9ad8, 0x4e2d);
    const client = createFakeSupabase({
        users: [{
            id: 'user-1',
            username: 'yusi',
            username_key: 'yusi',
            learning_level: null,
            level_changed_at: new Date().toISOString(),
        }],
        words: [],
        assessments: [],
        question_cache: [{
            id: 'cache-1',
            user_id: 'user-1',
            word_id: 'word-1',
            level: HIGH,
            quality_status: 'ready',
        }],
    });
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '中文释义'])),
    });

    const result = await adapter.updateUserLearningSettings('yusi', HIGH);

    assert.equal(result.success, true);
    assert.equal(result.settings.learningLevel, HIGH);
    assert.equal(client.db.users[0].learning_level, HIGH);
    assert.ok(client.db.users[0].level_changed_at);
    assert.equal(client.db.question_cache.length, 0);
});
test('updateUserLearningSettings repairs mistaken elementary level when migrated words are unassigned', async () => {
    const ELEMENTARY = String.fromCharCode(0x5c0f, 0x5b66);
    const HIGH = String.fromCharCode(0x9ad8, 0x4e2d);
    const client = createFakeSupabase({
        users: [{
            id: 'user-1',
            username: 'yusi',
            username_key: 'yusi',
            learning_level: ELEMENTARY,
            level_changed_at: new Date().toISOString(),
        }],
        words: [{
            id: 'word-1',
            feishu_record_id: 'rec-word-1',
            user_id: 'user-1',
            word: 'absurd',
            meaning_en: 'wildly unreasonable',
            level: null,
            mastery_status: 'pending',
            entered_at: '2026-07-19T00:00:00.000Z',
        }],
        assessments: [],
        question_cache: [{
            id: 'cache-1',
            user_id: 'user-1',
            word_id: 'word-1',
            level: ELEMENTARY,
            quality_status: 'ready',
        }],
    });
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '中文释义'])),
    });

    const result = await adapter.updateUserLearningSettings('yusi', HIGH);

    assert.equal(result.success, true);
    assert.equal(result.settings.learningLevel, HIGH);
    assert.equal(client.db.users[0].learning_level, HIGH);
    assert.equal(client.db.question_cache.length, 0);
});
test('updateUserLearningSettings repairs mistaken elementary level when migrated words already target high', async () => {
    const ELEMENTARY = String.fromCharCode(0x5c0f, 0x5b66);
    const HIGH = String.fromCharCode(0x9ad8, 0x4e2d);
    const client = createFakeSupabase({
        users: [{
            id: 'user-1',
            username: 'yusi',
            username_key: 'yusi',
            learning_level: ELEMENTARY,
            level_changed_at: new Date().toISOString(),
        }],
        words: [{
            id: 'word-1',
            feishu_record_id: 'rec-word-1',
            user_id: 'user-1',
            word: 'advanced',
            meaning_en: 'highly developed',
            level: HIGH,
            mastery_status: 'pending',
            entered_at: '2026-07-19T00:00:00.000Z',
        }],
        assessments: [],
        question_cache: [{
            id: 'cache-1',
            user_id: 'user-1',
            word_id: 'word-1',
            level: ELEMENTARY,
            quality_status: 'ready',
        }],
    });
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '中文释义'])),
    });

    const result = await adapter.updateUserLearningSettings('yusi', HIGH);

    assert.equal(result.success, true);
    assert.equal(result.settings.learningLevel, HIGH);
    assert.equal(client.db.users[0].learning_level, HIGH);
    assert.equal(client.db.question_cache.length, 0);
});
test('updateUserLearningSettings repairs mistaken elementary level when high words dominate', async () => {
    const ELEMENTARY = String.fromCharCode(0x5c0f, 0x5b66);
    const HIGH = String.fromCharCode(0x9ad8, 0x4e2d);
    const highWords = Array.from({ length: 10 }, (_, index) => ({
        id: `high-word-${index + 1}`,
        feishu_record_id: `rec-high-word-${index + 1}`,
        user_id: 'user-1',
        word: `advanced${index + 1}`,
        meaning_en: 'high-school vocabulary',
        level: HIGH,
        mastery_status: 'pending',
        entered_at: `2026-07-19T00:00:${String(index).padStart(2, '0')}.000Z`,
    }));
    const elementaryWords = Array.from({ length: 2 }, (_, index) => ({
        id: `elementary-word-${index + 1}`,
        feishu_record_id: `rec-elementary-word-${index + 1}`,
        user_id: 'user-1',
        word: `simple${index + 1}`,
        meaning_en: 'elementary vocabulary',
        level: ELEMENTARY,
        mastery_status: 'pending',
        entered_at: `2026-07-19T00:01:${String(index).padStart(2, '0')}.000Z`,
    }));
    const client = createFakeSupabase({
        users: [{
            id: 'user-1',
            username: 'yusi',
            username_key: 'yusi',
            learning_level: ELEMENTARY,
            level_changed_at: new Date().toISOString(),
        }],
        words: [...highWords, ...elementaryWords],
        assessments: [],
        question_cache: [{
            id: 'cache-1',
            user_id: 'user-1',
            word_id: 'high-word-1',
            level: ELEMENTARY,
            quality_status: 'ready',
        }],
    });
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '中文释义'])),
    });

    const result = await adapter.updateUserLearningSettings('yusi', HIGH);

    assert.equal(result.success, true);
    assert.equal(result.settings.learningLevel, HIGH);
    assert.equal(client.db.users[0].learning_level, HIGH);
    assert.equal(client.db.question_cache.length, 0);
});
test('quiz session persistence saves and restores unexpired Supabase sessions', async () => {
    const client = seededClient();
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '中文释义'])),
    });
    const questions = [{ word: 'Apple', answer: 'A', options: ['A. Apple', 'B. Pear'] }];

    await adapter.saveQuizSession('qiuqiu', 'test-quiz-1', questions, {
        now: () => '2026-07-20T00:00:00.000Z',
    });
    const session = await adapter.getQuizSession('qiuqiu', 'test-quiz-1', {
        now: () => '2026-07-20T01:00:00.000Z',
    });

    assert.deepEqual(session.questions, questions);
    assert.equal(session.user_id, 'user-1');
    assert.equal(client.db.quiz_sessions[0].test_id, 'test-quiz-1');
    assert.equal(client.db.quiz_sessions[0].expires_at, '2026-07-21T00:00:00.000Z');
});

test('quiz session persistence stores progress and finds the latest unfinished session', async () => {
    const client = seededClient();
    const adapter = createSupabaseDataAdapter(client);
    const questions = [{ word: 'Apple', answer: 'A', options: ['A. Apple', 'B. Pear'] }];
    const progress = { currentQuestion: 1, answers: [0] };
    await adapter.saveQuizSession('qiuqiu', 'test-quiz-progress', questions, { progress, now: () => '2026-07-20T00:00:00.000Z' });
    await adapter.updateQuizSessionProgress('qiuqiu', 'test-quiz-progress', progress);
    const session = await adapter.getActiveQuizSession('qiuqiu', 'test', { now: () => '2026-07-20T01:00:00.000Z' });
    assert.deepEqual(session.progress, progress);
    assert.equal(session.test_id, 'test-quiz-progress');
});
test('quiz session persistence ignores expired sessions and deletes submitted sessions', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
        quiz_sessions: [{
            test_id: 'expired-quiz',
            user_id: 'user-1',
            questions: [{ word: 'Apple' }],
            created_at: '2026-07-18T00:00:00.000Z',
            expires_at: '2026-07-19T00:00:00.000Z',
        }, {
            test_id: 'fresh-quiz',
            user_id: 'user-1',
            questions: [{ word: 'Pear' }],
            created_at: '2026-07-20T00:00:00.000Z',
            expires_at: '2026-07-21T00:00:00.000Z',
        }],
    });
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '中文释义'])),
    });

    assert.equal(await adapter.getQuizSession('qiuqiu', 'expired-quiz', {
        now: () => '2026-07-20T00:00:00.000Z',
    }), null);
    assert.deepEqual(await adapter.deleteQuizSession('qiuqiu', 'fresh-quiz'), { deleted: 1 });
    assert.deepEqual(client.db.quiz_sessions.map(row => row.test_id), ['expired-quiz']);
    assert.deepEqual(await adapter.cleanupExpiredQuizSessions({
        now: () => '2026-07-20T00:00:00.000Z',
    }), { deleted: 1 });
    assert.deepEqual(client.db.quiz_sessions, []);
});

test('getAssessmentsForTest returns only rows for one user and test id', async () => {
    const client = createFakeSupabase({
        users: [
            { id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' },
            { id: 'user-2', username: 'other', username_key: 'other' },
        ],
        assessments: [
            { id: 'a-1', user_id: 'user-1', test_id: 'real-target', word_snapshot: 'Apple', source_word_record_id: 'rec-word-1', question_type: '1', is_correct: 'correct', assessed_at: '2026-07-21T00:00:00.000Z', options: [] },
            { id: 'a-2', user_id: 'user-1', test_id: 'real-other', word_snapshot: 'Pear', source_word_record_id: 'rec-word-2', question_type: '1', is_correct: 'wrong', assessed_at: '2026-07-21T00:01:00.000Z', options: [] },
            { id: 'a-3', user_id: 'user-2', test_id: 'real-target', word_snapshot: 'Desk', source_word_record_id: 'rec-word-3', question_type: '1', is_correct: 'wrong', assessed_at: '2026-07-21T00:02:00.000Z', options: [] },
        ],
    });
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '中文释义'])),
    });

    const rows = await adapter.getAssessmentsForTest('qiuqiu', 'real-target');

    assert.deepEqual(rows.map(row => row.id), ['a-1']);
});

test('createReviewRound builds a Supabase review round from wrong submitted assessments', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
        words: [{
            id: 'word-1',
            feishu_record_id: 'rec-word-1',
            user_id: 'user-1',
            word: 'Apple',
            meaning_en: 'a fruit',
            meaning_zh: 'ƻ��',
            level: MIDDLE,
            mastery_status: 'pending',
            entered_at: '2026-07-18T00:00:00.000Z',
        }],
        assessments: [{
            id: 'a-1',
            user_id: 'user-1',
            word_id: 'word-1',
            source_word_record_id: 'rec-word-1',
            test_id: 'real-source',
            word_snapshot: 'Apple',
            question_type: '1',
            question_text: 'I ate an _____.',
            options: ['A. Apple', 'B. Pear', 'C. Chair', 'D. Desk'],
            correct_answer: 'A',
            submitted_answer: 'B',
            answer_confidence: 'sure',
            is_correct: 'wrong',
            assessed_at: '2026-07-21T00:00:00.000Z',
            learning_day: '2026-07-21',
            level: MIDDLE,
        }],
    });
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '中文释义'])),
    });

    const round = await adapter.createReviewRound({ userId: 'qiuqiu', sourceTestId: 'real-source' });

    assert.equal(round.sourceTestId, 'real-source');
    assert.equal(round.questions.length, 1);
    assert.equal(round.questions[0].type, 4);
    assert.equal(round.questions[0].correctMeaning, 'ƻ��');
    const reviewRows = client.db.assessments.filter(row => row.test_id === round.reviewId);
    assert.equal(reviewRows.length, 1);
    assert.equal(reviewRows[0].assessment_kind, 'review');
    assert.equal(reviewRows[0].source, 'question_cache');
    assert.equal(reviewRows[0].source_test_id, 'real-source');
    assert.equal(reviewRows[0].review_status, 'active');
});


test('createReviewRound tolerates assessments without parent_review_id', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'draggy', username_key: 'draggy' }],
        words: [{
            id: 'word-1',
            feishu_record_id: 'rec-word-1',
            user_id: 'user-1',
            word: 'Attitude',
            meaning_en: 'a way of thinking',
            meaning_zh: 'attitude',
            level: MIDDLE,
            mastery_status: 'pending',
            entered_at: '2026-07-18T00:00:00.000Z',
        }],
        assessments: [{
            id: 'a-1',
            user_id: 'user-1',
            word_id: 'word-1',
            source_word_record_id: 'rec-word-1',
            test_id: 'real-source',
            word_snapshot: 'Attitude',
            question_type: '1',
            correct_answer: 'A',
            submitted_answer: 'B',
            is_correct: 'wrong',
            assessed_at: '2026-07-21T00:00:00.000Z',
            learning_day: '2026-07-21',
            level: MIDDLE,
        }],
    }, {
        missingColumns: { assessments: ['parent_review_id'] },
    });
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '中文释义'])),
    });

    const round = await adapter.createReviewRound({ userId: 'draggy', sourceTestId: 'real-source' });

    assert.equal(round.questions.length, 1);
    const retry = await adapter.createReviewRound({ userId: 'draggy', sourceTestId: 'real-source' });
    const reviewRows = client.db.assessments.filter(row => row.assessment_kind === 'review');
    assert.equal(retry.reviewId, round.reviewId);
    assert.equal(reviewRows.length, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(reviewRows[0], 'parent_review_id'), false);
});

test('concurrent review generation returns one active round', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
        words: [{ id: 'word-1', feishu_record_id: 'rec-word-1', user_id: 'user-1', word: 'Apple', meaning_en: 'a fruit', meaning_zh: 'apple', level: MIDDLE, mastery_status: 'pending', entered_at: '2026-07-18T00:00:00.000Z' }],
        assessments: [{ id: 'a-1', user_id: 'user-1', word_id: 'word-1', source_word_record_id: 'rec-word-1', test_id: 'real-source', word_snapshot: 'Apple', question_type: '1', correct_answer: 'A', submitted_answer: 'B', is_correct: 'wrong', assessed_at: '2026-07-21T00:00:00.000Z', learning_day: '2026-07-21', level: MIDDLE }],
    });
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '中文释义'])),
    });
    const [first, second] = await Promise.all([
        adapter.createReviewRound({ userId: 'qiuqiu', sourceTestId: 'real-source' }),
        adapter.createReviewRound({ userId: 'qiuqiu', sourceTestId: 'real-source' }),
    ]);

    assert.equal(first.reviewId, second.reviewId);
    assert.equal(client.db.assessments.filter(row => row.assessment_kind === 'review').length, 1);
});

test('review active, defer, and summary flows use Supabase assessment metadata', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
        assessments: [{ id: 'review-row-1', user_id: 'user-1', source_word_record_id: 'rec-word-1', test_id: 'real-review-r1', source_test_id: 'real-source', word_snapshot: 'Apple', question_type: '4', correct_answer: 'apple', submitted_answer: null, is_correct: null, assessed_at: '2026-07-21T00:00:00.000Z', review_status: 'active', assessment_kind: 'review' }],
    });
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '中文释义'])),
    });

    const active = await adapter.getActiveReviewRound({ userId: 'qiuqiu', sourceTestId: 'real-source' });
    assert.equal(active.reviewId, 'real-review-r1');
    const deferred = await adapter.deferReviewRound({ userId: 'qiuqiu', reviewId: 'real-review-r1' });
    assert.deepEqual(deferred.remainingRecordIds, ['rec-word-1']);
    const summary = await adapter.getReviewSummary({ userId: 'qiuqiu', sourceTestId: 'real-source' });
    assert.deepEqual(summary.deferredRecordIds, ['rec-word-1']);
    assert.equal(summary.reviewed, 1);
});

test('submitReviewRound scores Supabase type-four review rows', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
        words: [],
        assessments: [{
            id: 'review-row-1',
            user_id: 'user-1',
            word_id: 'word-1',
            source_word_record_id: 'rec-word-1',
            test_id: 'real-review-r1',
            word_snapshot: 'Apple',
            question_type: '4',
            question_text: '',
            options: [],
            correct_answer: 'apple',
            submitted_answer: null,
            answer_confidence: null,
            is_correct: null,
            assessed_at: '2026-07-21T00:00:00.000Z',
            learning_day: '2026-07-21',
            assessment_kind: 'review',
            review_round: '1',
            review_status: 'active',
            source_test_id: 'real-source',
            parent_review_id: '',
        }],
    });
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '中文释义'])),
    });

    const result = await adapter.submitReviewRound({
        userId: 'qiuqiu',
        reviewId: 'real-review-r1',
        answers: [{ text: 'apple', confidence: 'sure' }],
    });

    assert.equal(result.reviewId, 'real-review-r1');
    assert.equal(result.correct, 1);
    assert.equal(result.total, 1);
    assert.equal(result.complete, true);
    assert.equal(client.db.assessments[0].submitted_answer, 'apple');
    assert.equal(client.db.assessments[0].is_correct, 'correct');
    assert.equal(client.db.assessments[0].review_status, 'complete');

    const retry = await adapter.submitReviewRound({
        userId: 'qiuqiu',
        reviewId: 'real-review-r1',
        answers: [{ text: 'apple', confidence: 'sure' }],
    });
    assert.equal(retry.total, 1);
    assert.equal(client.db.assessments.length, 1);
});

test('rebuildQuestionCacheForUser inherits level and uses word-specific distractors for unassigned words', async () => {
    const MIDDLE = String.fromCharCode(0x4e2d, 0x5b66);
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: ['apple', 'bridge', 'candle', 'dinner', 'engine', 'forest', 'garden', 'hammer', 'island', 'jacket'].map((word, index) => ({
            id: `word-${index + 1}`,
            feishu_record_id: `rec-word-${index + 1}`,
            user_id: 'user-1',
            word,
            meaning_en: `Meaning ${index + 1}`,
            meaning_zh: `Meaning ${index + 1}`,
            level: null,
            context_en: `This sentence contains ${word}.`,
            distractors: ['alpha', 'bravo', 'charlie'],
            old_distractors: [],
            mastery_status: 'pending',
            entered_at: `2026-07-19T00:00:${String(index).padStart(2, '0')}.000Z`,
        })),
        assessments: [],
        question_cache: [],
    });
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '中文释义'])),
        generateContext: async word => `A second sentence contains ${word}.`,
        generateDistractors: contextualDistractorsForTest,
    });

    const result = await adapter.rebuildQuestionCacheForUser('qiuqiu');

    assert.equal(result.level, MIDDLE);
    assert.equal(result.count, 20);
    assert.equal(client.db.question_cache.filter(row => row.level === MIDDLE && row.round_type === 'primary').length, 20);
});

test('rebuildQuestionCacheForUser skips an unknown elementary word instead of fabricating a meaning blank', async () => {
    const ELEMENTARY = String.fromCharCode(0x5c0f, 0x5b66);
    const words = ['corn', 'cheek', 'roll', 'puppy', 'kitten', 'chick', 'climb', 'sweater', 'clap', 'abstract'];
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'Draggy', username_key: 'draggy', learning_level: ELEMENTARY }],
        words: words.map((word, index) => ({
            id: `word-${index + 1}`,
            feishu_record_id: `rec-word-${index + 1}`,
            user_id: 'user-1',
            word,
            meaning_en: `Meaning of ${word}`,
            meaning_zh: `Meaning of ${word}`,
            level: null,
            context_en: word === 'abstract' ? null : '',
            distractors: [],
            old_distractors: [],
            mastery_status: 'pending',
            entered_at: `2026-07-19T00:00:${String(index).padStart(2, '0')}.000Z`,
        })),
        assessments: [],
        question_cache: [],
    });
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '中文释义'])),
        generateContext: async word => `A second friendly sentence uses ${word} today.`,
        generateDistractors: contextualDistractorsForTest,
    });

    const result = await adapter.rebuildQuestionCacheForUser('Draggy');

    assert.equal(result.level, ELEMENTARY);
    assert.equal(result.count, 18);
    assert.equal(client.db.question_cache.filter(row => row.round_type === 'primary' && row.quality_status === 'ready').length, 18);
    assert.equal(client.db.question_cache.some(row => row.word_id === 'word-10'), false)
    assert.equal(client.db.question_cache.some(row => row.question_text.includes('In class, the word')), false);
});

test('rebuildQuestionCacheForUser skips middle-school words without natural context and approved distractors', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: ['genaine', 'repair', 'draggy', 'straight'].map((word, index) => ({
            id: `word-${index + 1}`,
            feishu_record_id: `rec-word-${index + 1}`,
            user_id: 'user-1',
            word,
            meaning_en: `Meaning ${index + 1}`,
            meaning_zh: `Meaning ${index + 1}`,
            level: MIDDLE,
            context_en: null,
            distractors: [],
            old_distractors: [],
            mastery_status: 'pending',
            entered_at: `2026-07-19T00:00:${String(index).padStart(2, '0')}.000Z`,
        })),
        assessments: [],
        question_cache: [],
    });
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '中文释义'])),
    });

    const result = await adapter.rebuildQuestionCacheForUser('qiuqiu');

    assert.equal(result.level, MIDDLE);
    assert.equal(result.count, 0);
    assert.equal(client.db.question_cache.length, 0);
});

test.skip('rebuildQuestionCacheForUser creates middle-school type 3 fallback cache when context is sparse', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [
            ['afford', '负担得起'],
            ['trick', '窍门'],
            ['whistle', '哨声'],
            ['stream', '小溪'],
        ].map(([word, meaning], index) => ({
            id: `word-${index + 1}`,
            feishu_record_id: `rec-word-${index + 1}`,
            user_id: 'user-1',
            word,
            meaning_en: `Meaning ${index + 1}`,
            meaning_zh: meaning,
            level: MIDDLE,
            context_en: null,
            distractors: [],
            old_distractors: [],
            mastery_status: 'pending',
            entered_at: `2026-07-19T00:00:0${index}.000Z`,
        })),
        assessments: [],
        question_cache: [],
    });
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '中文释义'])),
        generateDistractors: async () => ['support', 'shoulder', 'maintain'],
    });

    const result = await adapter.rebuildQuestionCacheForUser('qiuqiu');

    assert.equal(result.level, MIDDLE);
    assert.equal(result.count, 8);
    assert.equal(client.db.question_cache.filter(row => row.round_type === 'primary').length, 4);
    assert.equal(client.db.question_cache.every(row => row.question_type === '3'), true);
    assert.equal(client.db.question_cache.every(row => row.quality_status === 'ready'), true);
    assert.equal(client.db.question_cache.every(row => !String(row.question_text || '').includes('Meaning')), true);
    assert.equal(client.db.question_cache.every(row => row.cache_state === 'active'), true);
    assert.equal(client.db.question_cache.every(row => row.variant_slot === 1), true);
    assert.deepEqual(
        client.db.question_cache
            .filter(row => row.round_type === 'primary')
            .map(row => row.correct_meaning),
        ['负担得起', '窍门', '哨声', '小溪']
    );
});
test.skip('rebuildQuestionCacheForUser uses independently generated distractors instead of vocabulary words', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [
            ['afford', '负担得起；买得起'],
            ['liquid', '液体'],
            ['freeze', '冻结'],
            ['container', '容器'],
        ].map(([word, meaning], index) => ({
            id: `word-${index + 1}`,
            feishu_record_id: `rec-word-${index + 1}`,
            user_id: 'user-1',
            word,
            meaning_en: `Meaning ${index + 1}`,
            meaning_zh: meaning,
            level: MIDDLE,
            context_en: null,
            distractors: [],
            old_distractors: [],
            mastery_status: 'pending',
            entered_at: `2026-07-23T00:00:0${index}.000Z`,
        })),
        assessments: [],
        question_cache: [],
    });
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '中文释义'])),
        generateDistractors: async ({ word }) => word === 'afford'
            ? ['support', 'shoulder', 'maintain']
            : null,
    });

    await adapter.rebuildQuestionCacheForUser('qiuqiu');

    const affordRows = client.db.question_cache.filter(row => row.word_id === 'word-1');
    assert.equal(affordRows.length, 2);
    const options = affordRows[0].options.map(option => option.replace(/^[A-D]\.\s+/, ''));
    assert.deepEqual(options.filter(option => option !== 'afford').sort(), ['maintain', 'shoulder', 'support']);
    assert.equal(options.some(option => ['liquid', 'freeze', 'container'].includes(option)), false);
});

test.skip('rebuildQuestionCacheForUser writes Chinese meanings for generated options', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [{
            id: 'word-1',
            feishu_record_id: 'rec-word-1',
            user_id: 'user-1',
            word: 'attitude',
            meaning_en: 'a way of thinking or feeling',
            meaning_zh: '态度',
            level: MIDDLE,
            context_en: null,
            distractors: [],
            old_distractors: [],
            mastery_status: 'pending',
            entered_at: '2026-07-23T00:00:00.000Z',
        }],
        assessments: [],
        question_cache: [],
    });
    const adapter = createSupabaseDataAdapter(client, {
        generateDistractors: async () => ['explicit', 'disappointed', 'blond'],
        translateWords: async words => ({
            explicit: '明确的',
            disappointed: '失望的',
            blond: '金发的',
        }),
    });

    await adapter.rebuildQuestionCacheForUser('qiuqiu');

    const row = client.db.question_cache.find(item => item.round_type === 'primary');
    assert.deepEqual(row.option_meanings.sort(), ['失望的', '态度', '明确的', '金发的'].sort());
});
test('rebuildQuestionCacheForUser skips sparse type 3 questions when distractor generation fails', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [
            ['afford', '负担得起；买得起'],
            ['liquid', '液体'],
            ['freeze', '冻结'],
            ['container', '容器'],
        ].map(([word, meaning], index) => ({
            id: `word-${index + 1}`,
            feishu_record_id: `rec-word-${index + 1}`,
            user_id: 'user-1',
            word,
            meaning_en: `Meaning ${index + 1}`,
            meaning_zh: meaning,
            level: MIDDLE,
            context_en: null,
            distractors: [],
            old_distractors: [],
            mastery_status: 'pending',
            entered_at: `2026-07-23T00:00:0${index}.000Z`,
        })),
        assessments: [],
        question_cache: [],
    });
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '中文释义'])),
        generateDistractors: async () => null,
    });

    await adapter.rebuildQuestionCacheForUser('qiuqiu');

    assert.equal(client.db.question_cache.length, 0);
});
test('rebuildQuestionCacheForUser does not use candidate words when distractor generation fails', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [
            ['genaine', ''],
            ['bomb', ''],
            ['crowded', ''],
            ['afford', '负担得起'],
            ['trick', '窍门'],
            ['whistle', '哨声'],
            ['stream', '小溪'],
        ].map(([word, meaning], index) => ({
            id: `word-${index + 1}`,
            feishu_record_id: `rec-word-${index + 1}`,
            user_id: 'user-1',
            word,
            meaning_en: `Meaning ${index + 1}`,
            meaning_zh: meaning,
            level: MIDDLE,
            context_en: null,
            distractors: [],
            old_distractors: [],
            mastery_status: 'pending',
            entered_at: `2026-07-19T00:00:0${index}.000Z`,
        })),
        assessments: [],
        question_cache: [],
    });
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '中文释义'])),
    });

    const result = await adapter.rebuildQuestionCacheForUser('qiuqiu');

    assert.equal(result.count, 0);
    const optionText = client.db.question_cache.flatMap(row => row.options).join(' ').toLowerCase();
    assert.equal(optionText.includes('genaine'), false);
    assert.equal(optionText.includes('bomb'), false);
    assert.equal(optionText.includes('crowded'), false);
});
test.skip('rebuildQuestionCacheForUser varies sparse middle-school fallback distractors by target word', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [
            ['bomb', '炸弹'],
            ['crowded', '拥挤的'],
            ['resilient', '有弹性的'],
            ['afford', '负担得起'],
            ['trick', '窍门'],
            ['whistle', '哨声'],
            ['stream', '小溪'],
        ].map(([word, meaning], index) => ({
            id: `word-${index + 1}`,
            feishu_record_id: `rec-word-${index + 1}`,
            user_id: 'user-1',
            word,
            meaning_en: `Meaning ${index + 1}`,
            meaning_zh: meaning,
            level: MIDDLE,
            context_en: null,
            distractors: [],
            old_distractors: [],
            mastery_status: 'pending',
            entered_at: `2026-07-19T00:00:0${index}.000Z`,
        })),
        assessments: [],
        question_cache: [],
    });
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '中文释义'])),
        generateDistractors: async ({ word }) => word === 'afford'
            ? ['support', 'shoulder', 'maintain']
            : ['select', 'reject', 'replace'],
    });

    await adapter.rebuildQuestionCacheForUser('qiuqiu');

    const wordById = new Map(client.db.words.map(word => [word.id, word.word]));
    const distractorSets = client.db.question_cache
        .filter(row => row.round_type === 'primary')
        .map(row => ({
            target: wordById.get(row.word_id),
            options: row.options.map(option => option.replace(/^[A-D]\.\s+/, '')),
        }))
        .filter(row => ['afford', 'trick', 'whistle', 'stream'].includes(row.target))
        .map(row => row.options.filter(option => option !== row.target).sort().join('|'));
    assert.ok(distractorSets.length >= 4);
    assert.ok(new Set(distractorSets).size > 1, distractorSets.join('; '));
});
test('rebuildQuestionCacheForUser does not use all candidate words as middle-school fallback distractors', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [
            {
                id: 'word-1',
                feishu_record_id: 'rec-word-1',
                user_id: 'user-1',
                word: 'repair',
                meaning_en: 'to fix something damaged',
                meaning_zh: 'to fix something damaged',
                level: MIDDLE,
                context_en: "After the storm, the carpenter's repair of the damaged roof kept the house dry.",
                distractors: [],
                old_distractors: [],
                mastery_status: 'pending',
                entered_at: '2026-07-19T00:00:00.000Z',
            },
            ...['crowded', 'bomb', 'straight'].map((word, index) => ({
                id: `word-${index + 2}`,
                feishu_record_id: `rec-word-${index + 2}`,
                user_id: 'user-1',
                word,
                meaning_en: `Meaning ${index + 2}`,
                meaning_zh: `Meaning ${index + 2}`,
                level: MIDDLE,
                context_en: `${word} appears in a separate sentence.`,
                distractors: [],
                old_distractors: [],
                mastery_status: 'pending',
                entered_at: `2026-07-19T00:00:0${index + 1}.000Z`,
            })),
        ],
        assessments: [],
        question_cache: [],
    });
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '中文释义'])),
    });

    const result = await adapter.rebuildQuestionCacheForUser('qiuqiu');

    assert.equal(result.count, 0);
    assert.equal(client.db.question_cache.length, 0);
});

test('rebuildQuestionCacheForUser follows assessment evidence when stored mastery status is stale', async () => {
    const client = createFakeSupabase({ users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }], words: [{ id: 'word-1', feishu_record_id: 'rec-word-1', user_id: 'user-1', word: 'apple', meaning_en: 'a fruit', meaning_zh: '\u82f9\u679c', level: MIDDLE, context_en: 'The child ate an apple after school.', distractors: ['pear', 'desk', 'chair'], old_distractors: [], mastery_status: 'mastered', entered_at: '2026-07-30T00:00:00.000Z' }], assessments: [], question_cache: [] });
    const adapter = createSupabaseDataAdapter(client, { translateWords: async words => Object.fromEntries(words.map((word, index) => [word, ['梨子', '桌子', '椅子', '其他'][index]])), generateContext: async (word, meaning, level, previous) => previous ? 'The child packed an apple for the long trip.' : previous, generateDistractors: contextualDistractorsForTest });
    const result = await adapter.rebuildQuestionCacheForUser('qiuqiu');
    assert.equal(result.count, 2);
});
test('rebuildQuestionCacheForUser builds both variants for a hyphenated English word', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [{
            id: 'word-1', feishu_record_id: 'rec-word-1', user_id: 'user-1', word: 'brand-new',
            meaning_en: 'completely new', meaning_zh: '\u5d2d\u65b0\u7684', level: MIDDLE,
            context_en: 'She wore a brand-new coat to school.',
            distractors: ['ancient', 'broken', 'faded'], old_distractors: [],
            mastery_status: 'pending', entered_at: '2026-07-30T00:00:00.000Z',
        }],
        assessments: [],
        question_cache: [],
    });
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '\u4e2d\u6587\u91ca\u4e49'])),
        generateContext: async (word, meaning, level, previous) =>
            previous ? 'He opened a brand-new notebook in class.' : previous,
        generateDistractors: contextualDistractorsForTest,
    });

    const result = await adapter.rebuildQuestionCacheForUser('qiuqiu');

    assert.equal(result.count, 2);
    assert.deepEqual(client.db.question_cache.map(row => row.word_id), ['word-1', 'word-1']);
});
test('rebuildQuestionCacheForUser removes existing cache rows for mastered words', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [{ id: 'word-1', feishu_record_id: 'rec-word-1', user_id: 'user-1', word: 'apple', level: MIDDLE, mastery_status: 'mastered' }],
        assessments: [
            { id: 'assessment-1', user_id: 'user-1', word_id: 'word-1', source_word_record_id: 'rec-word-1', test_id: 'real-quiz-1', assessed_at: '2026-07-20T00:00:00.000Z', question_type: '1', is_correct: 'correct', submitted_answer: 'A|sure' },
            { id: 'assessment-2', user_id: 'user-1', word_id: 'word-1', source_word_record_id: 'rec-word-1', test_id: 'real-quiz-2', assessed_at: '2026-07-21T00:00:00.000Z', question_type: '1', is_correct: 'correct', submitted_answer: 'A|sure' },
        ],
        question_cache: [{ id: 'cache-1', user_id: 'user-1', word_id: 'word-1', level: MIDDLE, question_type: '1', quality_status: 'ready', cache_state: 'active' }],
    });
    const adapter = createSupabaseDataAdapter(client);

    const result = await adapter.rebuildQuestionCacheForUser('qiuqiu');

    assert.equal(result.count, 0);
    assert.equal(client.db.question_cache.length, 0);
});
test('rebuildQuestionCacheForUser creates two distinct ready type-one variants for every meaning', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [{
            id: 'word-1',
            feishu_record_id: 'rec-word-1',
            user_id: 'user-1',
            word: 'apple',
            meaning_en: 'a fruit',
            meaning_zh: '苹果',
            level: MIDDLE,
            context_en: 'The child ate an apple after school.',
            distractors: ['pear', 'desk', 'chair'],
            old_distractors: [],
            mastery_status: 'pending',
            entered_at: '2026-07-30T00:00:00.000Z',
        }],
        assessments: [],
        question_cache: [],
    });
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, word === 'apple' ? '苹果' : '干扰项'])),
        generateContext: async (word, meaning, level, previous) =>
            previous ? 'The child packed an apple for the long trip.' : previous,
        generateDistractors: contextualDistractorsForTest,
    });

    const result = await adapter.rebuildQuestionCacheForUser('qiuqiu');
    const rows = client.db.question_cache.filter(row => row.round_type === 'primary');

    assert.equal(result.count, 2);
    assert.equal(rows.length, 2);
    assert.equal(new Set(rows.map(row => row.question_text)).size, 2);
    assert.deepEqual(rows.map(row => row.cache_state), ['active', 'reserved_next_day']);
    assert.ok(rows.every(row => row.question_type === '1' && row.quality_status === 'ready'));
});
test('correct cache answer promotes the reserved next-day variant and retires the current one', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [{ id: 'word-1', user_id: 'user-1', word: 'apple', level: MIDDLE }],
        question_cache: [
            { id: 'cache-a', feishu_record_id: 'cache-a-ref', user_id: 'user-1', word_id: 'word-1', source_word_record_id: 'rec-word-1', level: MIDDLE, round_type: 'primary', cache_state: 'active', quality_status: 'ready', question_type: '1', question_text: 'The child ate an apple.', options: [], answer: 'A', option_meanings: [] },
            { id: 'cache-b', feishu_record_id: 'cache-b-ref', user_id: 'user-1', word_id: 'word-1', source_word_record_id: 'rec-word-1', level: MIDDLE, round_type: 'primary', cache_state: 'reserved_next_day', available_from: '2026-07-31T00:00:00.000Z', quality_status: 'ready', question_type: '1', question_text: 'The child packed an apple.', options: [], answer: 'A', option_meanings: [] },
        ],
    });
    const adapter = createSupabaseDataAdapter(client);

    await adapter.applyQuizCacheLifecycle({
        userId: 'qiuqiu',
        questions: [{ cacheRecordId: 'cache-a-ref' }],
        results: [{ correct: true }],
    });

    assert.equal(client.db.question_cache.find(row => row.id === 'cache-a').cache_state, 'retired');
    assert.equal(client.db.question_cache.find(row => row.id === 'cache-b').cache_state, 'active');
    assert.equal(client.db.question_cache.find(row => row.id === 'cache-b').available_from, null);
});
test('correct cache answer does not promote a reserved variant before its availability time', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [{ id: 'word-1', user_id: 'user-1', word: 'apple', level: MIDDLE }],
        question_cache: [
            { id: 'cache-a', feishu_record_id: 'cache-a-ref', user_id: 'user-1', word_id: 'word-1', source_word_record_id: 'rec-word-1', level: MIDDLE, round_type: 'primary', cache_state: 'active', quality_status: 'ready', question_type: '1', question_text: 'The child ate an apple.', options: [], answer: 'A', option_meanings: [] },
            { id: 'cache-b', feishu_record_id: 'cache-b-ref', user_id: 'user-1', word_id: 'word-1', source_word_record_id: 'rec-word-1', level: MIDDLE, round_type: 'primary', cache_state: 'reserved_next_day', available_from: '2999-07-31T00:00:00.000Z', quality_status: 'ready', question_type: '1', question_text: 'The child packed an apple.', options: [], answer: 'A', option_meanings: [] },
        ],
    });
    const adapter = createSupabaseDataAdapter(client);

    await adapter.applyQuizCacheLifecycle({
        userId: 'qiuqiu',
        questions: [{ cacheRecordId: 'cache-a-ref' }],
        results: [{ correct: true }],
    });

    assert.equal(client.db.question_cache.find(row => row.id === 'cache-a').cache_state, 'active');
    assert.equal(client.db.question_cache.find(row => row.id === 'cache-b').cache_state, 'reserved_next_day');
    assert.equal(client.db.question_cache.find(row => row.id === 'cache-b').available_from, '2999-07-31T00:00:00.000Z');
});



test('rebuildQuestionCacheForUser preserves complete pairs beyond ten while repairing only the invalid pair', async () => {
    const existingWords = ['apple', 'brave', 'candle', 'dream', 'eager', 'forest', 'gentle', 'honest', 'island', 'jolly', 'kind']
        .map((word, index) => ({
            id: `word-${index + 1}`,
            feishu_record_id: `rec-word-${index + 1}`,
            user_id: 'user-1',
            word,
            meaning_en: `meaning ${index + 1}`,
            meaning_zh: '\u4e2d\u6587\u91ca\u4e49',
            level: MIDDLE,
            context_en: `The first ${word} sentence is ready.`,
            distractors: ['alpha', 'bravo', 'charlie'],
            old_distractors: [],
            mastery_status: 'pending',
            entered_at: `2026-07-19T00:00:${String(index).padStart(2, '0')}.000Z`,
        }));
    const repairWord = {
        id: 'word-12',
        feishu_record_id: 'rec-word-12',
        user_id: 'user-1',
        word: 'lucky',
        meaning_en: 'having good fortune',
        meaning_zh: '\u5e78\u8fd0\u7684',
        level: MIDDLE,
        context_en: 'The lucky child found a coin after school.',
        distractors: ['alpha', 'bravo', 'charlie'],
        old_distractors: [],
        mastery_status: 'pending',
        entered_at: '2026-07-19T00:00:11.000Z',
    };
    const cachePairFor = (word, { invalidTranslationSlot = null } = {}) => [1, 2].map(slot => {
        const distractors = slot === 1
            ? ['alpha', 'bravo', 'charlie']
            : ['delta', 'echo', 'foxtrot'];
        return {
            id: `cache-${word.id}-${slot}`,
            user_id: 'user-1',
            word_id: word.id,
            source_word_record_id: word.feishu_record_id,
            level: MIDDLE,
            round_type: 'primary',
            quality_status: 'ready',
            cache_state: slot === 1 ? 'active' : 'reserved_next_day',
            question_type: '1',
            question_fingerprint: `${word.id}-fingerprint-${slot}`,
            question_text: `The student saw _____ ${slot} after school.`,
            context_zh: slot === invalidTranslationSlot ? word.meaning_zh : DEFAULT_TEST_CONTEXT_TRANSLATION,
            options: [`A. ${word.word}`, ...distractors.map((value, index) => `${String.fromCharCode(66 + index)}. ${value}`)],
            answer: 'A',
            option_meanings: [word.meaning_zh, ...distractors.map(value => `\u91ca\u4e49-${value}`)],
            correct_meaning: word.meaning_zh,
        };
    });
    const retainedCacheIds = new Set(existingWords.flatMap(word =>
        cachePairFor(word).map(row => row.id)
    ));
    const repairCacheIds = new Set(['cache-word-12-1', 'cache-word-12-2']);
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [...existingWords, repairWord],
        assessments: [],
        question_cache: [
            ...existingWords.flatMap(word => cachePairFor(word)),
            ...cachePairFor(repairWord, { invalidTranslationSlot: 1 }),
        ],
    });
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, '\u4e2d\u6587\u91ca\u4e49'])),
        generateContext: async word => `The second ${word} sentence is ready.`,
        generateDistractors: contextualDistractorsForTest,
    });

    const result = await adapter.rebuildQuestionCacheForUser('qiuqiu');

    const cacheDeletes = client.operations.filter(operation =>
        operation.table === 'question_cache' && operation.operation === 'delete'
    );
    const repairRows = client.db.question_cache.filter(row => row.word_id === repairWord.id);
    const oldRepairRows = repairRows.filter(row => repairCacheIds.has(row.id));
    const readyRepairRows = repairRows.filter(row =>
        row.quality_status === 'ready' && ['active', 'reserved_next_day'].includes(row.cache_state)
    );
    const rebuildUpsert = client.operations.find(operation =>
        operation.table === 'question_cache' && operation.operation === 'upsert'
    );

    assert.equal(cacheDeletes.length, 0);
    assert.equal(result.count, 2);
    assert.equal(result.status.ready, 2);
    assert.equal([...retainedCacheIds].every(id =>
        client.db.question_cache.some(row => row.id === id)
    ), true);
    assert.equal(existingWords.every(word =>
        client.db.question_cache.filter(row => row.word_id === word.id).length === 2
    ), true);
    assert.equal(oldRepairRows.length, 2);
    assert.equal(oldRepairRows.every(row => row.cache_state === 'retired'), true);
    assert.equal(readyRepairRows.length, 2);
    assert.equal(readyRepairRows
        .every(row => row.context_zh !== repairWord.meaning_zh), true);
    assert.equal(rebuildUpsert.selectColumns, '*');
});

test('rebuildQuestionCache repairs duplicate stem and distractor pairs', async () => {
    const word = {
        id: 'word-duplicate',
        feishu_record_id: 'rec-word-duplicate',
        user_id: 'user-1',
        word: 'lucky',
        meaning_en: 'having good fortune',
        meaning_zh: '\u5e78\u8fd0\u7684',
        level: MIDDLE,
        context_en: 'The lucky child found a coin after school.',
        distractors: ['alpha', 'bravo', 'charlie'],
        old_distractors: [],
        mastery_status: 'pending',
    };
    const oldIds = ['cache-duplicate-1', 'cache-duplicate-2'];
    const seed = {
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [word],
        assessments: [],
        question_cache: oldIds.map((id, index) => ({
            id,
            user_id: 'user-1',
            word_id: word.id,
            source_word_record_id: word.feishu_record_id,
            level: MIDDLE,
            round_type: 'primary',
            quality_status: 'ready',
            cache_state: index === 0 ? 'active' : 'reserved_next_day',
            question_type: '1',
            question_fingerprint: `duplicate-fingerprint-${index + 1}`,
            question_text: 'The lucky child found a coin after school.',
            context_zh: DEFAULT_TEST_CONTEXT_TRANSLATION,
            options: ['A. lucky', 'B. alpha', 'C. bravo', 'D. charlie'],
            answer: 'A',
            option_meanings: [word.meaning_zh, '\u4e2d\u6587\u91ca\u4e49', '\u4e2d\u6587\u91ca\u4e49', '\u4e2d\u6587\u91ca\u4e49'],
            correct_meaning: word.meaning_zh,
        })),
    };
    const createAdapter = client => createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(value => [value, '\u4e2d\u6587\u91ca\u4e49'])),
        generateContext: async value => `The second ${value} sentence is ready.`,
        generateDistractors: contextualDistractorsForTest,
    });

    const client = createFakeSupabase(seed);
    const result = await createAdapter(client).rebuildQuestionCacheForUser('qiuqiu');
    assert.equal(result.count, 2);
    const replacedOldRows = client.db.question_cache.filter(row => row.id && oldIds.includes(row.id));
    const readyRows = client.db.question_cache.filter(row =>
        row.word_id === word.id && ['active', 'reserved_next_day'].includes(row.cache_state)
    );
    assert.equal(replacedOldRows.length, 2);
    assert.equal(replacedOldRows.every(row => row.cache_state === 'retired'), true);
    assert.equal(readyRows.length, 2);
    assert.equal(client.operations.some(operation => operation.operation === 'delete'), false);

    const failedClient = createFakeSupabase(seed, {
        missingColumns: { question_cache: ['question_fingerprint'] },
    });
    await assert.rejects(
        createAdapter(failedClient).rebuildQuestionCacheForUser('qiuqiu'),
        /rebuildQuestionCache\.upsert/
    );
    assert.deepEqual(
        failedClient.db.question_cache.map(row => row.id).sort(),
        [...oldIds].sort()
    );
});

test('rebuildQuestionCacheForUser always backfills missing middle-school contexts', async () => {
    const previous = process.env.WORDBOT_CACHE_REBUILD_AI_CONTEXT;
    delete process.env.WORDBOT_CACHE_REBUILD_AI_CONTEXT;
    try {
        const client = createFakeSupabase({
            users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
            words: ['brake', 'frown'].map((word, index) => ({
                id: `word-${index + 1}`,
                feishu_record_id: `rec-word-${index + 1}`,
                user_id: 'user-1',
                word,
                meaning_en: `Meaning ${index + 1}`,
                meaning_zh: '\u4e2d\u6587\u91ca\u4e49',
                level: MIDDLE,
                context_en: null,
                distractors: ['repair', 'straight', 'attic'],
                old_distractors: [],
                mastery_status: 'pending',
                entered_at: `2026-07-19T00:00:0${index}.000Z`,
            })),
            assessments: [],
            question_cache: [],
        });
        const adapter = createSupabaseDataAdapter(client, {
            generateContext: async (word, meaning, level, previous) => previous ? `The student checked the ${word} before leaving.` : `The teacher asks the student to use ${word} in a sentence.`,
            generateDistractors: contextualDistractorsForTest,
            translateWords: async words => Object.fromEntries(words.map((word, index) => [word, ['修理', '笔直', '阁楼', '其他'][index]])),
        });

        const result = await adapter.rebuildQuestionCacheForUser('qiuqiu');
        const primary = client.db.question_cache.filter(row => row.round_type === 'primary');

        assert.equal(result.count, 4);
        assert.equal(primary.length, 4);
        assert.deepEqual([...new Set(primary.map(row => row.word_id))].sort(), ['word-1', 'word-2']);
        assert.equal(primary.every(row => row.question_type === '1'), true);
    } finally {
        if (previous === undefined) delete process.env.WORDBOT_CACHE_REBUILD_AI_CONTEXT;
        else process.env.WORDBOT_CACHE_REBUILD_AI_CONTEXT = previous;
    }
});

test('rebuildQuestionCacheForUser never seeds mastered words when pending words are available', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [
            {
                id: 'mastered-word', feishu_record_id: 'rec-mastered-word', user_id: 'user-1', word: 'groan',
                meaning_en: 'make a sound', meaning_zh: '\u4e2d\u6587\u91ca\u4e49', level: MIDDLE,
                context_en: 'The child began to groan.', distractors: ['repair', 'straight', 'attic'],
                old_distractors: [], mastery_status: 'mastered', entered_at: '2026-07-19T00:00:00.000Z',
            },
            {
                id: 'pending-word', feishu_record_id: 'rec-pending-word', user_id: 'user-1', word: 'brake',
                meaning_en: 'a device for stopping', meaning_zh: '\u4e2d\u6587\u91ca\u4e49', level: MIDDLE,
                context_en: 'The driver pressed the brake.', distractors: ['repair', 'straight', 'attic'],
                old_distractors: [], mastery_status: 'pending', entered_at: '2026-07-20T00:00:00.000Z',
            },
        ],
        assessments: [
            { id: 'mastered-1', user_id: 'user-1', word_id: 'mastered-word', source_word_record_id: 'rec-mastered-word', test_id: 'real-quiz-1', assessed_at: '2026-07-20T00:00:00.000Z', question_type: '1', is_correct: 'correct', submitted_answer: 'A|sure' },
            { id: 'mastered-2', user_id: 'user-1', word_id: 'mastered-word', source_word_record_id: 'rec-mastered-word', test_id: 'real-quiz-2', assessed_at: '2026-07-21T00:00:00.000Z', question_type: '1', is_correct: 'correct', submitted_answer: 'A|sure' },
        ],
        question_cache: [{ id: 'existing-cache' }],
    });
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map((word, index) => [word, ['修理', '笔直', '阁楼', '其他'][index]])),
        generateContext: async word => `A second sentence contains ${word}.`,
        generateDistractors: contextualDistractorsForTest,
    });

    const result = await adapter.rebuildQuestionCacheForUser('qiuqiu');
    const primary = client.db.question_cache.filter(row => row.round_type === 'primary');

    assert.equal(result.count, 2);
    assert.deepEqual(primary.map(row => row.word_id), ['pending-word', 'pending-word']);
});

test('addWord persists a generation job for the inserted meaning', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        question_generation_jobs: [],
    });
    const adapter = createSupabaseDataAdapter(client);

    const inserted = await adapter.addWord({
        username: 'qiuqiu',
        word: 'bank',
        meaning: 'a financial institution',
        meaningZh: '银行',
        level: MIDDLE,
    });

    assert.equal(client.db.question_generation_jobs.length, 1);
    assert.deepEqual(client.db.question_generation_jobs[0], {
        user_id: 'user-1',
        word_id: inserted.id,
        status: 'pending',
        reason: 'word_entry',
        attempt_count: 0,
        next_attempt_at: inserted.entered_at,
    });
});

test('wrong-answer cache prebuild uses injected generators for both replacement stems', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [{
            id: 'word-1', feishu_record_id: 'rec-word-1', user_id: 'user-1', word: 'apple',
            meaning_en: 'a fruit', meaning_zh: '苹果', level: MIDDLE, mastery_status: 'pending',
        }],
        assessments: [{
            id: 'assessment-1', user_id: 'user-1', word_id: 'word-1', source_word_record_id: 'rec-word-1',
            test_id: 'real-quiz-1', assessed_at: '2026-08-01T00:00:00.000Z', question_type: '1',
            question_text: 'The child saw an _____.', is_correct: 'wrong', submitted_answer: 'B|sure',
        }],
        question_cache: [{
            id: 'cache-old', user_id: 'user-1', word_id: 'word-1', source_word_record_id: 'rec-word-1',
            round_type: 'primary', question_text: 'The child saw an _____.',
        }],
    });
    const contextCalls = [];
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [word, word === 'apple' ? '苹果' : '干扰项'])),
        generateDistractors: contextualDistractorsForTest,
        generateContext: async (word, meaning, level, previous) => {
            contextCalls.push(previous);
            return contextCalls.length === 1 ? 'The child ate an apple after school.' : 'The child packed an apple for the long trip.';
        },
    });
    const previousKey = process.env.MINIMAX_API_KEY;
    delete process.env.MINIMAX_API_KEY;
    try {
        const result = await adapter.prebuildWrongQuestionCache({
            userId: 'qiuqiu', testId: 'real-quiz-1',
            result: { results: [{ recordId: 'rec-word-1', correct: false }] },
        });
        assert.equal(result.prepared, 1);
        assert.equal(contextCalls.length, 2);
        assert.equal(client.db.question_cache.some(row => row.id === 'cache-old'), false);
        assert.equal(client.db.question_cache.some(row => row.source_version === 'supabase-wrong-recovery-v1'), true);
    } finally {
        if (previousKey === undefined) delete process.env.MINIMAX_API_KEY;
        else process.env.MINIMAX_API_KEY = previousKey;
    }
});
test('context generation uses the shared bounded MiniMax request', async () => {
    const previousKey = process.env.MINIMAX_API_KEY;
    const previousModel = process.env.MINIMAX_MODEL;
    const previousFetch = global.fetch;
    let request;
    process.env.MINIMAX_API_KEY = 'test-key';
    process.env.MINIMAX_MODEL = 'MiniMax-M2.5';
    global.fetch = async (url, options) => {
        request = { url, options };
        return {
            ok: true,
            json: async () => ({
                choices: [{ message: { content: '{"context":"The child used an abacus during math class."}' } }],
            }),
        };
    };
    try {
        const result = await generateReplacementContextWithAI('abacus', '算盘', '小学', '');
        const body = JSON.parse(request.options.body);
        assert.equal(result, 'The child used an abacus during math class.');
        assert.equal(body.model, 'MiniMax-M2.5');
        assert.equal(body.max_tokens, 2048);
        assert.equal(body.temperature, 0.1);
        assert.ok(body.messages[0].content.length < 500, 'context prompt must stay compact');
    } finally {
        if (previousKey === undefined) delete process.env.MINIMAX_API_KEY;
        else process.env.MINIMAX_API_KEY = previousKey;
        if (previousModel === undefined) delete process.env.MINIMAX_MODEL;
        else process.env.MINIMAX_MODEL = previousModel;
        global.fetch = previousFetch;
    }
});

test('rebuildQuestionCacheForUser translates each completed type-one stem independently', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [{
            id: 'word-1',
            feishu_record_id: 'rec-word-1',
            user_id: 'user-1',
            word: 'apple',
            meaning_en: 'a fruit',
            meaning_zh: '苹果',
            context_en: 'The child ate an apple after school.',
            context_zh: '苹果',
            level: MIDDLE,
            mastery_status: 'pending',
            entered_at: '2026-07-30T00:00:00.000Z',
        }],
        assessments: [],
        question_cache: [],
    });
    const translationCalls = [];
    const translations = new Map([
        ['The child ate an apple after school.', '放学后，这个孩子吃了一个苹果'],
        ['The child packed an apple for the long trip.', '这个孩子为长途旅行装了一个苹果'],
    ]);
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [
            word,
            word === 'apple' ? '苹果' : '干扰项',
        ])),
        translateContext: async sentence => {
            translationCalls.push(sentence);
            return translations.get(sentence) || '';
        },
        generateContext: async (word, meaning, level, previous) =>
            previous ? 'The child packed an apple for the long trip.' : previous,
        generateDistractors: contextualDistractorsForTest,
    });

    const result = await adapter.rebuildQuestionCacheForUser('qiuqiu');
    const rows = client.db.question_cache.filter(row => row.round_type === 'primary');

    assert.equal(result.count, 2);
    assert.deepEqual(translationCalls, [...translations.keys()]);
    assert.deepEqual(rows.map(row => row.context_zh), [...translations.values()]);
    assert.equal(rows.every(row => row.context_zh !== row.correct_meaning), true);
});

test('rebuildQuestionCacheForUser publishes no ready rows when sentence translation fails', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [{
            id: 'word-1',
            feishu_record_id: 'rec-word-1',
            user_id: 'user-1',
            word: 'apple',
            meaning_en: 'a fruit',
            meaning_zh: '苹果',
            context_en: 'The child ate an apple after school.',
            context_zh: '放学后，这个孩子吃了一个苹果',
            level: MIDDLE,
            mastery_status: 'pending',
            entered_at: '2026-07-30T00:00:00.000Z',
        }],
        assessments: [],
        question_cache: [],
    });
    const adapter = createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map(word => [
            word,
            word === 'apple' ? '苹果' : '干扰项',
        ])),
        translateContext: async () => '',
        generateContext: async (word, meaning, level, previous) =>
            previous ? 'The child packed an apple for the long trip.' : previous,
        generateDistractors: contextualDistractorsForTest,
    });

    const result = await adapter.rebuildQuestionCacheForUser('qiuqiu');

    assert.equal(result.count, 0);
    assert.equal(client.db.question_cache.length, 0);
});

test('rebuildQuestionCacheForUser retains translation-invalid cache rows when no replacement pair can publish', async () => {
    const words = Array.from({ length: 10 }, (_, index) => ({
        id: `word-${index + 1}`,
        feishu_record_id: `rec-word-${index + 1}`,
        user_id: 'user-1',
        word: `word${index + 1}`,
        meaning_en: `meaning ${index + 1}`,
        meaning_zh: `\u91ca\u4e49${index + 1}`,
        context_en: `The child learned word${index + 1} after school.`,
        level: MIDDLE,
        mastery_status: 'pending',
        entered_at: '2026-07-30T00:00:00.000Z',
    }));
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words,
        assessments: [],
        question_cache: [{
            id: 'bad-cache',
            user_id: 'user-1',
            word_id: 'word-1',
            source_word_record_id: 'rec-word-1',
            level: MIDDLE,
            round_type: 'primary',
            quality_status: 'ready',
            cache_state: 'active',
            question_type: '1',
            question_text: 'The child learned word1 after school.',
            context_zh: '\u91ca\u4e49',
            options: ['A. word1', 'B. pear', 'C. desk', 'D. chair'],
            answer: 'A',
            option_meanings: ['\u91ca\u4e49', '\u68a8', '\u4e66\u684c', '\u6905\u5b50'],
            correct_meaning: '\u91ca\u4e49',
        }],
    });
    const adapter = createSupabaseDataAdapter(client, {
        generateDistractors: async () => null,
        translateWords: async () => ({}),
    });

    const result = await adapter.rebuildQuestionCacheForUser('qiuqiu');

    assert.equal(result.count, 0);
    assert.equal(result.retainedExisting, undefined);
    assert.deepEqual(client.db.question_cache.map(row => row.id), ['bad-cache']);
});

function rebuildCoverageWord(id, word, enteredAt = '2026-07-01T00:00:00.000Z') {
    return {
        id,
        feishu_record_id: `rec-${id}`,
        user_id: 'user-1',
        word,
        meaning_en: `meaning for ${word}`,
        meaning_zh: '\u4e2d\u6587\u91ca\u4e49',
        context_en: `The ${word} child found a coin after school.`,
        distractors: ['alpha', 'bravo', 'charlie'],
        old_distractors: [],
        level: MIDDLE,
        mastery_status: 'pending',
        entered_at: enteredAt,
    };
}

function rebuildCoverageInvalidPair(word) {
    return [1, 2].map(slot => ({
        id: `old-${word.id}-${slot}`,
        user_id: 'user-1',
        word_id: word.id,
        source_word_record_id: word.feishu_record_id,
        level: MIDDLE,
        round_type: 'primary',
        quality_status: 'ready',
        cache_state: slot === 1 ? 'active' : 'reserved_next_day',
        question_type: '1',
        question_fingerprint: `old-${word.id}-fingerprint-${slot}`,
        question_text: `The student saw _____ ${slot} after school.`,
        context_zh: word.meaning_zh,
        options: [`A. ${word.word}`, 'B. alpha', 'C. bravo', 'D. charlie'],
        answer: 'A',
        option_meanings: [word.meaning_zh, '\u4e2d\u6587\u91ca\u4e49', '\u4e2d\u6587\u91ca\u4e49', '\u4e2d\u6587\u91ca\u4e49'],
        correct_meaning: word.meaning_zh,
    }));
}

function createRebuildCoverageAdapter(client, options = {}) {
    return createSupabaseDataAdapter(client, {
        translateWords: async words => Object.fromEntries(words.map((word, index) => [word, ['甲项', '乙项', '丙项', '丁项'][index]])),
        generateContext: async word => `The second ${word} sentence is ready.`,
        generateDistractors: contextualDistractorsForTest,
        ...options,
    });
}

test('new cache generation fails closed when semantic audit is unavailable', async () => {
    const word = rebuildCoverageWord('semantic-audit', 'lucky');
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [word], assessments: [], question_cache: rebuildCoverageInvalidPair(word),
    });
    const result = await createRebuildCoverageAdapter(client, {
        semanticAudit: async () => ({ approved: false, status: 'unavailable' }),
    }).rebuildQuestionCacheForUser('qiuqiu');

    assert.equal(result.count, 0);
    assert.equal(client.db.question_cache.some(row => row.source_version === 'supabase-contextual-variant-v3'), false);
});

test('new cache generation records approved semantic audit before ready publication', async () => {
    const word = rebuildCoverageWord('semantic-approved', 'lucky');
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [word], assessments: [], question_cache: rebuildCoverageInvalidPair(word),
    });
    const result = await createRebuildCoverageAdapter(client, {
        semanticAudit: async () => ({ approved: true, status: 'approved', validLetters: ['A'] }),
    }).rebuildQuestionCacheForUser('qiuqiu');
    const published = client.db.question_cache.filter(row => row.source_version === 'supabase-contextual-variant-v3');

    assert.equal(result.count, 2);
    assert.equal(published.length, 2);
    assert.equal(published.every(row => row.ai_audit_status === 'approved' && row.quality_status === 'ready'), true);
});

test('rebuildQuestionCacheForUser covers every unmastered meaning beyond the formal quiz seed size', async () => {
    const names = ['amber', 'basic', 'cider', 'daisy', 'ember', 'fable', 'glade', 'honey', 'ivory', 'jolly', 'karma', 'lilac'];
    const words = names.map((word, index) => rebuildCoverageWord(
        `coverage-${index + 1}`,
        word,
        `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`
    ));
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words,
        assessments: [],
        question_cache: [],
    });

    const result = await createRebuildCoverageAdapter(client).rebuildQuestionCacheForUser('qiuqiu');
    const primaryRows = client.db.question_cache.filter(row =>
        row.round_type === 'primary'
        && row.quality_status === 'ready'
        && ['active', 'reserved_next_day'].includes(row.cache_state)
    );

    assert.equal(result.count, 24);
    assert.equal(primaryRows.length, 24);
    for (const word of words) {
        const rows = primaryRows.filter(row => row.word_id === word.id);
        assert.equal(rows.length, 2, word.id);
        assert.equal(new Set(rows.map(row => row.question_text)).size, 2, word.id);
    }
});

test('rebuildQuestionCacheForUser keeps a bad pair isolated when replacement writing fails', async () => {
    const word = rebuildCoverageWord('write-failure', 'lucky');
    const oldRows = rebuildCoverageInvalidPair(word);
    oldRows[0].context_zh = DEFAULT_TEST_CONTEXT_TRANSLATION;
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [word],
        assessments: [],
        question_cache: oldRows,
    }, {
        missingColumns: { question_cache: ['question_fingerprint'] },
    });

    await assert.rejects(
        createRebuildCoverageAdapter(client).rebuildQuestionCacheForUser('qiuqiu'),
        /rebuildQuestionCache\.(?:insert|upsert)/
    );

    assert.equal(client.db.question_cache.every(row => row.cache_state === 'replace_pending'), true);
});

test('rebuildQuestionCacheForUser upserts a matching fingerprint and atomically retires the other old row', async () => {
    const word = rebuildCoverageWord('conflict', 'lucky');
    const oldRows = rebuildCoverageInvalidPair(word);
    oldRows[0] = {
        ...oldRows[0],
        id: 'matching-old-row',
        question_fingerprint: crypto.createHash('sha256').update(JSON.stringify({
            wordId: word.id,
            questionText: 'the _____ child found a coin after school.',
            questionType: '1',
            meaning: word.meaning_zh,
        })).digest('hex'),
        question_text: 'The _____ child found a coin after school.',
        context_zh: DEFAULT_TEST_CONTEXT_TRANSLATION,
        used_count: 7,
        last_used_at: '2026-08-01T00:00:00.000Z',
    };
    oldRows[1].id = 'translation-invalid-old-row';
    delete oldRows[0].source_word_record_id;
    delete oldRows[1].source_word_record_id;
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [word],
        assessments: [],
        question_cache: oldRows,
    });

    const result = await createRebuildCoverageAdapter(client).rebuildQuestionCacheForUser('qiuqiu');
    const finalRows = client.db.question_cache.filter(row => row.word_id === word.id);
    const readyRows = finalRows.filter(row => ['active', 'reserved_next_day'].includes(row.cache_state));
    const retiredRow = finalRows.find(row => row.id === 'translation-invalid-old-row');
    const matchingRow = finalRows.find(row => row.id === 'matching-old-row');
    const upsertOperation = client.operations.find(operation => operation.operation === 'upsert');

    assert.equal(result.count, 2);
    assert.equal(result.status.ready, 2);
    assert.equal(finalRows.length, 3);
    assert.equal(readyRows.length, 2);
    assert.equal(new Set(readyRows.map(row => row.question_fingerprint)).size, 2);
    assert.equal(matchingRow.used_count, 7);
    assert.equal(matchingRow.last_used_at, '2026-08-01T00:00:00.000Z');
    assert.equal(retiredRow.cache_state, 'retired');
    assert.equal(readyRows.every(row => row.context_zh !== word.meaning_zh), true);
    assert.equal(client.operations.some(operation => operation.operation === 'delete'), false);
    assert.equal(upsertOperation.selectColumns, '*');
    assert.equal(upsertOperation.upsertOptions.onConflict, 'user_id,word_id,question_fingerprint');
    assert.equal(upsertOperation.upsertOptions.defaultToNull, false);
    assert.equal(upsertOperation.payload.filter(row =>
        row.word_id === word.id && row.quality_status === 'ready' && ['active', 'reserved_next_day'].includes(row.cache_state)
    ).length, 2);
    assert.equal(upsertOperation.payload.some(row =>
        row.id === 'translation-invalid-old-row' && row.cache_state === 'retired'
    ), true);
});

test('rebuildQuestionCacheForUser publishes completed pairs while retaining unrebuildable meanings', async () => {
    const words = ['amber', 'basic', 'cider', 'daisy', 'ember', 'fable', 'glade', 'honey', 'ivory', 'jolly']
        .map((word, index) => rebuildCoverageWord('partial-' + (index + 1), word));
    const successfulWordIds = new Set(words.slice(0, 2).map(word => word.id));
    const oldRows = words.flatMap(word => {
        const pair = rebuildCoverageInvalidPair(word);
        pair[0].context_zh = DEFAULT_TEST_CONTEXT_TRANSLATION;
        return pair;
    });
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words,
        assessments: [],
        question_cache: oldRows,
    });
    const adapter = createRebuildCoverageAdapter(client, {
        generateContext: async (word, meaning, level, previous) => {
            const current = words.find(candidate => candidate.word === word);
            if (!current || !successfulWordIds.has(current.id)) return '';
            return previous
                ? 'The second ' + word + ' sentence is ready.'
                : 'The first ' + word + ' sentence is ready.';
        },
    });

    const result = await adapter.rebuildQuestionCacheForUser('qiuqiu');
    const rebuiltRows = client.db.question_cache.filter(row => successfulWordIds.has(row.word_id));
    const unrebuildableRows = client.db.question_cache.filter(row => !successfulWordIds.has(row.word_id));

    assert.equal(result.count, 4);
    assert.equal(rebuiltRows.filter(row => ['active', 'reserved_next_day'].includes(row.cache_state)).length, 4);
    assert.equal(rebuiltRows.filter(row => row.cache_state === 'retired').length, 4);
    assert.deepEqual(unrebuildableRows, oldRows.filter(row => !successfulWordIds.has(row.word_id)));
});

test('rebuildQuestionCacheForUser prioritizes previously tested meanings before untested and today-tested meanings', async () => {
    const names = ['amber', 'basic', 'cider', 'daisy', 'ember', 'fable', 'glade', 'honey', 'ivory', 'jolly', 'karma', 'lilac'];
    const words = names.map((word, index) => rebuildCoverageWord(
        `priority-${index + 1}`,
        word,
        `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`
    ));
    const untested = words.slice(0, 7);
    const testedToday = words.slice(7, 8);
    const testedBeforeToday = words.slice(8);
    const now = Date.now();
    const assessments = [
        ...testedBeforeToday.map((word, index) => ({
            id: `past-${index + 1}`,
            user_id: 'user-1',
            word_id: word.id,
            source_word_record_id: word.feishu_record_id,
            test_id: `real-past-${index + 1}`,
            assessed_at: new Date(now - (48 * 60 * 60 * 1000)).toISOString(),
            question_type: '1',
            is_correct: 'wrong',
            submitted_answer: 'B|sure',
        })),
        ...testedToday.map((word, index) => ({
            id: `today-${index + 1}`,
            user_id: 'user-1',
            word_id: word.id,
            source_word_record_id: word.feishu_record_id,
            test_id: `real-today-${index + 1}`,
            assessed_at: new Date(now).toISOString(),
            question_type: '1',
            is_correct: 'wrong',
            submitted_answer: 'B|sure',
        })),
    ];
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words,
        assessments,
        question_cache: words.flatMap(rebuildCoverageInvalidPair),
    });

    const result = await createRebuildCoverageAdapter(client).rebuildQuestionCacheForUser('qiuqiu');
    const publishedSourceIds = [...new Set(client.db.question_cache
        .filter(row => row.context_zh === DEFAULT_TEST_CONTEXT_TRANSLATION)
        .map(row => row.source_word_record_id))];

    assert.equal(result.count, 24);
    assert.deepEqual(publishedSourceIds, [
        ...testedBeforeToday.map(word => word.feishu_record_id),
        ...untested.map(word => word.feishu_record_id),
        testedToday[0].feishu_record_id,
    ]);
});


test('rebuildQuestionCacheForUser regenerates an unmastered meaning at the user learning level', async () => {
    const highLevel = String.fromCharCode(0x9ad8, 0x4e2d);
    const word = { ...rebuildCoverageWord('cross-level', 'lucky'), level: highLevel };
    const oldRows = rebuildCoverageInvalidPair(word).map(row => ({ ...row, level: highLevel }));
    oldRows[0].options = ['A. lucky', 'B. alpha', 'C. bravo', 'D. charlie'];
    oldRows[1].options = ['A. lucky', 'B. delta', 'C. echo', 'D. foxtrot'];
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [word],
        assessments: [],
        question_cache: oldRows,
    });

    const result = await createRebuildCoverageAdapter(client).rebuildQuestionCacheForUser('qiuqiu');
    const activeRows = client.db.question_cache.filter(row =>
        row.word_id === word.id && ['active', 'reserved_next_day'].includes(row.cache_state)
    );

    assert.equal(result.count, 2);
    assert.equal(activeRows.length, 2);
    assert.equal(activeRows.every(row => row.level === MIDDLE), true);
    assert.equal(client.db.question_cache.filter(row => row.id && oldRows.some(old => old.id === row.id))
        .every(row => row.cache_state === 'retired'), true);
});

test('rebuildQuestionCacheForUser isolates a duplicate-stem pair before scheduling its durable repair job', async () => {
    const word = rebuildCoverageWord('durable-retry', 'lucky');
    const oldRows = rebuildCoverageInvalidPair(word).map(row => ({
        ...row,
        context_zh: DEFAULT_TEST_CONTEXT_TRANSLATION,
        question_text: 'The lucky student saw _____ after school.',
    }));
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [word],
        assessments: [],
        question_cache: oldRows,
        question_generation_jobs: [],
    });

    const result = await createRebuildCoverageAdapter(client, {
        generateDistractors: async () => null,
    }).rebuildQuestionCacheForUser('qiuqiu');

    assert.equal(result.count, 0);
    assert.equal(client.db.question_cache.every(row => row.cache_state === 'replace_pending'), true);
    assert.deepEqual(client.operations.filter(operation => operation.table === 'rpc' || operation.table === 'question_cache')
        .map(operation => `${operation.table}:${operation.operation}`), [
            'question_cache:update',
            'rpc:rpc',
        ]);
    assert.deepEqual(client.db.question_generation_jobs.map(job => ({
        user_id: job.user_id,
        word_id: job.word_id,
        status: job.status,
        reason: job.reason,
    })), [{
        user_id: 'user-1',
        word_id: word.id,
        status: 'pending',
        reason: 'cache_backfill',
    }]);
});

test('rebuildQuestionCacheForUser confirms a false enqueue response against an executable durable job', async () => {
    const word = rebuildCoverageWord('durable-existing', 'lucky');
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [word],
        assessments: [],
        question_cache: rebuildCoverageInvalidPair(word),
        question_generation_jobs: [{ id: 'job-1', user_id: 'user-1', word_id: word.id, status: 'generating' }],
    }, { rpcDataFalseAlways: true });

    await createRebuildCoverageAdapter(client, {
        generateDistractors: async () => null,
    }).rebuildQuestionCacheForUser('qiuqiu');

    assert.equal(client.db.question_cache.every(row => row.cache_state === 'replace_pending'), true);
    assert.equal(client.queries.includes('question_generation_jobs'), true);
});

test('deleteWord removes only the owned meaning and its unreferenced cache', async () => {
    const client = seededClient();
    client.db.quiz_challenge_questions = [];
    client.db.quiz_display_events = [];
    client.db.words.push({
        id: 'word-2', feishu_record_id: 'rec-word-2', user_id: 'user-1',
        word: 'banana', meaning_en: 'a fruit', mastery_status: 'pending',
    });
    client.db.question_cache.push({
        id: 'cache-word-2', user_id: 'user-1', word_id: 'word-2',
        source_word_record_id: 'rec-word-2',
    });

    const result = await createSupabaseDataAdapter(client).deleteWord('qiuqiu', 'banana', {
        recordId: 'rec-word-2',
    });

    assert.deepEqual(result, { success: true, recordId: 'rec-word-2' });
    assert.equal(client.db.words.some(row => row.id === 'word-2'), false);
    assert.equal(client.db.question_cache.some(row => row.id === 'cache-word-2'), false);
});

test('deleteWord refuses to remove a meaning referenced by formal challenge history', async () => {
    const client = seededClient();
    client.db.quiz_challenge_questions = [{
        id: 'challenge-question-1', meaning_id: 'word-1', cache_question_id: 'cache-1',
    }];

    const result = await createSupabaseDataAdapter(client).deleteWord('qiuqiu', 'Apple', {
        recordId: 'rec-word-1',
    });

    assert.equal(result.success, false);
    assert.equal(result.code, 'WORD_DELETE_BLOCKED_BY_FORMAL_HISTORY');
    assert.equal(client.db.words.some(row => row.id === 'word-1'), true);
});

test('updateMultiDefinition marks every selected owned meaning in Supabase', async () => {
    const client = seededClient();
    client.db.words.push({
        id: 'word-bank', feishu_record_id: 'rec-bank', user_id: 'user-1',
        word: 'bank', meaning_en: 'river edge', mastery_status: 'pending',
    });

    const result = await createSupabaseDataAdapter(client).updateMultiDefinition('qiuqiu', ['Apple', 'bank']);

    assert.deepEqual(result, { success: true, updated: 2 });
    assert.equal(client.db.words.find(row => row.id === 'word-1').multi_definition, 'yes');
    assert.equal(client.db.words.find(row => row.id === 'word-bank').multi_definition, 'yes');
});

test('validateWords checks Supabase-owned duplicates and malformed words without Feishu', async () => {
    const client = seededClient();
    client.db.words.push({
        id: 'word-bank', user_id: 'user-1', word: 'bank', meaning_en: 'river edge',
    });

    const result = await createSupabaseDataAdapter(client).validateWords('qiuqiu', [
        { word: 'Apple', meaning: 'another meaning' },
        { word: 'bank', meaning: 'river edge' },
        { word: 'bad!word', meaning: 'invalid' },
    ]);

    assert.deepEqual(result.errors, [{ word: 'bad!word', meaning: 'invalid' }]);
    assert.deepEqual(result.duplicateWords.map(item => item.word).sort(), ['apple', 'bank']);
    assert.deepEqual(result.multiMeanings, []);
});

test('Supabase word editor reads newly entered words from the authoritative words table', async () => {
    const client = seededClient();
    client.db.words.push({
        id: 'word-new',
        feishu_record_id: 'rec-word-new',
        user_id: 'user-1',
        word: 'cushion',
        meaning_en: 'a soft support',
        meaning_zh: '垫子',
        context_en: 'The student used a cushion.',
        context_zh: '学生用了一个垫子。',
        distractors: ['pillow'],
        mastery_status: 'pending',
        entered_at: '2026-08-10T10:00:00.000Z',
    });
    const adapter = createSupabaseDataAdapter(client);

    const found = await adapter.getWord('qiuqiu', 'cushion');
    assert.equal(found.word, 'cushion');
    assert.equal(found.meaning, 'a soft support');
    assert.equal(found.cnMeaning, '垫子');
    assert.equal(found.record_id, 'rec-word-new');

    const page = await adapter.listUserWords('qiuqiu', { page: 1, pageSize: 20 });
    assert.equal(page.total, 2);
    assert.equal(page.words.some(word => word.word === 'cushion'), true);
});

test('Supabase formal history keeps the exact submitted stem and options', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
        question_cache: [{
            id: 'cache-citizen-1', user_id: 'user-1', word_id: 'meaning-citizen',
            question_text: 'Every good _____ obeys the law.',
            context_zh: '每一个好公民都应遵守法律。',
            option_meanings: ['公民', '访客', '老师', '歌手'],
        }],
        assessments: [
            {
                id: 'assessment-1', user_id: 'user-1', word_id: 'meaning-citizen', test_id: 'real-history-1',
                assessed_at: '2026-08-09T08:00:00.000Z', word_snapshot: 'citizen',
                question_type: '1', question_text: 'Every good _____ obeys the law.',
                options: ['A. citizen', 'B. visitor', 'C. teacher', 'D. singer'],
                correct_answer: 'A', submitted_answer: 'B|sure', is_correct: 'wrong',
            },
            {
                id: 'assessment-preview', user_id: 'user-1', test_id: 'test-history-1',
                assessed_at: '2026-08-09T08:01:00.000Z', word_snapshot: 'preview',
                question_type: '1', question_text: 'Preview _____ only.',
                options: ['A. preview'], correct_answer: 'A', submitted_answer: 'A|sure', is_correct: 'correct',
            },
            {
                id: 'assessment-non-formal', user_id: 'user-1', test_id: 'real-history-preview', is_real_assessment: false,
                assessed_at: '2026-08-09T08:03:00.000Z', word_snapshot: 'preview',
                question_type: '1', question_text: 'Not a formal result.', options: ['A. preview'], submitted_answer: 'A|sure', is_correct: 'correct',
            },
        ],
    });
    const adapter = createSupabaseDataAdapter(client);

    assert.deepEqual(await adapter.getQuizHistory('qiuqiu', 'real'), [{
        testId: 'real-history-1',
        mode: 'real',
        time: Date.parse('2026-08-09T08:00:00.000Z'),
        correct: 0,
        total: 1,
        questions: [{
            assessmentId: 'assessment-1',
            meaningId: 'meaning-citizen',
            word: 'citizen',
            question: 'Every good _____ obeys the law.',
            contextCN: '每一个好公民都应遵守法律。',
            type: 1,
            options: ['A. citizen', 'B. visitor', 'C. teacher', 'D. singer'],
            optionMeanings: ['公民', '访客', '老师', '歌手'],
            yourAnswer: 'B',
            confidence: 'sure',
            correctAnswer: 'A',
            isCorrect: false,
            contentState: 'complete',
            missingFields: [],
        }],
    }]);
});

test('non-mastered stage changes preserve cache and do not fence generation', async () => {
    const client = seededClient();
    client.db.question_cache.push({ id: 'cache-stage', user_id: 'user-1', word_id: 'word-1' });
    client.db.question_generation_jobs.push({ id: 'job-stage', user_id: 'user-1', word_id: 'word-1', status: 'ready' });
    const adapter = createSupabaseDataAdapter(client);

    await adapter.updateWordMastery('qiuqiu', 'Apple', 'recognized');

    assert.equal(client.db.words[0].mastery_status, 'recognized');
    assert.ok(client.db.question_cache.some(row => row.id === 'cache-stage'));
    assert.equal(client.db.question_generation_jobs.find(row => row.id === 'job-stage').status, 'ready');
    assert.equal(client.operations.filter(operation => operation.table === 'rpc').length, 0);
});

test('Supabase history excludes ungraded placeholder rows instead of showing them as wrong', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
        assessments: [
            {
                id: 'assessment-graded', user_id: 'user-1', word_id: 'word-1', test_id: 'real-history-filter',
                assessed_at: '2026-08-09T08:00:00.000Z', word_snapshot: 'citizen',
                question_type: '1', question_text: 'A _____ obeys the law.', options: ['A. citizen'],
                correct_answer: 'A', submitted_answer: 'A|sure', is_correct: 'correct',
            },
            {
                id: 'assessment-ungraded', user_id: 'user-1', word_id: 'word-2', test_id: 'real-history-filter',
                assessed_at: '2026-08-09T08:01:00.000Z', word_snapshot: 'draft',
                question_type: '1', question_text: 'An unfinished _____ row.', options: ['A. draft'],
                correct_answer: 'A', submitted_answer: null, is_correct: null,
            },
            {
                id: 'review-ungraded', user_id: 'user-1', word_id: 'word-3', test_id: 'real-review-filter',
                assessment_kind: 'review', assessed_at: '2026-08-09T08:02:00.000Z', word_snapshot: 'review',
                question_type: '1', question_text: 'An unfinished review row.', options: ['A. review'],
                correct_answer: 'A', submitted_answer: 'A', is_correct: null,
            },
        ],
    });

    const history = await createSupabaseDataAdapter(client).getQuizHistory('qiuqiu', 'real');

    assert.deepEqual(history.map(group => group.testId), ['real-history-filter']);
    assert.equal(history[0].total, 1);
    assert.deepEqual(history[0].questions.map(row => row.assessmentId), ['assessment-graded']);
});

test('Supabase stats do not attach an unmatched null word_id assessment to a current meaning', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
        words: [{
            id: 'word-current', user_id: 'user-1', feishu_record_id: 'rec-current',
            word: 'bank', mastery_status: 'pending',
        }],
        assessments: [
            {
                id: 'legacy-1', user_id: 'user-1', word_id: null, source_word_record_id: 'rec-deleted',
                word_snapshot: 'bank', test_id: 'real-legacy-1', is_correct: 'correct', submitted_answer: 'A|sure',
            },
            {
                id: 'legacy-2', user_id: 'user-1', word_id: null, source_word_record_id: 'rec-deleted',
                word_snapshot: 'bank', test_id: 'real-legacy-2', is_correct: 'correct', submitted_answer: 'A|sure',
            },
        ],
    });

    const stats = await createSupabaseDataAdapter(client).getStats('qiuqiu');

    assert.equal(stats.masteredWords, 0);
    assert.equal(stats.unseenWords, 1);
});

test('Supabase history retains completed real review results instead of hiding them', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
        assessments: [{
            id: 'assessment-review', user_id: 'user-1', word_id: 'meaning-review',
            test_id: 'real-review-history', assessment_kind: 'review', assessed_at: '2026-08-09T09:00:00.000Z',
            word_snapshot: 'citizen', question_type: '1', question_text: 'A _____ has legal rights.',
            options: ['A. citizen', 'B. visitor', 'C. singer', 'D. teacher'],
            correct_answer: 'A', submitted_answer: 'A|sure', is_correct: 'correct',
        }],
    });

    const history = await createSupabaseDataAdapter(client).getQuizHistory('qiuqiu', 'real');
    assert.equal(history.length, 1);
    assert.equal(history[0].questions[0].word, 'citizen');
    assert.equal(history[0].questions[0].question, 'A _____ has legal rights.');
});

test('Supabase history preserves a legally scored legacy row even when its submitted answer is missing', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
        assessments: [{
            id: 'legacy-scored-no-answer', user_id: 'user-1', word_id: null,
            source_word_record_id: 'deleted-source', test_id: 'real-legacy-no-answer',
            assessed_at: '2026-08-09T11:00:00.000Z', word_snapshot: 'legacy', question_type: '1',
            question_text: 'Legacy _____ remains scored.', options: [],
            correct_answer: 'A', submitted_answer: null, is_correct: 'wrong',
        }],
    });

    const history = await createSupabaseDataAdapter(client).getQuizHistory('qiuqiu', 'real');

    assert.equal(history.length, 1);
    assert.equal(history[0].testId, 'real-legacy-no-answer');
    assert.equal(history[0].correct, 0);
    assert.equal(history[0].total, 1);
});

test('rebuildQuestionCacheForUser requeues a manual-review job before continuing repair', async () => {
    const word = rebuildCoverageWord('durable-manual-review', 'lucky');
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [word],
        assessments: [],
        question_cache: rebuildCoverageInvalidPair(word),
        question_generation_jobs: [{ id: 'job-manual', user_id: 'user-1', word_id: word.id, status: 'needs_manual_review' }],
    }, { rpcDataFalseAlways: true });

    await createRebuildCoverageAdapter(client, {
        generateDistractors: async () => null,
    }).rebuildQuestionCacheForUser('qiuqiu');

    assert.equal(client.db.question_generation_jobs[0].status, 'pending');
    assert.equal(client.db.question_generation_jobs[0].attempt_count, 0);
});

test('rebuildQuestionCacheForUser creates a pending job when conditional enqueue returns no row', async () => {
    const word = rebuildCoverageWord('durable-missing', 'lucky');
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [word],
        assessments: [],
        question_cache: rebuildCoverageInvalidPair(word),
        question_generation_jobs: [],
    }, { rpcDataFalseAlways: true });

    await createRebuildCoverageAdapter(client, {
        generateDistractors: async () => null,
    }).rebuildQuestionCacheForUser('qiuqiu');

    assert.equal(client.db.question_cache.every(row => row.cache_state === 'replace_pending'), true);
    assert.equal(client.db.question_generation_jobs[0].status, 'pending');
});

test('rebuildQuestionCacheForUser keeps a bad pair isolated when enqueue itself fails', async () => {
    const word = rebuildCoverageWord('durable-rpc-error', 'lucky');
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [word],
        assessments: [],
        question_cache: rebuildCoverageInvalidPair(word),
        question_generation_jobs: [],
    }, { failRpcName: 'enqueue_question_generation_job_if_needed' });

    await assert.rejects(
        createRebuildCoverageAdapter(client, {
            generateDistractors: async () => null,
        }).rebuildQuestionCacheForUser('qiuqiu'),
        /rebuildQuestionCache\.enqueueJob/
    );

    assert.equal(client.db.question_cache.every(row => row.cache_state === 'replace_pending'), true);
});

test('rebuildQuestionCacheForUser does not retire a review cache row for a rebuilt primary pair', async () => {
    const word = rebuildCoverageWord('primary-only-retirement', 'lucky');
    const oldPrimaryRows = rebuildCoverageInvalidPair(word);
    const reviewRow = {
        id: 'review-cache-row',
        user_id: 'user-1',
        word_id: word.id,
        source_word_record_id: word.feishu_record_id,
        level: MIDDLE,
        round_type: 'review',
        quality_status: 'ready',
        cache_state: 'active',
        question_type: '4',
        question_fingerprint: 'review-fingerprint',
        question_text: 'Review the meaning of lucky.',
        answer: word.meaning_zh,
        used_count: 3,
        last_used_at: '2026-08-01T00:00:00.000Z',
    };
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [word],
        assessments: [],
        question_cache: [...oldPrimaryRows, reviewRow],
    });

    await createRebuildCoverageAdapter(client).rebuildQuestionCacheForUser('qiuqiu');

    const finalReviewRow = client.db.question_cache.find(row => row.id === reviewRow.id);
    const reviewRetirement = client.operations
        .flatMap(operation => operation.payload || [])
        .find(row => row.id === reviewRow.id && row.cache_state === 'retired');
    assert.equal(finalReviewRow.cache_state, 'active');
    assert.equal(finalReviewRow.used_count, 3);
    assert.equal(finalReviewRow.last_used_at, reviewRow.last_used_at);
    assert.equal(reviewRetirement, undefined);
});


test('quiz session persistence isolates real and test sessions by requested mode', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
        quiz_sessions: [
            {
                test_id: 'test-newer', user_id: 'user-1', questions: [{ word: 'test' }],
                created_at: '2026-07-20T02:00:00.000Z', expires_at: '2026-07-21T00:00:00.000Z',
            },
            {
                test_id: 'legacy-real', user_id: 'user-1', questions: [{ word: 'real' }],
                created_at: '2026-07-20T01:00:00.000Z', expires_at: '2026-07-21T00:00:00.000Z',
            },
        ],
    });
    const adapter = createSupabaseDataAdapter(client);
    const now = { now: () => '2026-07-20T03:00:00.000Z' };

    assert.equal((await adapter.getActiveQuizSession('qiuqiu', 'real', now)).test_id, 'legacy-real');
    assert.equal((await adapter.getActiveQuizSession('qiuqiu', 'test', now)).test_id, 'test-newer');
});

test('active quiz session pushes mode filtering and row limit into Supabase', async () => {
    const newerTestSessions = Array.from({ length: 1001 }, (_, index) => ({
        test_id: 'test-' + index,
        user_id: 'user-1',
        questions: [{ word: 'test' }],
        created_at: new Date(Date.parse('2026-07-20T01:00:00.000Z') + index * 1000).toISOString(),
        expires_at: '2026-07-21T00:00:00.000Z',
    }));
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
        quiz_sessions: [
            { test_id: 'legacy-real', user_id: 'user-1', questions: [{ word: 'real' }], created_at: '2026-07-20T00:00:00.000Z', expires_at: '2026-07-21T00:00:00.000Z' },
            ...newerTestSessions,
        ],
    }, { maxSelectRows: 1000 });
    const adapter = createSupabaseDataAdapter(client);
    const now = { now: () => '2026-07-20T03:00:00.000Z' };

    const realSession = await adapter.getActiveQuizSession('qiuqiu', 'real', now);
    const testSession = await adapter.getActiveQuizSession('qiuqiu', 'test', now);

    assert.equal(realSession?.test_id, 'legacy-real');
    assert.equal(testSession?.test_id, 'test-1000');

    const sessionQueries = client.readOperations.filter(operation => operation.table === 'quiz_sessions');
    assert.equal(sessionQueries.length, 2);
    assert.deepEqual(sessionQueries[0].filters.at(-1),
        { type: 'not', column: 'test_id', operator: 'like', value: 'test-%' });
    assert.equal(sessionQueries[0].limitCount, 1);
    assert.deepEqual(sessionQueries[1].filters.at(-1),
        { type: 'like', column: 'test_id', value: 'test-%' });
    assert.equal(sessionQueries[1].limitCount, 1);
});

test('quiz session persistence rejects legacy real sessions that cannot be formally resumed', async () => {
    const client = seededClient();
    const adapter = createSupabaseDataAdapter(client);
    const incompleteQuestions = [{ type: 1, record_id: 'meaning-1', cacheRecordId: 'cache-1', source: 'question_cache' }];

    await assert.rejects(
        adapter.saveQuizSession('qiuqiu', 'legacy-real', incompleteQuestions),
        /FORMAL_QUIZ_INCOMPLETE/
    );
    client.db.quiz_sessions.push({
        test_id: 'legacy-real', user_id: 'user-1', questions: incompleteQuestions,
        created_at: '2026-07-20T00:00:00.000Z', expires_at: '2026-07-21T00:00:00.000Z',
    });
    await assert.rejects(
        adapter.updateQuizSessionProgress('qiuqiu', 'legacy-real', { currentQuestion: 1, answers: [0] }),
        /FORMAL_QUIZ_INCOMPLETE/
    );
});
test('formal challenge adapter creates the authoritative Supabase challenge through the canonical RPC', async () => {
    const baseClient = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
    });
    const calls = [];
    const client = {
        ...baseClient,
        rpc: async (name, args) => {
            calls.push({ name, args });
            return { data: { challenge_id: 'challenge-1', question_count: 10 }, error: null };
        },
    };
    const adapter = createSupabaseDataAdapter(client);
    const questions = Array.from({ length: 10 }, (_, index) => ({
        meaningId: `meaning-${index + 1}`,
        cacheRecordId: `cache-${index + 1}`,
        context: `Sentence ${index + 1} with _____.`,
        questionFingerprint: `fingerprint-${index + 1}`,
        type: 1,
        word: 'bank',
        source: 'question_cache',
        options: ['A. bank', 'B. river', 'C. road', 'D. desk'],
        answer: 'A',
        contextCN: '\u8fd9\u662f\u4e00\u4e2a\u5b8c\u6574\u7684\u4e2d\u6587\u53e5\u5b50\u3002',
        optionMeanings: ['\u91ca\u4e49', '\u6cb3\u6d41', '\u9053\u8def', '\u684c\u5b50'],
    }));

    const result = await adapter.createFormalQuizChallenge({
        username: 'qiuqiu',
        testId: 'real-challenge-1',
        level: MIDDLE,
        questions,
        now: '2026-08-07T00:00:00.000Z',
    });

    assert.deepEqual(result, { challenge_id: 'challenge-1', question_count: 10 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'create_formal_quiz_challenge');
    assert.equal(calls[0].args.p_user_id, 'user-1');
    assert.equal(calls[0].args.p_test_id, 'real-challenge-1');
    assert.equal(calls[0].args.p_level, MIDDLE);
    assert.equal(calls[0].args.p_now, '2026-08-07T00:00:00.000Z');
    assert.deepEqual(calls[0].args.p_questions, questions.map(question => ({
        meaning_id: question.meaningId,
        cache_question_id: question.cacheRecordId,
        stem: question.context,
        question_fingerprint: question.questionFingerprint,
        question_snapshot: question,
    })));
});

test('formal challenge adapter refuses to persist a cache question without four renderable options', async () => {
    const baseClient = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
    });
    const calls = [];
    const adapter = createSupabaseDataAdapter({
        ...baseClient,
        rpc: async (name, args) => {
            calls.push({ name, args });
            return { data: { challenge_id: 'challenge-1', question_count: 10 }, error: null };
        },
    });
    const questions = Array.from({ length: 10 }, (_, index) => ({
        meaningId: `meaning-${index + 1}`,
        cacheRecordId: `cache-${index + 1}`,
        context: `Sentence ${index + 1} with _____.`,
        type: 1,
        word: `word-${index + 1}`,
        source: 'question_cache',
        options: ['A. answer', 'B. option', 'C. choice', 'D. other'],
        answer: 'A',
        contextCN: '\u8fd9\u662f\u4e00\u4e2a\u5b8c\u6574\u7684\u4e2d\u6587\u53e5\u5b50\u3002',
        optionMeanings: ['\u91ca\u4e49', '\u9009\u9879', '\u9009\u62e9', '\u5176\u4ed6'],
    }));
    delete questions[4].options;

    await assert.rejects(
        adapter.createFormalQuizChallenge({
            username: 'qiuqiu', testId: 'real-challenge-invalid-options', level: MIDDLE, questions,
        }),
        /FORMAL_QUIZ_RENDERABLE_REQUIRED/
    );
    assert.equal(calls.length, 0);
});

test('formal challenge second gate rejects duplicate option meanings', async () => {
    const baseClient = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
    });
    const calls = [];
    const adapter = createSupabaseDataAdapter({
        ...baseClient,
        rpc: async (name, args) => {
            calls.push({ name, args });
            return { data: { challenge_id: 'challenge-1', question_count: 10 }, error: null };
        },
    });
    const questions = Array.from({ length: 10 }, (_, index) => ({
        meaningId: `meaning-${index + 1}`,
        cacheRecordId: `cache-${index + 1}`,
        context: `Sentence ${index + 1} with _____.`,
        contextCN: '\u8fd9\u662f\u4e00\u4e2a\u5b8c\u6574\u7684\u4e2d\u6587\u53e5\u5b50\u3002',
        questionFingerprint: `fingerprint-${index + 1}`,
        type: 1,
        word: 'bank',
        source: 'question_cache',
        options: ['A. bank', 'B. river', 'C. road', 'D. desk'],
        optionMeanings: ['\u91ca\u4e49', '\u91ca\u4e49', '\u9053\u8def', '\u684c\u5b50'],
        answer: 'A',
    }));
    await assert.rejects(
        adapter.createFormalQuizChallenge({ username: 'qiuqiu', testId: 'real-duplicate-options', level: MIDDLE, questions }),
        /FORMAL_QUIZ_QUALITY_REQUIRED/
    );
    assert.equal(calls.length, 0);
});

test('formal challenge adapter reads authoritative questions and updates challenge progress', async () => {
    const baseClient = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
        quiz_challenges: [{
            id: 'challenge-1', test_id: 'real-challenge-1', user_id: 'user-1',
            mode: 'real', level: MIDDLE, status: 'active',
            session_state: { currentQuestion: 2, answers: [{ option: 0 }] },
        }],
        quiz_challenge_questions: [{
            id: 'challenge-question-1', challenge_id: 'challenge-1', ordinal: 1,
            meaning_id: 'meaning-1', cache_question_id: 'cache-1',
            stem: 'Sentence with _____.', question_snapshot: {
                word: 'bank', context: 'Sentence with _____.', answer: 'A',
                source: 'question_cache', cacheRecordId: 'cache-1', meaningId: 'meaning-1', type: 1,
            },
        }],
        question_cache: [{
            id: 'cache-1', question_type: '1', question_text: 'Sentence with _____.',
            options: ['A. bank', 'B. river', 'C. road', 'D. desk'], answer: 'A',
        }],
    });
    const adapter = createSupabaseDataAdapter(baseClient);

    const challenge = await adapter.getFormalQuizChallenge('qiuqiu', 'real-challenge-1');
    assert.equal(challenge.test_id, 'real-challenge-1');
    assert.equal(challenge.challenge_id, 'challenge-1');
    assert.deepEqual(challenge.questions, [{
        id: 'challenge-question-1', ordinal: 1, meaningId: 'meaning-1',
        cacheRecordId: 'cache-1', stem: 'Sentence with _____.',
        ...baseClient.db.quiz_challenge_questions[0].question_snapshot,
        options: ['A. bank', 'B. river', 'C. road', 'D. desk'],
    }]);

    const progress = await adapter.updateFormalQuizChallengeProgress('qiuqiu', 'real-challenge-1', {
        currentQuestion: 3, answers: [{ option: 0 }, { option: 1 }],
    });
    assert.equal(progress.session_state.currentQuestion, 3);
    assert.deepEqual(baseClient.db.quiz_challenges[0].session_state, progress.session_state);
});

test('formal challenge adapter can read the active challenge through the default adapter method', async () => {
    const baseClient = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
        quiz_challenges: [{
            id: 'challenge-1', test_id: 'real-challenge-1', user_id: 'user-1',
            mode: 'real', level: MIDDLE, status: 'active',
            created_at: '2026-08-08T00:00:00.000Z', expires_at: '2026-08-09T00:00:00.000Z',
            session_state: { currentQuestion: 0, answers: [] },
        }],
        quiz_challenge_questions: [{
            id: 'challenge-question-1', challenge_id: 'challenge-1', ordinal: 1,
            meaning_id: 'meaning-1', cache_question_id: 'cache-1',
            stem: 'Sentence with _____.', question_snapshot: {
                word: 'bank', context: 'Sentence with _____.', answer: 'A',
                source: 'question_cache', cacheRecordId: 'cache-1', meaningId: 'meaning-1', type: 1,
            },
        }],
        question_cache: [{
            id: 'cache-1', question_type: '1', question_text: 'Sentence with _____.',
            options: ['A. bank', 'B. river', 'C. road', 'D. desk'], answer: 'A',
        }],
    });
    const adapter = createSupabaseDataAdapter(baseClient);

    const challenge = await adapter.getActiveFormalQuizChallenge('qiuqiu', {
        now: () => '2026-08-08T01:00:00.000Z',
    });

    assert.equal(challenge.test_id, 'real-challenge-1');
    assert.equal(challenge.challenge_id, 'challenge-1');
});

test('formal challenge adapter invalidates a bad displayed question through the canonical RPC', async () => {
    const baseClient = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
    });
    const calls = [];
    const client = {
        ...baseClient,
        rpc: async (name, args) => {
            calls.push({ name, args });
            return { data: { invalidated: true, replacement_required: true }, error: null };
        },
    };
    const adapter = createSupabaseDataAdapter(client);

    const result = await adapter.invalidateFormalQuizQuestion({
        username: 'qiuqiu',
        testId: 'real-challenge-1',
        challengeQuestionId: 'challenge-question-1',
        reason: 'NO_VALID_ANSWER',
    });

    assert.deepEqual(result, { invalidated: true, replacement_required: true });
    assert.deepEqual(calls, [{
        name: 'invalidate_formal_quiz_question',
        args: {
            p_user_id: 'user-1',
            p_test_id: 'real-challenge-1',
            p_challenge_question_id: 'challenge-question-1',
            p_reason: 'NO_VALID_ANSWER',
        },
    }]);
});

test('formal challenge adapter replaces an invalidated question through the canonical RPC', async () => {
    const baseClient = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
    });
    const calls = [];
    const client = {
        ...baseClient,
        rpc: async (name, args) => {
            calls.push({ name, args });
            return { data: { replaced: true, cache_question_id: 'cache-question-2' }, error: null };
        },
    };
    const adapter = createSupabaseDataAdapter(client);

    const snapshot = { word: 'bank', answer: 'A', options: ['A', 'B', 'C', 'D'] };
    const result = await adapter.replaceFormalQuizQuestion({
        username: 'qiuqiu',
        testId: 'real-challenge-1',
        challengeQuestionId: 'challenge-question-1',
        cacheQuestionId: 'cache-question-2',
        stem: 'The children sat on the _____.',
        questionFingerprint: 'fingerprint-2',
        questionSnapshot: snapshot,
    });

    assert.deepEqual(result, { replaced: true, cache_question_id: 'cache-question-2' });
    assert.deepEqual(calls[0], {
        name: 'replace_formal_quiz_question',
        args: {
            p_user_id: 'user-1',
            p_test_id: 'real-challenge-1',
            p_challenge_question_id: 'challenge-question-1',
            p_cache_question_id: 'cache-question-2',
            p_stem: 'The children sat on the _____.',
            p_question_fingerprint: 'fingerprint-2',
            p_question_snapshot: snapshot,
        },
    });
});
