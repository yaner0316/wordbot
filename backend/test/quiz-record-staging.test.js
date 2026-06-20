const test = require('node:test');
const assert = require('node:assert/strict');

const { createQuizRecordWriteStaging } = require('../quiz-record-staging');

test('waitFor waits for a staged quiz record write and clears it', async () => {
    const staging = createQuizRecordWriteStaging();
    let resolveWrite;
    const write = new Promise(resolve => { resolveWrite = resolve; });

    staging.stage('test-1', write);
    let settled = false;
    const waiting = staging.waitFor('test-1').then(() => { settled = true; });

    await Promise.resolve();
    assert.equal(settled, false);

    resolveWrite('ok');
    await waiting;

    assert.equal(settled, true);
    assert.equal(staging.has('test-1'), false);
});

test('waitFor resolves immediately when no write is staged', async () => {
    const staging = createQuizRecordWriteStaging();
    await staging.waitFor('missing-test');
    assert.equal(staging.has('missing-test'), false);
});

test('staged write rejection is observed even before waitFor is called', async () => {
    const staging = createQuizRecordWriteStaging();
    const unhandled = [];
    const onUnhandled = reason => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);

    try {
        const failure = new Error('feishu write failed');
        staging.stage('test-reject', Promise.reject(failure));

        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setImmediate(resolve));

        assert.deepEqual(unhandled, []);
    } finally {
        process.off('unhandledRejection', onUnhandled);
    }
});

test('waitFor reports a staged write rejection to the submit path', async () => {
    const staging = createQuizRecordWriteStaging();
    const failure = new Error('feishu write failed');

    staging.stage('test-reject', Promise.reject(failure));

    await assert.rejects(
        () => staging.waitFor('test-reject'),
        /feishu write failed/
    );
});
