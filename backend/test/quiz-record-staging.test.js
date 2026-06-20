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
