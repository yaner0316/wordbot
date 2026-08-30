const test = require('node:test');
const assert = require('node:assert/strict');

test('server starts and stops the durable question-generation worker with its lifecycle', async () => {
    const { startServer } = require('../server');
    const events = [];
    const runtime = {
        worker: {
            start() { events.push('start'); return true; },
            async stop() { events.push('stop'); },
            isRunning() { return events.includes('start') && !events.includes('stop'); },
        },
    };
    const server = startServer(0, {
        runtimeFactory: () => runtime,
        enableQuestionGenerationWorker: true,
    });
    await new Promise(resolve => server.once('listening', resolve));
    assert.deepEqual(events, ['start']);
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events, ['start', 'stop']);
});

test('server health recovers after a successful worker batch', async t => {
    const { startServer } = require('../server');
    let hooks;
    const runtime = {
        worker: {
            start() { return true; },
            async stop() {},
            isRunning() { return true; },
        },
    };
    const server = startServer(0, {
        runtimeFactory: options => {
            hooks = options;
            return runtime;
        },
        enableQuestionGenerationWorker: true,
    });
    await new Promise(resolve => server.once('listening', resolve));
    t.after(async () => {
        if (server.listening) await new Promise(resolve => server.close(resolve));
    });

    const sensitiveError = 'temporary database outage with service-role-secret-value';
    hooks.onError(new Error(sensitiveError));
    const port = server.address().port;
    const degradedResponse = await fetch(`http://127.0.0.1:${port}/api/health`);
    const degraded = await degradedResponse.json();
    assert.equal(degradedResponse.status, 503);
    assert.equal(degraded.questionGenerationWorker.lastError, 'question_generation_worker_failed');
    assert.equal(JSON.stringify(degraded).includes(sensitiveError), false);
    assert.equal(typeof hooks.onSuccess, 'function');

    hooks.onSuccess({ claimed: 0, completed: 0, failed: 0 });
    const recoveredResponse = await fetch(`http://127.0.0.1:${port}/api/health`);
    const recovered = await recoveredResponse.json();
    assert.equal(recoveredResponse.status, 200);
    assert.equal(recovered.questionGenerationWorker.lastError, null);
    assert.ok(recovered.questionGenerationWorker.lastSuccessAt);
});

test('server health reports injected due backlog as stalled when polling makes no claim progress', async t => {
    const { startServer } = require('../server');
    let hooks;
    let currentTime = '2026-08-14T00:00:00.000Z';
    const runtime = {
        worker: {
            start() { return true; },
            async stop() {},
            isRunning() { return true; },
        },
    };
    const server = startServer(0, {
        runtimeFactory: options => {
            hooks = options;
            return runtime;
        },
        enableQuestionGenerationWorker: true,
        workerHealthNow: () => currentTime,
        workerStallAfterMs: 60_000,
        getQuestionGenerationEligibleDueCount: async () => 4,
    });
    await new Promise(resolve => server.once('listening', resolve));
    t.after(async () => {
        if (server.listening) await new Promise(resolve => server.close(resolve));
    });

    hooks.onSuccess({ claimed: 0, completed: 0, failed: 0 });
    currentTime = '2026-08-14T00:02:00.000Z';

    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
    const health = await response.json();
    assert.equal(response.status, 503);
    assert.equal(health.questionGenerationWorker.status, 'stalled');
    assert.equal(health.questionGenerationWorker.eligibleDueCount, 4);
    assert.equal(health.questionGenerationWorker.stalled, true);
});

test('server health exposes a safe global queue summary', async t => {
    const { startServer } = require('../server');
    let hooks;
    const server = startServer(0, {
        runtimeFactory: options => {
            hooks = options;
            return {
            worker: {
                start() { return true; },
                async stop() {},
                isRunning() { return true; },
            },
        };
        },
        enableQuestionGenerationWorker: true,
        getQuestionGenerationEligibleDueCount: async () => 1,
        getQuestionGenerationQueueSummary: async () => ({
            counts: { pending: 1, running: 2, retrying: 3, failed: 4 },
            oldestPendingAgeMs: 31 * 60_000,
            lastErrorCode: 'QUESTION_GENERATION_FAILED',
        }),
    });
    await new Promise(resolve => server.once('listening', resolve));
    hooks.onSuccess({ claimed: 0, completed: 0, failed: 0 });
    t.after(async () => {
        if (server.listening) await new Promise(resolve => server.close(resolve));
    });

    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
    const health = await response.json();

    assert.ok([200, 503].includes(response.status));
    assert.deepEqual(health.questionGenerationQueue, {
        counts: { pending: 1, running: 2, retrying: 3, failed: 4 },
        oldestPendingAgeMs: 31 * 60_000,
        lastErrorCode: 'QUESTION_GENERATION_FAILED',
    });
});

test('production server health counts only jobs eligible under claim rules without an injected counter', async t => {
    const { startServer } = require('../server');
    let currentTime = '2026-08-14T00:20:00.000Z';
    const jobs = [
        { id: '1', user_id: 'u1', word_id: 'w1', word_version: 2, status: 'pending', next_attempt_at: '2026-08-14T00:00:00.000Z' },
        { id: '2', user_id: 'u1', word_id: 'w2', word_version: 1, status: 'retry_wait', next_attempt_at: '2026-08-14T00:10:00.000Z' },
        { id: '3', user_id: 'u1', word_id: 'w3', word_version: 1, status: 'pending', next_attempt_at: '2026-08-14T01:00:00.000Z' },
        { id: '4', user_id: 'u1', word_id: 'w4', word_version: 1, status: 'pending', next_attempt_at: '2026-08-14T00:00:00.000Z' },
        { id: '5', user_id: 'u1', word_id: 'w5', word_version: 1, status: 'pending', next_attempt_at: '2026-08-14T00:00:00.000Z' },
        { id: '6', user_id: 'u1', word_id: 'w6', word_version: 1, status: 'generating', lease_expires_at: '2026-08-14T00:05:00.000Z' },
        { id: '7', user_id: 'u1', word_id: 'w7', word_version: 1, status: 'generating', lease_expires_at: '2026-08-14T00:30:00.000Z' },
        { id: '8', user_id: 'u1', word_id: 'w8', word_version: 1, status: 'pending', next_attempt_at: '2026-08-14T00:00:00.000Z' },
    ];
    const words = [
        { id: 'w1', user_id: 'u1', question_generation_version: 2, mastery_status: 'pending', word: 'valid' },
        { id: 'w2', user_id: 'u1', question_generation_version: 1, mastery_status: 'mastered', word: 'mastered' },
        { id: 'w3', user_id: 'u1', question_generation_version: 1, mastery_status: 'pending', word: 'future' },
        { id: 'w4', user_id: 'u1', question_generation_version: 2, mastery_status: 'pending', word: 'version' },
        { id: 'w5', user_id: 'u1', question_generation_version: 1, mastery_status: 'pending', word: 'bad123' },
        { id: 'w6', user_id: 'u1', question_generation_version: 1, mastery_status: 'pending', word: "mother-in-law" },
        { id: 'w7', user_id: 'u1', question_generation_version: 1, mastery_status: 'pending', word: 'leased' },
        { id: 'w8', user_id: 'u1', question_generation_version: 1, mastery_status: 'pending', word: '\tvalid\t' },
    ];
    const healthClient = {
        from(table) {
            return {
                select() { return this; },
                or() { return this; },
                order() { return this; },
                gt() { return this; },
                in() { return this; },
                limit() {
                    return Promise.resolve({ data: table === 'question_generation_jobs' ? jobs : words, error: null });
                },
            };
        },
    };
    const runtime = {
        worker: {
            start() { return true; },
            async stop() {},
            isRunning() { return true; },
        },
    };
    const server = startServer(0, {
        runtimeFactory: () => runtime,
        enableQuestionGenerationWorker: true,
        workerHealthNow: () => currentTime,
        workerStallAfterMs: 60_000,
        questionGenerationHealthClient: healthClient,
    });
    await new Promise(resolve => server.once('listening', resolve));
    t.after(async () => {
        if (server.listening) await new Promise(resolve => server.close(resolve));
    });

    currentTime = '2026-08-14T00:22:00.000Z';
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
    const health = await response.json();

    assert.equal(response.status, 503);
    assert.equal(health.questionGenerationWorker.eligibleDueCount, 2);
    assert.equal(health.questionGenerationWorker.status, 'stalled');
});

test('worker due-count failures are masked in health output', async t => {
    const { startServer } = require('../server');
    const secret = 'service-role-secret-value';
    const server = startServer(0, {
        runtimeFactory: () => ({
            worker: {
                start() { return true; },
                async stop() {},
                isRunning() { return true; },
            },
        }),
        enableQuestionGenerationWorker: true,
        questionGenerationHealthClient: {
            from() { throw new Error(`authorization failed: ${secret}`); },
        },
    });
    await new Promise(resolve => server.once('listening', resolve));
    t.after(async () => {
        if (server.listening) await new Promise(resolve => server.close(resolve));
    });

    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
    const body = await response.text();
    assert.equal(body.includes(secret), false);
});

test('shutdownServer waits for the in-flight worker to stop', async t => {
    const { startServer, shutdownServer } = require('../server');
    let releaseStop;
    const stopGate = new Promise(resolve => { releaseStop = resolve; });
    const runtime = {
        worker: {
            start() { return true; },
            async stop() { await stopGate; },
            isRunning() { return true; },
        },
    };
    const server = startServer(0, {
        runtimeFactory: () => runtime,
        enableQuestionGenerationWorker: true,
    });
    await new Promise(resolve => server.once('listening', resolve));
    t.after(async () => {
        releaseStop();
        if (server.listening) await new Promise(resolve => server.close(resolve));
    });

    assert.equal(typeof shutdownServer, 'function');
    let settled = false;
    const shutdown = shutdownServer(server);
    shutdown.then(() => { settled = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    assert.equal(server.listening, true, 'HTTP must remain open until worker.stop() settles');

    releaseStop();
    await shutdown;
    assert.equal(settled, true);
});


test('two concurrently created servers isolate worker health and shutdown state', async t => {
    const { startServer, shutdownServer } = require('../server');
    const hooks = {};
    const events = { first: [], second: [] };
    function runtimeFor(name) {
        return {
            worker: {
                start() { events[name].push('start'); return true; },
                async stop() { events[name].push('stop'); },
                isRunning() { return !events[name].includes('stop'); },
            },
        };
    }
    const first = startServer(0, {
        enableQuestionGenerationWorker: true,
        runtimeFactory: options => {
            hooks.first = options;
            return runtimeFor('first');
        },
    });
    const second = startServer(0, {
        enableQuestionGenerationWorker: true,
        runtimeFactory: options => {
            hooks.second = options;
            return runtimeFor('second');
        },
    });
    await Promise.all([
        new Promise(resolve => first.once('listening', resolve)),
        new Promise(resolve => second.once('listening', resolve)),
    ]);
    t.after(async () => {
        await Promise.all([first, second].map(server => server.listening ? shutdownServer(server) : undefined));
    });

    hooks.first.onError(new Error('first worker failed'));
    const firstHealth = await (await fetch(`http://127.0.0.1:${first.address().port}/api/health`)).json();
    const secondResponse = await fetch(`http://127.0.0.1:${second.address().port}/api/health`);
    const secondHealth = await secondResponse.json();

    assert.equal(firstHealth.questionGenerationWorker.lastError, 'question_generation_worker_failed');
    assert.equal(secondResponse.status, 200);
    assert.equal(secondHealth.questionGenerationWorker.lastError, null);

    await shutdownServer(first);
    assert.deepEqual(events.first, ['start', 'stop']);
    assert.deepEqual(events.second, ['start']);
    const stillRunning = await fetch(`http://127.0.0.1:${second.address().port}/api/health`);
    assert.equal(stillRunning.status, 200);
});

test('direct HTTP close waits for its own worker before closing the listener', async () => {
    const { startServer } = require('../server');
    let releaseStop;
    const stopGate = new Promise(resolve => { releaseStop = resolve; });
    const events = [];
    const server = startServer(0, {
        enableQuestionGenerationWorker: true,
        runtimeFactory: () => ({
            worker: {
                start() { events.push('start'); return true; },
                async stop() { events.push('stop'); await stopGate; },
                isRunning() { return true; },
            },
        }),
    });
    await new Promise(resolve => server.once('listening', resolve));

    let closeSettled = false;
    const closePromise = new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
    });
    closePromise.then(() => { closeSettled = true; });
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(events, ['start', 'stop']);
    assert.equal(closeSettled, false);
    assert.equal(server.listening, true);

    releaseStop();
    await closePromise;
    assert.equal(server.listening, false);
});
