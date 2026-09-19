'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createQuestionCoverageController } = require('../question-coverage-controller');

test('coverage controller coalesces overlapping reconciliation requests', async () => {
    let calls = 0;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const controller = createQuestionCoverageController({
        reconcile: async () => {
            calls += 1;
            await gate;
            return { planned: 2 };
        },
        runImmediately: false,
    });

    const first = controller.runOnce();
    const second = controller.runOnce();
    assert.strictEqual(first, second);
    assert.equal(calls, 0);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1);
    release();
    assert.deepEqual(await first, { planned: 2 });
});

test('coverage controller starts immediately, schedules repeats, and stops cleanly', async () => {
    const events = [];
    let scheduled;
    const controller = createQuestionCoverageController({
        reconcile: async () => { events.push('reconcile'); return { planned: 0 }; },
        intervalMs: 60_000,
        setIntervalFn(callback, interval) {
            events.push(`schedule:${interval}`);
            scheduled = callback;
            return 7;
        },
        clearIntervalFn(timer) { events.push(`clear:${timer}`); },
    });

    assert.equal(controller.start(), true);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events, ['schedule:60000', 'reconcile']);
    scheduled();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(events.filter(event => event === 'reconcile').length, 2);
    await controller.stop();
    assert.equal(events.at(-1), 'clear:7');
    assert.equal(controller.isRunning(), false);
});

test('coverage controller reports a classified safe cause without leaking raw detail', async () => {
    // A single opaque code made the production failure undiagnosable: the previous
    // implementation discarded the real error entirely. The cause must be classified
    // into a bounded safe code, and the raw message must never be exposed.
    const errors = [];
    const controller = createQuestionCoverageController({
        reconcile: async () => {
            const error = new Error('provider secret detail');
            error.code = 'QUESTION_COVERAGE_QUESTION_CACHE_LOAD_FAILED';
            throw error;
        },
        runImmediately: false,
        onError: error => errors.push(error.message),
    });

    assert.equal(await controller.runOnce(), null);
    assert.deepEqual(errors, ['snapshot_load_failed']);
    assert.equal(controller.getObservability().lastError, 'snapshot_load_failed');
});

test('coverage controller classifies a missing enqueue answer separately from a load failure', async () => {
    const errors = [];
    const controller = createQuestionCoverageController({
        reconcile: async () => {
            const error = new Error('QUESTION_COVERAGE_ENQUEUE_FAILED');
            throw error;
        },
        runImmediately: false,
        onError: error => errors.push(error.message),
    });

    assert.equal(await controller.runOnce(), null);
    assert.deepEqual(errors, ['enqueue_failed']);
});

test('coverage controller falls back to a generic safe code for unknown failures', async () => {
    const errors = [];
    const controller = createQuestionCoverageController({
        reconcile: async () => { throw new Error('provider secret detail'); },
        runImmediately: false,
        onError: error => errors.push(error.message),
    });

    assert.equal(await controller.runOnce(), null);
    assert.deepEqual(errors, ['reconciliation_failed']);
    const observed = controller.getObservability();
    assert.equal(observed.lastError, 'reconciliation_failed');
    assert.equal(String(observed.lastError).includes('secret'), false);
});
