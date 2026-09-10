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

test('coverage controller reports safe failure state and remains scheduled', async () => {
    const errors = [];
    const controller = createQuestionCoverageController({
        reconcile: async () => { throw new Error('provider secret detail'); },
        runImmediately: false,
        onError: error => errors.push(error.message),
    });

    assert.equal(await controller.runOnce(), null);
    assert.deepEqual(errors, ['question_coverage_reconciliation_failed']);
    assert.equal(controller.getObservability().lastError, 'question_coverage_reconciliation_failed');
});
