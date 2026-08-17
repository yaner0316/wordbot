const test = require('node:test');
const assert = require('node:assert/strict');

const {
    DEFAULT_WORKER_STALL_AFTER_MS,
    FEISHU_REQUIRED_ENV,
    REQUIRED_ENV,
    SUPABASE_REQUIRED_ENV,
    getRuntimeHealth,
    getQuestionGenerationWorkerHealth,
} = require('../runtime-health');

test('worker default stall window allows a bounded AI generation batch', () => {
    assert.equal(DEFAULT_WORKER_STALL_AFTER_MS, 15 * 60_000);
    const health = getQuestionGenerationWorkerHealth({
        configured: true,
        running: true,
        startedAt: '2026-08-14T00:00:00.000Z',
        lastAttemptAt: '2026-08-14T00:00:00.000Z',
        now: '2026-08-14T00:02:00.000Z',
    });

    assert.equal(health.ok, true);
    assert.equal(health.status, 'never_succeeded');
});

test('runtime health marks missing required environment variables', () => {
    const health = getRuntimeHealth({
        env: {
            DATA_SOURCE: 'feishu',
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
    const env = {
        DATA_SOURCE: 'supabase',
        ...Object.fromEntries(SUPABASE_REQUIRED_ENV.map(name => [name, 'set'])),
    };
    const health = getRuntimeHealth({ env });

    assert.equal(health.ok, true);
    assert.deepEqual(health.missing, []);
});


test('runtime health reports question cache configuration booleans without secrets', () => {
    const env = {
        DATA_SOURCE: 'feishu',
        ...Object.fromEntries(FEISHU_REQUIRED_ENV.map(name => [name, 'set'])),
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

test('runtime health reports DATA_SOURCE used by runtime data-source module', () => {
    const health = getRuntimeHealth({
        env: {
            DATA_SOURCE: 'supabase',
            WORDBOT_DATA_SOURCE: 'feishu',
        },
    });

    assert.equal(health.dataSource, 'supabase');
});

test('runtime health defaults dataSource to supabase and ignores the retired alias', () => {
    const health = getRuntimeHealth({ env: { WORDBOT_DATA_SOURCE: 'feishu' } });

    assert.equal(health.dataSource, 'supabase');
});
test('runtime health requires Supabase credentials but not Feishu credentials in Supabase mode', () => {
    const missing = getRuntimeHealth({ env: { DATA_SOURCE: 'supabase' } });
    assert.equal(missing.ok, false);
    assert.deepEqual(missing.missing, SUPABASE_REQUIRED_ENV);
    assert.equal(Object.hasOwn(missing.env, 'FEISHU_APP_SECRET'), false);

    const configured = getRuntimeHealth({ env: {
        DATA_SOURCE: 'supabase',
        SUPABASE_URL: 'https://wordbot.invalid',
        SUPABASE_SERVICE_ROLE_KEY: 'configured',
    } });
    assert.equal(configured.ok, true);
    assert.deepEqual(configured.missing, []);
    assert.deepEqual(configured.questionCache, { configured: true, source: 'supabase' });
});

test('worker health exposes unknown backlog and never-succeeded startup without failing during grace', () => {
    const health = getQuestionGenerationWorkerHealth({
        configured: true,
        running: true,
        startedAt: '2026-08-14T00:00:00.000Z',
        now: '2026-08-14T00:00:20.000Z',
        stallAfterMs: 60_000,
    });

    assert.equal(health.ok, true);
    assert.equal(health.status, 'never_succeeded');
    assert.equal(health.neverSucceeded, true);
    assert.equal(health.stalled, false);
    assert.equal(health.eligibleDueCount, 'unknown');
});

test('worker health fails when a configured running worker never attempts after its grace period', () => {
    const health = getQuestionGenerationWorkerHealth({
        configured: true,
        running: true,
        startedAt: '2026-08-14T00:00:00.000Z',
        now: '2026-08-14T00:02:00.000Z',
        stallAfterMs: 60_000,
    });

    assert.equal(health.ok, false);
    assert.equal(health.status, 'stalled');
    assert.equal(health.stalled, true);
    assert.equal(health.neverSucceeded, true);
});

test('worker health treats recent successful empty polling with no due jobs as idle', () => {
    const health = getQuestionGenerationWorkerHealth({
        configured: true,
        running: true,
        startedAt: '2026-08-14T00:00:00.000Z',
        lastAttemptAt: '2026-08-14T00:09:55.000Z',
        lastSuccessAt: '2026-08-14T00:09:55.000Z',
        eligibleDueCount: 0,
        now: '2026-08-14T00:10:00.000Z',
        stallAfterMs: 60_000,
    });

    assert.equal(health.ok, true);
    assert.equal(health.status, 'idle');
    assert.equal(health.stalled, false);
    assert.equal(health.neverSucceeded, false);
    assert.equal(health.eligibleDueCount, 0);
});

test('worker health detects due backlog with recent polling but no claim progress', () => {
    const health = getQuestionGenerationWorkerHealth({
        configured: true,
        running: true,
        startedAt: '2026-08-14T00:00:00.000Z',
        lastAttemptAt: '2026-08-14T00:09:55.000Z',
        lastSuccessAt: '2026-08-14T00:09:55.000Z',
        eligibleDueCount: 3,
        now: '2026-08-14T00:10:00.000Z',
        stallAfterMs: 60_000,
    });

    assert.equal(health.ok, false);
    assert.equal(health.status, 'stalled');
    assert.equal(health.stalled, true);
    assert.equal(health.eligibleDueCount, 3);
});
