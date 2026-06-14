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
