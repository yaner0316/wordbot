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

    hooks.onError(new Error('temporary database outage'));
    const port = server.address().port;
    const degradedResponse = await fetch(`http://127.0.0.1:${port}/api/health`);
    const degraded = await degradedResponse.json();
    assert.equal(degradedResponse.status, 503);
    assert.equal(degraded.questionGenerationWorker.lastError, 'temporary database outage');
    assert.equal(typeof hooks.onSuccess, 'function');

    hooks.onSuccess({ claimed: 0, completed: 0, failed: 0 });
    const recoveredResponse = await fetch(`http://127.0.0.1:${port}/api/health`);
    const recovered = await recoveredResponse.json();
    assert.equal(recoveredResponse.status, 200);
    assert.equal(recovered.questionGenerationWorker.lastError, null);
    assert.ok(recovered.questionGenerationWorker.lastSuccessAt);
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

    assert.equal(firstHealth.questionGenerationWorker.lastError, 'first worker failed');
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

test('production startup applies migrations before opening the listener', async () => {
    const { startServerAfterMigrations } = require('../server');
    const events = [];
    const fakeServer = { id: 'server' };

    const server = await startServerAfterMigrations({
        applyMigrations: async () => { events.push('migrate'); },
        startServerImpl: () => { events.push('listen'); return fakeServer; },
    });

    assert.deepEqual(events, ['migrate', 'listen']);
    assert.equal(server, fakeServer);
});
