'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    HIGH_ATTEMPT_THRESHOLD,
    auditQuestionGenerationBacklog,
} = require('../question-generation-backlog-audit');
const {
    collectQuestionGenerationBacklogAudit,
    formatAuditError,
} = require('../scripts/audit-question-generation-backlog');

function createReadOnlyClient(tableRows) {
    const calls = [];
    const forbidden = operation => {
        throw new Error(`WRITE_OR_RPC_FORBIDDEN:${operation}`);
    };
    const client = {
        from(table) {
            return {
                select(columns) {
                    calls.push({ operation: 'select', table, columns });
                    let afterId = null;
                    const query = {
                        order(column, options) {
                            calls.push({ operation: 'order', table, column, options });
                            return query;
                        },
                        gt(column, value) {
                            calls.push({ operation: 'gt', table, column, value });
                            afterId = value;
                            return query;
                        },
                        async limit(limit) {
                            calls.push({ operation: 'limit', table, limit });
                            const ordered = [...(tableRows[table] || [])]
                                .sort((left, right) => String(left.id).localeCompare(String(right.id)));
                            const filtered = afterId === null
                                ? ordered
                                : ordered.filter(row => String(row.id).localeCompare(String(afterId)) > 0);
                            return { data: filtered.slice(0, limit), error: null };
                        },
                    };
                    return query;
                },
                update: () => forbidden('update'),
                delete: () => forbidden('delete'),
                upsert: () => forbidden('upsert'),
                insert: () => forbidden('insert'),
            };
        },
        rpc: () => forbidden('rpc'),
    };
    return { client, calls };
}

test('reports future pending fences and expired processing leases using the injected clock', () => {
    const now = new Date('2026-08-14T12:00:00.000Z');
    const report = auditQuestionGenerationBacklog({
        users: [{ id: 'user-1', username: 'yusi' }],
        words: [word('future'), word('fenced'), word('expired-a'), word('expired-b'), word('expired-c')],
        cacheRows: [],
        jobs: [
            job('future', 'future', 'pending', { next_attempt_at: '2026-08-14T12:05:00.000Z' }),
            job('fenced', 'fenced', 'pending', { next_attempt_at: '9999-12-31T23:59:59.999Z' }),
            job('generating', 'expired-a', 'generating', { lease_expires_at: '2026-08-14T11:59:59.000Z' }),
            job('validating', 'expired-b', 'validating', { lease_expires_at: null }),
            job('repairing', 'expired-c', 'repairing', { lease_expires_at: '2026-08-14T12:00:00.000Z' }),
        ],
    }, { now });

    assert.deepEqual(report.summary.claimBlockers, {
        futurePending: 2,
        fenceStuck: 1,
        expiredProcessingLease: 3,
    });
    assert.deepEqual(report.items.claimBlockers.map(item => [item.jobId, item.flags]), [
        ['fenced', ['future_pending', 'fence_stuck']],
        ['future', ['future_pending']],
        ['generating', ['expired_processing_lease']],
        ['repairing', ['expired_processing_lease']],
        ['validating', ['expired_processing_lease']],
    ]);
    assert.doesNotMatch(JSON.stringify(report), /next_attempt_at|lease_expires_at|9999|2026-08-14/i);
});

function word(id, overrides = {}) {
    return {
        id,
        user_id: 'user-1',
        word: `word-${id}`,
        mastery_status: 'pending',
        question_generation_version: 2,
        ...overrides,
    };
}

function cache(id, wordId, cacheState, overrides = {}) {
    return {
        id,
        user_id: 'user-1',
        word_id: wordId,
        round_type: 'primary',
        quality_status: 'ready',
        cache_state: cacheState,
        question_type: '1',
        variant_slot: cacheState === 'active' ? 1 : 2,
        ...overrides,
    };
}

function job(id, wordId, status, overrides = {}) {
    return {
        id,
        user_id: 'user-1',
        word_id: wordId,
        word_version: 2,
        status,
        reason: 'cache_backfill',
        attempt_count: 0,
        next_attempt_at: '2026-08-14T00:00:00.000Z',
        last_error_code: null,
        rejection_reasons: {},
        ...overrides,
    };
}

test('classifies unclaimable pending jobs, stale mastered caches, incomplete ready jobs, and coverage gaps', () => {
    assert.equal(HIGH_ATTEMPT_THRESHOLD, 10);
    const report = auditQuestionGenerationBacklog({
        users: [
            { id: 'user-1', username: 'yusi' },
            { id: 'user-2', username: 'qiuqiu' },
        ],
        words: [
            word('complete'),
            word('mastered', { mastery_status: 'mastered' }),
            word('version-mismatch'),
            word('invalid', { word: 'bad_word' }),
            word('missing-reserved'),
            word('duplicate-active'),
            word('ready-mismatch'),
            word('other-user', { user_id: 'user-2', word: 'apple' }),
        ],
        cacheRows: [
            cache('complete-a', 'complete', 'active'),
            cache('complete-r', 'complete', 'reserved_next_day'),
            cache('mastered-a', 'mastered', 'active'),
            cache('mastered-r', 'mastered', 'reserved_next_day'),
            cache('missing-a', 'missing-reserved', 'active'),
            cache('duplicate-a1', 'duplicate-active', 'active'),
            cache('duplicate-a2', 'duplicate-active', 'active'),
            cache('duplicate-r', 'duplicate-active', 'reserved_next_day'),
            cache('ignored-review', 'ready-mismatch', 'active', { round_type: 'review' }),
            cache('ignored-rejected', 'ready-mismatch', 'reserved_next_day', { quality_status: 'rejected' }),
            cache('other-a', 'other-user', 'active', { user_id: 'user-2' }),
            cache('other-r', 'other-user', 'reserved_next_day', { user_id: 'user-2' }),
        ],
        jobs: [
            job('pending-mastered', 'mastered', 'pending'),
            job('pending-version', 'version-mismatch', 'pending', { word_version: 1 }),
            job('pending-invalid', 'invalid', 'pending'),
            job('ready-incomplete', 'ready-mismatch', 'ready'),
            job('retry-high', 'missing-reserved', 'retry_wait', {
                attempt_count: 12,
                reason: 'quality_gate_rebuild',
                last_error_code: 'INSUFFICIENT_VARIANTS',
            }),
            job('manual', 'duplicate-active', 'needs_manual_review', {
                attempt_count: 20,
                last_error_code: 'INSUFFICIENT_DISTINCT_READY_VARIANTS',
            }),
        ],
    });

    assert.deepEqual(report.summary.scanned, { users: 2, words: 8, cacheRows: 12, jobs: 6 });
    assert.deepEqual(report.summary.unclaimablePending, {
        count: 3,
        byReason: { mastered: 1, version_mismatch: 1, invalid_word: 1 },
    });
    assert.equal(report.summary.masteredAvailableCache, 2);
    assert.equal(report.summary.readyJobIncompleteCache, 1);
    assert.deepEqual(report.summary.coverage, {
        eligibleWords: 6,
        completeWords: 2,
        gapCount: 4,
    });
    assert.deepEqual(report.summary.jobAttention, {
        retryWait: 1,
        needsManualReview: 1,
        highAttempts: 2,
        highAttemptThreshold: 10,
        byReason: { cache_backfill: 1, quality_gate_rebuild: 1 },
        byErrorCode: {
            INSUFFICIENT_DISTINCT_READY_VARIANTS: 1,
            INSUFFICIENT_VARIANTS: 1,
        },
    });
    assert.deepEqual(report.byUser.yusi, {
        unclaimablePending: 3,
        masteredAvailableCache: 2,
        readyJobIncompleteCache: 1,
        eligibleWords: 5,
        completeWords: 1,
        coverageGaps: 4,
        retryWait: 1,
        needsManualReview: 1,
        highAttempts: 2,
    });
    assert.deepEqual(report.byUser.qiuqiu, {
        unclaimablePending: 0,
        masteredAvailableCache: 0,
        readyJobIncompleteCache: 0,
        eligibleWords: 1,
        completeWords: 1,
        coverageGaps: 0,
        retryWait: 0,
        needsManualReview: 0,
        highAttempts: 0,
    });
    assert.deepEqual(report.items.unclaimablePending.map(item => [item.jobId, item.wordId, item.reasons]), [
        ['pending-invalid', 'invalid', ['invalid_word']],
        ['pending-mastered', 'mastered', ['mastered']],
        ['pending-version', 'version-mismatch', ['version_mismatch']],
    ]);
    assert.deepEqual(report.items.masteredAvailableCache.map(item => [item.cacheId, item.wordId, item.reason]), [
        ['mastered-a', 'mastered', 'mastered_word'],
        ['mastered-r', 'mastered', 'mastered_word'],
    ]);
    assert.deepEqual(report.items.readyJobIncompleteCache, [{
        user: 'yusi', userId: 'user-1', jobId: 'ready-incomplete', wordId: 'ready-mismatch',
        reasons: ['missing_active', 'missing_reserved_next_day'], cacheIds: [],
    }]);
    assert.deepEqual(report.items.coverageGaps.map(item => [item.wordId, item.reasons]), [
        ['duplicate-active', ['duplicate_active']],
        ['missing-reserved', ['missing_reserved_next_day']],
        ['ready-mismatch', ['missing_active', 'missing_reserved_next_day']],
        ['version-mismatch', ['missing_active', 'missing_reserved_next_day']],
    ]);
    assert.deepEqual(report.items.jobAttention.map(item => [item.jobId, item.status, item.attemptCount, item.flags]), [
        ['manual', 'needs_manual_review', 20, ['needs_manual_review', 'high_attempts']],
        ['retry-high', 'retry_wait', 12, ['retry_wait', 'high_attempts']],
    ]);

    const serialized = JSON.stringify(report);
    assert.doesNotMatch(serialized, /question_text|options|answer|secret|service[_-]?role|https?:\/\//i);
});

test('reports orphan pending jobs without exposing row contents', () => {
    const report = auditQuestionGenerationBacklog({
        users: [{ id: 'user-1', username: 'yusi' }],
        words: [], cacheRows: [],
        jobs: [job('orphan', 'missing-word', 'pending')],
    });
    assert.deepEqual(report.items.unclaimablePending, [{
        user: 'yusi', userId: 'user-1', jobId: 'orphan', wordId: 'missing-word', reasons: ['missing_word'],
    }]);
});

test('redacts unsafe job reason and error-code strings from the report', () => {
    const report = auditQuestionGenerationBacklog({
        users: [{ id: 'user-1', username: 'yusi' }],
        words: [word('attention')], cacheRows: [],
        jobs: [job('unsafe', 'attention', 'retry_wait', {
            reason: 'https://secret.supabase.co?service_role=abc',
            last_error_code: 'service_role=secret-value',
        })],
    });
    assert.equal(report.items.jobAttention[0].reason, 'redacted');
    assert.equal(report.items.jobAttention[0].errorCode, 'redacted');
    assert.deepEqual(report.summary.jobAttention.byReason, { redacted: 1 });
    assert.deepEqual(report.summary.jobAttention.byErrorCode, { redacted: 1 });
    assert.doesNotMatch(JSON.stringify(report), /secret|service[_-]?role|https?:\/\//i);
});

test('collector uses stable id keyset pages and never exposes write methods or rpc', async () => {
    const filler = Array.from({ length: 999 }, (_, index) => word(`filler-${index}`, {
        word: 'apple', mastery_status: 'mastered',
    }));
    const { client, calls } = createReadOnlyClient({
        users: [{ id: 'user-1', username: 'yusi' }],
        words: [...filler, word('complete'), word('second-page', { word: 'pear' })],
        question_cache: [
            cache('complete-a', 'complete', 'active'),
            cache('complete-r', 'complete', 'reserved_next_day'),
        ],
        question_generation_jobs: [job('pending-second', 'second-page', 'pending')],
    });

    const report = await collectQuestionGenerationBacklogAudit(client);

    assert.equal(report.summary.scanned.words, 1001);
    assert.ok(calls.every(call => ['select', 'order', 'gt', 'limit'].includes(call.operation)));
    assert.deepEqual(
        calls.filter(call => call.operation === 'gt' && call.table === 'words').map(call => [call.column, call.value]),
        [['id', 'filler-998']],
    );
    assert.ok(calls.filter(call => call.operation === 'order').every(call => call.column === 'id'));
    assert.ok(calls.filter(call => call.operation === 'limit').every(call => call.limit === 1000));
    assert.deepEqual(new Set(calls.filter(call => call.operation === 'select').map(call => call.table)), new Set([
        'users', 'words', 'question_cache', 'question_generation_jobs',
    ]));
    const selects = Object.fromEntries(calls.filter(call => call.operation === 'select').map(call => [call.table, call.columns]));
    assert.match(selects.words, /question_generation_version/);
    assert.match(selects.question_generation_jobs, /word_version/);
    assert.match(selects.question_generation_jobs, /lease_expires_at/);
    assert.doesNotMatch(selects.question_cache, /question_text|options|answer/);
});

test('collector errors are credential-safe', async () => {
    const client = {
        from() {
            return {
                select() {
                    const query = {
                        order() { return query; },
                        gt() { return query; },
                        async limit() { return { data: null, error: new Error('https://secret.supabase.co service_role=abc') }; },
                    };
                    return query;
                },
            };
        },
    };
    await assert.rejects(collectQuestionGenerationBacklogAudit(client), /QUESTION_GENERATION_BACKLOG_AUDIT_FAILED/);
    assert.equal(formatAuditError(new Error('SUPABASE_READ_CREDENTIALS_REQUIRED')), 'SUPABASE_READ_CREDENTIALS_REQUIRED');
    assert.equal(formatAuditError(new Error('https://secret.supabase.co service_role=abc')), 'QUESTION_GENERATION_BACKLOG_AUDIT_FAILED');
});
