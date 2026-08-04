'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    JOB_STATUS,
    enqueueQuestionGeneration,
    claimQuestionGenerationJobs,
    completeQuestionGeneration,
    failQuestionGeneration,
    createQuestionGenerationJobStore,
} = require('../question-generation-job');

const NOW = '2026-08-03T12:00:00.000Z';

function job(overrides = {}) {
    return {
        id: 'job-1',
        user_id: 'user-1',
        word_id: 'word-1',
        status: JOB_STATUS.PENDING,
        reason: 'word_entry',
        attempt_count: 0,
        next_attempt_at: NOW,
        lease_owner: null,
        lease_expires_at: null,
        last_error_code: null,
        last_error_detail: null,
        rejection_reasons: {},
        created_at: NOW,
        updated_at: NOW,
        ...overrides,
    };
}

test('enqueue is idempotent for an existing word meaning and does not reset its state', () => {
    const existing = job({ status: JOB_STATUS.READY, attempt_count: 2 });

    const result = enqueueQuestionGeneration(existing, {
        userId: 'user-1',
        wordId: 'word-1',
        reason: 'duplicate_entry',
        now: new Date('2026-08-04T12:00:00.000Z'),
    });

    assert.strictEqual(result, existing);
    assert.equal(result.status, JOB_STATUS.READY);
    assert.equal(result.attempt_count, 2);
});

test('claim takes only due jobs up to the limit and assigns a lease', () => {
    const jobs = [
        job({ id: 'due-pending', word_id: 'word-1' }),
        job({ id: 'future-retry', word_id: 'word-2', status: JOB_STATUS.RETRY_WAIT, next_attempt_at: '2026-08-03T12:00:01.000Z' }),
        job({ id: 'due-retry', word_id: 'word-3', status: JOB_STATUS.RETRY_WAIT, next_attempt_at: '2026-08-03T11:59:59.000Z', attempt_count: 1 }),
        job({ id: 'second-due', word_id: 'word-4' }),
    ];

    const claimed = claimQuestionGenerationJobs(jobs, {
        workerId: 'worker-a',
        limit: 2,
        now: new Date(NOW),
        leaseDurationMs: 30_000,
    });

    assert.deepEqual(claimed.map(row => row.id), ['due-pending', 'due-retry']);
    assert.deepEqual(claimed.map(row => row.attempt_count), [1, 2]);
    assert.ok(claimed.every(row => row.status === JOB_STATUS.GENERATING));
    assert.ok(claimed.every(row => row.lease_owner === 'worker-a'));
    assert.ok(claimed.every(row => row.lease_expires_at === '2026-08-03T12:00:30.000Z'));
});

test('claim recovers an in-progress job after its lease expires', () => {
    const expired = job({
        status: JOB_STATUS.GENERATING,
        attempt_count: 1,
        lease_owner: 'dead-worker',
        lease_expires_at: '2026-08-03T11:59:59.000Z',
    });

    const [recovered] = claimQuestionGenerationJobs([expired], {
        workerId: 'worker-b',
        now: new Date(NOW),
        leaseDurationMs: 60_000,
    });

    assert.equal(recovered.lease_owner, 'worker-b');
    assert.equal(recovered.attempt_count, 2);
    assert.equal(recovered.lease_expires_at, '2026-08-03T12:01:00.000Z');
});

test('complete marks the owned job ready and clears its lease', () => {
    const completed = completeQuestionGeneration(job({
        status: JOB_STATUS.GENERATING,
        attempt_count: 1,
        lease_owner: 'worker-a',
        lease_expires_at: '2026-08-03T12:01:00.000Z',
    }), {
        workerId: 'worker-a',
        now: new Date(NOW),
    });

    assert.equal(completed.status, JOB_STATUS.READY);
    assert.equal(completed.lease_owner, null);
    assert.equal(completed.lease_expires_at, null);
    assert.equal(completed.last_error_code, null);
    assert.equal(completed.last_error_detail, null);
});

test('fail schedules exponential backoff and persists diagnostics', () => {
    const failed = failQuestionGeneration(job({
        status: JOB_STATUS.GENERATING,
        attempt_count: 2,
        lease_owner: 'worker-a',
    }), Object.assign(new Error('quality gate rejected candidates'), {
        code: 'INSUFFICIENT_VARIANTS',
        rejectionReasons: { duplicate_fingerprint: 3 },
    }), {
        workerId: 'worker-a',
        now: new Date(NOW),
        baseBackoffMs: 1_000,
        maxBackoffMs: 60_000,
        maxAttempts: 4,
    });

    assert.equal(failed.status, JOB_STATUS.RETRY_WAIT);
    assert.equal(failed.next_attempt_at, '2026-08-03T12:00:02.000Z');
    assert.equal(failed.lease_owner, null);
    assert.equal(failed.last_error_code, 'INSUFFICIENT_VARIANTS');
    assert.equal(failed.last_error_detail, 'quality gate rejected candidates');
    assert.deepEqual(failed.rejection_reasons, { duplicate_fingerprint: 3 });
});

test('fail moves the job to manual review at the maximum attempt count', () => {
    const failed = failQuestionGeneration(job({
        status: JOB_STATUS.GENERATING,
        attempt_count: 4,
        lease_owner: 'worker-a',
    }), new Error('still invalid'), {
        workerId: 'worker-a',
        now: new Date(NOW),
        maxAttempts: 4,
    });

    assert.equal(failed.status, JOB_STATUS.NEEDS_MANUAL_REVIEW);
    assert.equal(failed.lease_owner, null);
    assert.equal(failed.next_attempt_at, NOW);
});

test('state transitions reject a stale lease owner', () => {
    const claimed = job({ status: JOB_STATUS.GENERATING, lease_owner: 'worker-a' });

    assert.throws(
        () => completeQuestionGeneration(claimed, { workerId: 'worker-b', now: new Date(NOW) }),
        /JOB_LEASE_NOT_OWNED/
    );
    assert.throws(
        () => failQuestionGeneration(claimed, new Error('x'), { workerId: 'worker-b', now: new Date(NOW) }),
        /JOB_LEASE_NOT_OWNED/
    );
});

test('store delegates atomic claim and conditional transitions through injected adapters', async () => {
    const calls = [];
    const claimed = job({ status: JOB_STATUS.GENERATING, attempt_count: 1, lease_owner: 'worker-a' });
    const store = createQuestionGenerationJobStore({
        upsert: async (row, options) => {
            calls.push(['upsert', row, options]);
            return row;
        },
        claimDue: async request => {
            calls.push(['claimDue', request]);
            return [claimed];
        },
        updateClaimed: async request => {
            calls.push(['updateClaimed', request]);
            return request.row;
        },
        now: () => new Date(NOW),
        leaseDurationMs: 30_000,
    });

    await store.enqueue({ userId: 'user-1', wordId: 'word-1' });
    const rows = await store.claim({ workerId: 'worker-a', limit: 3 });
    await store.complete(rows[0], { workerId: 'worker-a' });

    assert.equal(calls[0][0], 'upsert');
    assert.deepEqual(calls[0][2], { onConflict: 'word_id', ignoreDuplicates: true });
    assert.equal(calls[1][0], 'claimDue');
    assert.equal(calls[1][1].limit, 3);
    assert.equal(calls[1][1].leaseExpiresAt, '2026-08-03T12:00:30.000Z');
    assert.deepEqual(calls[1][1].recoverableStatuses, [JOB_STATUS.GENERATING, JOB_STATUS.VALIDATING, JOB_STATUS.REPAIRING]);
    assert.equal(calls[1][1].claimedStatus, JOB_STATUS.GENERATING);
    assert.equal(calls[1][1].incrementAttemptCount, true);
    assert.equal(calls[2][0], 'updateClaimed');
    assert.equal(calls[2][1].workerId, 'worker-a');
    assert.equal(calls[2][1].row.status, JOB_STATUS.READY);
});

