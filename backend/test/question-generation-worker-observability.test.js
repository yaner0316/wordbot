'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createQuestionGenerationWorker } = require('../question-generation-worker');

test('worker exposes attempts, claims, successful polls, and completed progress', async () => {
    const timestamp = '2026-08-14T00:00:00.000Z';
    const worker = createQuestionGenerationWorker({
        jobStore: {
            claim: async () => [{ id: 'job-1' }],
            complete: async () => {},
            fail: async () => {},
        },
        generationService: { process: async () => ({ readyCount: 2 }) },
        workerId: 'worker-a',
        runImmediately: false,
        now: () => timestamp,
        setIntervalFn: () => ({ id: 1 }),
        clearIntervalFn: () => {},
    });

    assert.deepEqual(worker.getObservability(), {
        startedAt: null,
        lastAttemptAt: null,
        lastClaimAt: null,
        lastSuccessAt: null,
        lastCompletionAt: null,
    });

    worker.start();
    await worker.runOnce();

    assert.deepEqual(worker.getObservability(), {
        startedAt: timestamp,
        lastAttemptAt: timestamp,
        lastClaimAt: timestamp,
        lastSuccessAt: timestamp,
        lastCompletionAt: timestamp,
    });
    await worker.stop();
});

test('successful empty polls do not fabricate claim or completion progress', async () => {
    const timestamp = '2026-08-14T00:00:00.000Z';
    const worker = createQuestionGenerationWorker({
        jobStore: {
            claim: async () => [],
            complete: async () => {},
            fail: async () => {},
        },
        generationService: { process: async () => ({ readyCount: 2 }) },
        workerId: 'worker-a',
        runImmediately: false,
        now: () => timestamp,
        setIntervalFn: () => ({ id: 1 }),
        clearIntervalFn: () => {},
    });

    worker.start();
    await worker.runOnce();

    assert.equal(worker.getObservability().lastAttemptAt, timestamp);
    assert.equal(worker.getObservability().lastSuccessAt, timestamp);
    assert.equal(worker.getObservability().lastClaimAt, null);
    assert.equal(worker.getObservability().lastCompletionAt, null);
    await worker.stop();
});
