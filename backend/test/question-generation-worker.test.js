'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    runQuestionGenerationBatch,
    createQuestionGenerationWorker,
} = require('../question-generation-worker');

function claimedJob(id) {
    return {
        id,
        user_id: 'user-1',
        word_id: `word-${id}`,
        status: 'generating',
        attempt_count: 1,
        lease_owner: 'worker-a',
    };
}

test('batch claims at most its limit, processes each job, and completes successes', async () => {
    const completed = [];
    const processed = [];
    const jobs = [claimedJob('1'), claimedJob('2')];
    const jobStore = {
        claim: async request => {
            assert.deepEqual(request, { workerId: 'worker-a', limit: 2 });
            return jobs;
        },
        complete: async (job, request) => completed.push([job.id, request]),
        fail: async () => assert.fail('successful jobs must not fail'),
    };
    const generationService = {
        process: async job => {
            processed.push(job.id);
            return { readyCount: 2 };
        },
    };

    const summary = await runQuestionGenerationBatch({
        jobStore,
        generationService,
        workerId: 'worker-a',
        limit: 2,
    });

    assert.deepEqual(processed, ['1', '2']);
    assert.deepEqual(completed, [
        ['1', { workerId: 'worker-a', result: { readyCount: 2 } }],
        ['2', { workerId: 'worker-a', result: { readyCount: 2 } }],
    ]);
    assert.deepEqual(summary, { claimed: 2, completed: 2, failed: 0, abandoned: 0, lostLease: 0 });
});

test('batch records a failed job and continues processing later jobs', async () => {
    const failed = [];
    const completed = [];
    const error = Object.assign(new Error('generation failed'), { code: 'GENERATION_FAILED' });
    const jobStore = {
        claim: async () => [claimedJob('1'), claimedJob('2')],
        complete: async job => completed.push(job.id),
        fail: async (job, receivedError, request) => failed.push([job.id, receivedError, request]),
    };
    const generationService = {
        process: async job => {
            if (job.id === '1') throw error;
            return { readyCount: 2 };
        },
    };

    const summary = await runQuestionGenerationBatch({
        jobStore,
        generationService,
        workerId: 'worker-a',
        limit: 2,
    });

    assert.deepEqual(completed, ['2']);
    assert.equal(failed.length, 1);
    assert.equal(failed[0][0], '1');
    assert.strictEqual(failed[0][1], error);
    assert.deepEqual(failed[0][2], { workerId: 'worker-a' });
    assert.deepEqual(summary, { claimed: 2, completed: 1, failed: 1, abandoned: 0, lostLease: 0 });
});

test('worker start is idempotent and stop clears its single polling timer', async () => {
    const timers = [];
    const cleared = [];
    let claims = 0;
    const jobStore = {
        claim: async () => {
            claims += 1;
            return [];
        },
        complete: async () => {},
        fail: async () => {},
    };
    const worker = createQuestionGenerationWorker({
        jobStore,
        generationService: { process: async () => ({ readyCount: 2 }) },
        workerId: 'worker-a',
        pollIntervalMs: 5_000,
        setIntervalFn: (callback, interval) => {
            const handle = { callback, interval };
            timers.push(handle);
            return handle;
        },
        clearIntervalFn: handle => cleared.push(handle),
    });

    assert.equal(worker.start(), true);
    assert.equal(worker.start(), false);
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(timers.length, 1);
    assert.equal(timers[0].interval, 5_000);
    assert.equal(claims, 1);

    await worker.stop();
    await worker.stop();

    assert.deepEqual(cleared, [timers[0]]);
    assert.equal(worker.isRunning(), false);
});

test('poll ticks never overlap while a batch is still in flight', async () => {
    const callbacks = [];
    let releaseClaim;
    let claimCalls = 0;
    const blockedClaim = new Promise(resolve => { releaseClaim = resolve; });
    const worker = createQuestionGenerationWorker({
        jobStore: {
            claim: async () => {
                claimCalls += 1;
                await blockedClaim;
                return [];
            },
            complete: async () => {},
            fail: async () => {},
        },
        generationService: { process: async () => ({ readyCount: 2 }) },
        workerId: 'worker-a',
        setIntervalFn: callback => {
            callbacks.push(callback);
            return { id: 1 };
        },
        clearIntervalFn: () => {},
    });

    worker.start();
    callbacks[0]();
    callbacks[0]();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(claimCalls, 1);

    releaseClaim();
    await worker.stop();
});

test('worker reports a successful batch after a transient polling error', async () => {
    const errors = [];
    const successes = [];
    let shouldFail = true;
    const worker = createQuestionGenerationWorker({
        jobStore: {
            claim: async () => {
                if (shouldFail) {
                    shouldFail = false;
                    throw new Error('database offline');
                }
                return [];
            },
            complete: async () => {},
            fail: async () => {},
        },
        generationService: { process: async () => ({ readyCount: 2 }) },
        workerId: 'worker-a',
        runImmediately: false,
        onError: error => errors.push(error.message),
        onSuccess: summary => successes.push(summary),
        setIntervalFn: () => ({ id: 1 }),
        clearIntervalFn: () => {},
    });

    await worker.runOnce();
    await worker.runOnce();
    assert.deepEqual(errors, ['database offline']);
    assert.deepEqual(successes, [{ claimed: 0, completed: 0, failed: 0, abandoned: 0, lostLease: 0 }]);
    await worker.stop();
});

test('polling reports infrastructure errors without creating an unhandled rejection', async () => {
    const callbacks = [];
    const errors = [];
    const worker = createQuestionGenerationWorker({
        jobStore: {
            claim: async () => { throw new Error('database offline'); },
            complete: async () => {},
            fail: async () => {},
        },
        generationService: { process: async () => ({ readyCount: 2 }) },
        workerId: 'worker-a',
        runImmediately: false,
        onError: error => errors.push(error.message),
        setIntervalFn: callback => {
            callbacks.push(callback);
            return { id: 1 };
        },
        clearIntervalFn: () => {},
    });

    worker.start();
    callbacks[0]();
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(errors, ['database offline']);
    await worker.stop();
});


test('stale fail transition is abandoned without making the worker unhealthy and later jobs continue', async () => {
    const processed = [];
    const completed = [];
    const errors = [];
    const successes = [];
    const stale = Object.assign(new Error('lease moved'), { code: 'JOB_LEASE_NOT_OWNED_OR_STALE' });
    const worker = createQuestionGenerationWorker({
        jobStore: {
            claim: async () => [claimedJob('1'), claimedJob('2')],
            complete: async job => completed.push(job.id),
            fail: async job => {
                if (job.id === '1') throw stale;
            },
        },
        generationService: {
            process: async job => {
                processed.push(job.id);
                if (job.id === '1') throw new Error('generation failed after lease loss');
                return { readyCount: 2 };
            },
        },
        workerId: 'worker-a',
        runImmediately: false,
        onError: error => errors.push(error),
        onSuccess: summary => successes.push(summary),
        setIntervalFn: () => ({ id: 1 }),
        clearIntervalFn: () => {},
    });

    const summary = await worker.runOnce();

    assert.deepEqual(processed, ['1', '2']);
    assert.deepEqual(completed, ['2']);
    assert.deepEqual(summary, { claimed: 2, completed: 1, failed: 0, abandoned: 1, lostLease: 1 });
    assert.deepEqual(errors, []);
    assert.deepEqual(successes, [summary]);
    await worker.stop();
});

test('non-stale fail transition errors remain worker infrastructure failures', async () => {
    const transitionError = Object.assign(new Error('database write failed'), { code: 'DATABASE_WRITE_FAILED' });
    await assert.rejects(
        runQuestionGenerationBatch({
            jobStore: {
                claim: async () => [claimedJob('1')],
                complete: async () => {},
                fail: async () => { throw transitionError; },
            },
            generationService: { process: async () => { throw new Error('generation failed'); } },
            workerId: 'worker-a',
        }),
        error => error === transitionError
    );
});

