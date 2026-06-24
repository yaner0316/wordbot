const test = require('node:test');
const assert = require('node:assert/strict');

const { REQUIRED_ENV, getRuntimeHealth } = require('../runtime-health');

test('runtime health marks missing required environment variables', () => {
    const health = getRuntimeHealth({
        env: {
            FEISHU_APP_ID: 'app-id',
        },
        version: 'test-version',
        now: () => '2026-06-13T00:00:00.000Z',
    });

    assert.equal(health.ok, false);
    assert.equal(health.version, 'test-version');
    assert.equal(health.time, '2026-06-13T00:00:00.000Z');
    assert.equal(health.env.FEISHU_APP_ID, true);
    assert.equal(health.env.FEISHU_APP_SECRET, false);
    assert.ok(health.missing.includes('FEISHU_APP_SECRET'));
});

test('runtime health is ok when all required variables are present', () => {
    const env = Object.fromEntries(REQUIRED_ENV.map(name => [name, 'set']));
    const health = getRuntimeHealth({ env });

    assert.equal(health.ok, true);
    assert.deepEqual(health.missing, []);
});


test('runtime health reports question cache configuration booleans without secrets', () => {
    const env = {
        ...Object.fromEntries(REQUIRED_ENV.map(name => [name, 'set'])),
        FEISHU_QUESTION_CACHE_APP_TOKEN: 'secret-app-token',
        FEISHU_QUESTION_CACHE_TABLE_ID: 'secret-table-id',
    };
    const health = getRuntimeHealth({ env });

    assert.deepEqual(health.questionCache, {
        configured: true,
        appTokenConfigured: true,
        tableIdConfigured: true,
    });
    assert.doesNotMatch(JSON.stringify(health), /secret-app-token|secret-table-id/);
});
