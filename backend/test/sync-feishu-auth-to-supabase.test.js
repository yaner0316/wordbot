'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildAuthSyncPlan,
    createRuntimeDependencies,
    formatReport,
    parseArgs,
    safeErrorCode,
    syncFeishuAuthToSupabase,
} = require('../scripts/sync-feishu-auth-to-supabase');

const CHILD_HASH = 'a'.repeat(64);
const CHILD_SALT = 'b'.repeat(32);
const PARENT_HASH = 'c'.repeat(64);
const PARENT_SALT = 'd'.repeat(32);

function sourceRecord(overrides = {}) {
    return {
        record_id: 'rec-user-1',
        fields: {
            user: 'Test_User',
            auth_password_hash: CHILD_HASH,
            auth_password_salt: CHILD_SALT,
            auth_created_at: '1722470400000',
            parent_username: 'parent-test-user',
            parent_password_hash: PARENT_HASH,
            parent_password_salt: PARENT_SALT,
            parent_created_at: '1722556800000',
            ...overrides,
        },
    };
}

function targetUser(overrides = {}) {
    return {
        id: 'user-uuid-1',
        username: 'test_user',
        username_key: 'test_user',
        password_hash: 'e'.repeat(64),
        password_salt: 'f'.repeat(32),
        auth_created_at: '2024-01-01T00:00:00.000Z',
        parent_username: 'parent-test-user',
        parent_password_hash: '1'.repeat(64),
        parent_password_salt: '2'.repeat(32),
        parent_created_at: '2024-01-02T00:00:00.000Z',
        ...overrides,
    };
}

function dependencies({ sources = [sourceRecord()], targets = [targetUser()] } = {}) {
    const writes = [];
    return {
        writes,
        loadSourceRows: async () => sources,
        loadTargetUsers: async () => targets,
        updateTargetUser: async change => {
            writes.push(change);
            return true;
        },
    };
}

test('runtime loads credential carriers from the configured Feishu stats table', async () => {
    const statsTable = { appToken: 'stats-app', tableId: 'stats-table' };
    const reads = [];
    const runtime = createRuntimeDependencies({
        getRecords: async table => {
            reads.push(table);
            return [];
        },
        accountTable: statsTable,
        client: { from: () => { throw new Error('target query not expected'); } },
    });

    assert.deepEqual(await runtime.loadSourceRows(), []);
    assert.deepEqual(reads, [statsTable]);
});

test('defaults to dry-run, performs zero writes, and never reports credential material', async () => {
    const deps = dependencies();
    const result = await syncFeishuAuthToSupabase(deps);

    assert.equal(result.mode, 'dry-run');
    assert.equal(result.planned, 1);
    assert.equal(result.applied, 0);
    assert.deepEqual(result.usernames, ['test_user']);
    assert.match(result.planFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(deps.writes, []);

    const output = formatReport(result);
    for (const forbidden of [
        CHILD_HASH, CHILD_SALT, PARENT_HASH, PARENT_SALT,
        'e'.repeat(64), 'f'.repeat(32), '1'.repeat(64), '2'.repeat(32),
    ]) {
        assert.equal(output.includes(forbidden), false);
        assert.equal(JSON.stringify(result).includes(forbidden), false);
    }
});

test('apply requires the exact reviewed fingerprint and writes only six credential fields', async () => {
    const deps = dependencies();
    const dryRun = await syncFeishuAuthToSupabase(deps);

    await assert.rejects(
        () => syncFeishuAuthToSupabase(deps, { apply: true }),
        /PLAN_FINGERPRINT_REQUIRED/,
    );
    await assert.rejects(
        () => syncFeishuAuthToSupabase(deps, { apply: true, planFingerprint: '0'.repeat(64) }),
        /PLAN_FINGERPRINT_MISMATCH/,
    );
    assert.deepEqual(deps.writes, []);

    const applied = await syncFeishuAuthToSupabase(deps, {
        apply: true,
        planFingerprint: dryRun.planFingerprint,
    });

    assert.equal(applied.mode, 'apply');
    assert.equal(applied.applied, 1);
    assert.equal(deps.writes.length, 1);
    assert.deepEqual(Object.keys(deps.writes[0].values).sort(), [
        'auth_created_at',
        'parent_created_at',
        'parent_password_hash',
        'parent_password_salt',
        'password_hash',
        'password_salt',
    ]);
    assert.equal(deps.writes[0].values.password_hash, CHILD_HASH);
    assert.equal(deps.writes[0].values.password_salt, CHILD_SALT);
    assert.equal(deps.writes[0].values.parent_password_hash, PARENT_HASH);
    assert.equal(deps.writes[0].values.parent_password_salt, PARENT_SALT);
    assert.equal(deps.writes[0].values.auth_created_at, '2024-08-01T00:00:00.000Z');
    assert.equal(deps.writes[0].values.parent_created_at, '2024-08-02T00:00:00.000Z');
    assert.equal('parent_username' in deps.writes[0].values, false);
});

test('repeated execution is idempotent when target credentials already match', async () => {
    const matching = targetUser({
        password_hash: CHILD_HASH,
        password_salt: CHILD_SALT,
        auth_created_at: '2024-08-01T00:00:00.000Z',
        parent_password_hash: PARENT_HASH,
        parent_password_salt: PARENT_SALT,
        parent_created_at: '2024-08-02T00:00:00.000Z',
    });
    const deps = dependencies({ targets: [matching] });
    const result = await syncFeishuAuthToSupabase(deps);

    assert.equal(result.planned, 0);
    assert.equal(result.unchanged, 1);
    assert.deepEqual(deps.writes, []);
});

test('quarantines credential-bearing source usernames that are absent from Supabase', async () => {
    const deps = dependencies({ targets: [] });
    const result = await syncFeishuAuthToSupabase(deps);

    assert.deepEqual(result.sourceOnly, ['test_user']);
    assert.equal(result.sourceUsers, 1);
    assert.equal(result.planned, 0);
    assert.deepEqual(deps.writes, []);
    assert.match(result.planFingerprint, /^[a-f0-9]{64}$/);
});

test('fails closed for duplicate credential-bearing source or target usernames', async () => {
    await assert.rejects(
        () => syncFeishuAuthToSupabase(dependencies({
            sources: [sourceRecord(), sourceRecord({ auth_created_at: '1722470400001' })],
        })),
        /SOURCE_USER_DUPLICATE: test_user/,
    );
    await assert.rejects(
        () => syncFeishuAuthToSupabase(dependencies({
            targets: [targetUser(), targetUser({ id: 'user-uuid-2' })],
        })),
        /TARGET_USER_DUPLICATE: test_user/,
    );
});

test('fails closed for half child or parent PBKDF2 credential pairs', async () => {
    await assert.rejects(
        () => syncFeishuAuthToSupabase(dependencies({
            sources: [sourceRecord({ auth_password_salt: '' })],
        })),
        /SOURCE_CHILD_CREDENTIALS_INCOMPLETE: test_user/,
    );
    await assert.rejects(
        () => syncFeishuAuthToSupabase(dependencies({
            sources: [sourceRecord({ parent_password_hash: '' })],
        })),
        /SOURCE_PARENT_CREDENTIALS_INCOMPLETE: test_user/,
    );
    await assert.rejects(
        () => syncFeishuAuthToSupabase(dependencies({
            targets: [targetUser({ password_hash: null })],
        })),
        /TARGET_CHILD_CREDENTIALS_INCOMPLETE: test_user/,
    );
});

test('fails closed for malformed PBKDF2 material', async () => {
    await assert.rejects(
        () => syncFeishuAuthToSupabase(dependencies({
            sources: [sourceRecord({ auth_password_hash: 'not-a-pbkdf2-hash' })],
        })),
        /SOURCE_CHILD_CREDENTIALS_INVALID: test_user/,
    );
    await assert.rejects(
        () => syncFeishuAuthToSupabase(dependencies({
            targets: [targetUser({ parent_password_salt: 'too-short' })],
        })),
        /TARGET_PARENT_CREDENTIALS_INVALID: test_user/,
    );
});

test('fails closed when parent credentials would be attached to a different parent identity', async () => {
    await assert.rejects(
        () => syncFeishuAuthToSupabase(dependencies({
            targets: [targetUser({ parent_username: 'another-parent' })],
        })),
        /PARENT_USERNAME_MISMATCH: test_user/,
    );
    await assert.rejects(
        () => syncFeishuAuthToSupabase(dependencies({
            sources: [sourceRecord({ parent_username: '' })],
        })),
        /SOURCE_PARENT_USERNAME_MISSING: test_user/,
    );
});

test('fails closed when source or target state changes after plan review', async () => {
    let source = sourceRecord();
    const deps = dependencies();
    deps.loadSourceRows = async () => [source];
    const dryRun = await syncFeishuAuthToSupabase(deps);
    source = sourceRecord({ auth_password_hash: '6'.repeat(64) });

    await assert.rejects(
        () => syncFeishuAuthToSupabase(deps, {
            apply: true,
            planFingerprint: dryRun.planFingerprint,
        }),
        /PLAN_FINGERPRINT_MISMATCH/,
    );
    assert.deepEqual(deps.writes, []);
});

test('plan fingerprint is deterministic across input order and changes with current target state', () => {
    const secondSource = sourceRecord({ user: 'Second', auth_password_hash: '3'.repeat(64), auth_password_salt: '4'.repeat(32) });
    const secondTarget = targetUser({ id: 'user-uuid-2', username: 'Second', username_key: 'second' });
    const forward = buildAuthSyncPlan([sourceRecord(), secondSource], [targetUser(), secondTarget]);
    const reversed = buildAuthSyncPlan([secondSource, sourceRecord()], [secondTarget, targetUser()]);
    const drifted = buildAuthSyncPlan(
        [sourceRecord(), secondSource],
        [targetUser({ password_hash: '5'.repeat(64) }), secondTarget],
    );

    assert.equal(forward.planFingerprint, reversed.planFingerprint);
    assert.notEqual(forward.planFingerprint, drifted.planFingerprint);

    const quarantined = buildAuthSyncPlan(
        [sourceRecord(), secondSource, sourceRecord({ user: 'source-only' })],
        [targetUser(), secondTarget],
    );
    assert.notEqual(forward.planFingerprint, quarantined.planFingerprint);
    assert.deepEqual(quarantined.sourceOnly, ['source-only']);
});

test('CLI parsing is dry-run by default and rejects ambiguous write flags', () => {
    assert.deepEqual(parseArgs([]), { apply: false, planFingerprint: null, help: false });
    assert.deepEqual(parseArgs(['--apply', '--plan-fingerprint', 'a'.repeat(64)]), {
        apply: true,
        planFingerprint: 'a'.repeat(64),
        help: false,
    });
    assert.throws(() => parseArgs(['--apply']), /PLAN_FINGERPRINT_REQUIRED/);
    assert.throws(() => parseArgs(['--plan-fingerprint', 'a'.repeat(64)]), /APPLY_REQUIRED/);
    assert.throws(() => parseArgs(['--apply=true']), /UNKNOWN_ARGUMENT/);
    assert.throws(() => parseArgs(['--plan-fingerprint', 'bad']), /PLAN_FINGERPRINT_VALUE_INVALID/);
});

test('CLI error rendering never echoes unknown dependency messages', () => {
    assert.equal(safeErrorCode(new Error('service secret value appeared here')), 'AUTH_SYNC_FAILED');
    assert.equal(
        safeErrorCode(new Error('PLAN_FINGERPRINT_MISMATCH: source changed')),
        'PLAN_FINGERPRINT_MISMATCH',
    );
});
