const test = require('node:test');
const assert = require('node:assert/strict');

const {
    summarizeQuestionGenerationQueue,
    summarizeUserQuestionReadiness,
} = require('../question-generation-observability');

const NOW = '2026-08-30T12:00:00.000Z';

test('queue summary separates pending, running, retrying, and failed jobs without exposing error detail', () => {
    const summary = summarizeQuestionGenerationQueue([
        { status: 'pending', created_at: '2026-08-30T11:20:00.000Z' },
        { status: 'generating', created_at: '2026-08-30T11:55:00.000Z' },
        { status: 'retry_wait', created_at: '2026-08-30T11:40:00.000Z', last_error_code: 'TRANSIENT_PROVIDER_FAILURE' },
        { status: 'needs_manual_review', created_at: '2026-08-30T11:30:00.000Z', last_error_code: 'provider said key=secret-value' },
    ], { now: NOW });

    assert.deepEqual(summary.counts, { pending: 1, running: 1, retrying: 1, failed: 1 });
    assert.equal(summary.oldestPendingAgeMs, 40 * 60_000);
    assert.equal(summary.lastErrorCode, 'QUESTION_GENERATION_FAILED');
    assert.equal(summary.alerts.oldestPendingOverThreshold, true);
    assert.doesNotMatch(JSON.stringify(summary), /secret-value/);
});

test('user readiness reports a formal quiz only when ten eligible questions are ready', () => {
    const readiness = summarizeUserQuestionReadiness({
        readyCount: 9,
        jobs: [
            { status: 'pending', created_at: '2026-08-30T11:20:00.000Z' },
            { status: 'retry_wait', created_at: '2026-08-30T11:40:00.000Z' },
        ],
        now: NOW,
    });

    assert.equal(readiness.canStartFormalQuiz, false);
    assert.equal(readiness.status, 'waiting_retry');
    assert.deepEqual(readiness.alerts, {
        belowReadyThreshold: true,
        oldestPendingOverThreshold: true,
    });
    assert.deepEqual(readiness.queue, {
        pendingCount: 1,
        runningCount: 0,
        retryingCount: 1,
        failedCount: 0,
        oldestPendingAgeMs: 40 * 60_000,
        lastErrorCode: null,
    });

    const ready = summarizeUserQuestionReadiness({ readyCount: 10, jobs: [], now: NOW });
    assert.equal(ready.canStartFormalQuiz, true);
    assert.equal(ready.status, 'ready');
});

test('user readiness marks a failed queue as needing attention without returning an unsafe code', () => {
    const readiness = summarizeUserQuestionReadiness({
        readyCount: 0,
        jobs: [{
            status: 'needs_manual_review',
            created_at: '2026-08-30T11:20:00.000Z',
            last_error_code: 'SERVICE_ROLE_KEY=not-for-client',
        }],
        now: NOW,
    });

    assert.equal(readiness.canStartFormalQuiz, false);
    assert.equal(readiness.status, 'needs_attention');
    assert.equal(readiness.queue.lastErrorCode, 'QUESTION_GENERATION_FAILED');
    assert.doesNotMatch(JSON.stringify(readiness), /not-for-client/);
});
