'use strict';

const { createHash } = require('node:crypto');

const PAGE_SIZE = 1000;
const AUTH_COLUMNS = [
    'password_hash',
    'password_salt',
    'auth_created_at',
    'parent_password_hash',
    'parent_password_salt',
    'parent_created_at',
];

function text(value) {
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return value.length ? text(value[0]) : '';
    if (typeof value === 'object') {
        if (value.text !== undefined) return text(value.text);
        if (value.value !== undefined) return text(value.value);
        if (value.name !== undefined) return text(value.name);
        return '';
    }
    return String(value).trim();
}

function usernameKey(value) {
    return text(value).replace(/\s+/g, '').toLowerCase();
}

function normalizeTimestamp(value, label) {
    const raw = text(value);
    if (!raw) return null;
    const numeric = Number(raw);
    const time = Number.isFinite(numeric) && numeric > 0 ? numeric : Date.parse(raw);
    if (!Number.isFinite(time)) throw new Error(`INVALID_TIMESTAMP: ${label}`);
    return new Date(time).toISOString();
}

function credentialPair(row, hashField, saltField, label, username) {
    const hash = text(row?.[hashField]);
    const salt = text(row?.[saltField]);
    if (Boolean(hash) !== Boolean(salt)) {
        throw new Error(`${label}_CREDENTIALS_INCOMPLETE: ${username}`);
    }
    if (hash && (!/^[a-f0-9]{64}$/i.test(hash) || !/^[a-f0-9]{32}$/i.test(salt))) {
        throw new Error(`${label}_CREDENTIALS_INVALID: ${username}`);
    }
    return { hash: hash || null, salt: salt || null, present: Boolean(hash) };
}

function sourceCredentialRows(rows) {
    return (rows || []).filter(record => {
        const fields = record?.fields || {};
        return [
            fields.auth_password_hash,
            fields.auth_password_salt,
            fields.auth_created_at,
            fields.parent_password_hash,
            fields.parent_password_salt,
            fields.parent_created_at,
        ].some(value => Boolean(text(value)));
    });
}

function indexUnique(rows, getKey, duplicateLabel) {
    const indexed = new Map();
    for (const row of rows || []) {
        const key = getKey(row);
        if (!key) throw new Error(`${duplicateLabel.replace('_DUPLICATE', '')}_USERNAME_MISSING`);
        if (indexed.has(key)) throw new Error(`${duplicateLabel}: ${key}`);
        indexed.set(key, row);
    }
    return indexed;
}

function sameValues(left, right) {
    return AUTH_COLUMNS.every(column => (left[column] ?? null) === (right[column] ?? null));
}

function targetState(target, key) {
    const child = credentialPair(target, 'password_hash', 'password_salt', 'TARGET_CHILD', key);
    const parent = credentialPair(target, 'parent_password_hash', 'parent_password_salt', 'TARGET_PARENT', key);
    return {
        password_hash: child.hash,
        password_salt: child.salt,
        auth_created_at: normalizeTimestamp(target.auth_created_at, `target auth_created_at ${key}`),
        parent_password_hash: parent.hash,
        parent_password_salt: parent.salt,
        parent_created_at: normalizeTimestamp(target.parent_created_at, `target parent_created_at ${key}`),
    };
}

function desiredState(source, target, current, key) {
    const fields = source?.fields || {};
    const child = credentialPair(fields, 'auth_password_hash', 'auth_password_salt', 'SOURCE_CHILD', key);
    const parent = credentialPair(fields, 'parent_password_hash', 'parent_password_salt', 'SOURCE_PARENT', key);
    if (parent.present) {
        const sourceParentKey = usernameKey(fields.parent_username);
        const targetParentKey = usernameKey(target?.parent_username);
        if (!sourceParentKey) throw new Error(`SOURCE_PARENT_USERNAME_MISSING: ${key}`);
        if (!targetParentKey) throw new Error(`TARGET_PARENT_USERNAME_MISSING: ${key}`);
        if (sourceParentKey !== targetParentKey) throw new Error(`PARENT_USERNAME_MISMATCH: ${key}`);
    }
    return {
        password_hash: child.present ? child.hash : current.password_hash,
        password_salt: child.present ? child.salt : current.password_salt,
        auth_created_at: child.present
            ? normalizeTimestamp(fields.auth_created_at, `source auth_created_at ${key}`)
            : current.auth_created_at,
        parent_password_hash: parent.present ? parent.hash : current.parent_password_hash,
        parent_password_salt: parent.present ? parent.salt : current.parent_password_salt,
        parent_created_at: parent.present
            ? normalizeTimestamp(fields.parent_created_at, `source parent_created_at ${key}`)
            : current.parent_created_at,
    };
}

function fingerprintEntries(entries, sourceOnly = []) {
    const payload = entries.map(entry => ({
        username: entry.username,
        targetId: entry.targetId,
        current: entry.current,
        values: entry.values,
    })).sort((left, right) => left.username.localeCompare(right.username));
    return createHash('sha256').update(JSON.stringify({
        version: 1,
        entries: payload,
        sourceOnly: [...sourceOnly].sort(),
    })).digest('hex');
}

function buildAuthSyncPlan(sourceRows = [], targetRows = []) {
    const sources = indexUnique(
        sourceCredentialRows(sourceRows),
        row => usernameKey(row?.fields?.user),
        'SOURCE_USER_DUPLICATE',
    );
    const targets = indexUnique(targetRows, row => usernameKey(row?.username_key || row?.username), 'TARGET_USER_DUPLICATE');
    const entries = [];
    const sourceOnly = [];
    let unchanged = 0;

    for (const [key, source] of sources) {
        const target = targets.get(key);
        if (!target) {
            sourceOnly.push(key);
            continue;
        }
        const current = targetState(target, key);
        const values = desiredState(source, target, current, key);
        const entry = { username: key, targetId: text(target.id), current, values };
        entries.push(entry);
        if (sameValues(current, values)) unchanged += 1;
    }

    const changes = entries.filter(entry => !sameValues(entry.current, entry.values));
    return {
        planFingerprint: fingerprintEntries(entries, sourceOnly),
        sourceUsers: sources.size,
        sourceOnly: sourceOnly.sort(),
        unchanged,
        changes,
    };
}

function requireDependency(dependencies, name) {
    if (typeof dependencies?.[name] !== 'function') throw new Error(`${name.toUpperCase()}_REQUIRED`);
    return dependencies[name];
}

async function syncFeishuAuthToSupabase(dependencies, options = {}) {
    const loadSourceRows = requireDependency(dependencies, 'loadSourceRows');
    const loadTargetUsers = requireDependency(dependencies, 'loadTargetUsers');
    const apply = options.apply === true;
    const reviewedFingerprint = text(options.planFingerprint).toLowerCase() || null;
    const [sourceRows, targetRows] = await Promise.all([loadSourceRows(), loadTargetUsers()]);
    const plan = buildAuthSyncPlan(sourceRows, targetRows);

    if (apply && !reviewedFingerprint) {
        throw new Error('PLAN_FINGERPRINT_REQUIRED: run dry-run and review its planFingerprint first');
    }
    if (apply && reviewedFingerprint !== plan.planFingerprint) {
        throw new Error('PLAN_FINGERPRINT_MISMATCH: source or target state changed; run a new dry-run');
    }

    let applied = 0;
    if (apply) {
        const updateTargetUser = requireDependency(dependencies, 'updateTargetUser');
        for (const change of plan.changes) {
            const updated = await updateTargetUser(change);
            if (updated !== true) throw new Error(`TARGET_STATE_CHANGED: ${change.username}`);
            applied += 1;
        }
    }

    return {
        mode: apply ? 'apply' : 'dry-run',
        planFingerprint: plan.planFingerprint,
        sourceUsers: plan.sourceUsers,
        sourceOnly: plan.sourceOnly,
        planned: plan.changes.length,
        unchanged: plan.unchanged,
        applied,
        usernames: plan.changes.map(change => change.username),
    };
}

function parseArgs(argv = []) {
    const parsed = { apply: false, planFingerprint: null, help: false };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--apply') {
            parsed.apply = true;
        } else if (argument === '--plan-fingerprint') {
            const value = text(argv[index + 1]).toLowerCase();
            if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('PLAN_FINGERPRINT_VALUE_INVALID');
            parsed.planFingerprint = value;
            index += 1;
        } else if (argument === '--help' || argument === '-h') {
            parsed.help = true;
        } else {
            throw new Error(`UNKNOWN_ARGUMENT: ${argument}`);
        }
    }
    if (!parsed.help && parsed.apply && !parsed.planFingerprint) throw new Error('PLAN_FINGERPRINT_REQUIRED');
    if (!parsed.help && !parsed.apply && parsed.planFingerprint) throw new Error('APPLY_REQUIRED');
    return parsed;
}

async function loadAllTargetUsers(client) {
    const rows = [];
    let lastId = null;
    for (;;) {
        let query = client.from('users').select([
            'id', 'username', 'username_key', 'parent_username', ...AUTH_COLUMNS,
        ].join(','));
        if (lastId !== null) query = query.gt('id', lastId);
        query = query.order('id', { ascending: true }).limit(PAGE_SIZE);
        const { data, error } = await query;
        if (error) throw new Error('TARGET_USERS_LOAD_FAILED');
        const page = data || [];
        rows.push(...page);
        if (page.length < PAGE_SIZE) return rows;
        const nextId = page.at(-1)?.id;
        if (!nextId || nextId === lastId) throw new Error('TARGET_USERS_CURSOR_INVALID');
        lastId = nextId;
    }
}

function applyExpectedFilter(query, column, value) {
    return value === null ? query.is(column, null) : query.eq(column, value);
}

function createRuntimeDependencies(overrides = {}) {
    const getRecords = overrides.getRecords || require('../feishu').getRecords;
    const accountTable = overrides.accountTable || require('../config').STATS_TABLE;
    const client = overrides.client || require('../supabase-client');
    return {
        loadSourceRows: () => getRecords(accountTable),
        loadTargetUsers: () => loadAllTargetUsers(client),
        async updateTargetUser(change) {
            let query = client.from('users').update(change.values).eq('id', change.targetId);
            for (const column of AUTH_COLUMNS) {
                query = applyExpectedFilter(query, column, change.current[column]);
            }
            const { data, error } = await query.select('id');
            if (error) throw new Error('TARGET_USER_UPDATE_FAILED');
            return Array.isArray(data) && data.length === 1;
        },
    };
}

function formatReport(result) {
    return JSON.stringify({
        mode: result.mode,
        planFingerprint: result.planFingerprint,
        sourceUsers: result.sourceUsers,
        sourceOnly: result.sourceOnly,
        planned: result.planned,
        unchanged: result.unchanged,
        applied: result.applied,
        usernames: result.usernames,
    }, null, 2);
}

function usage() {
    return [
        'Usage: node backend/scripts/sync-feishu-auth-to-supabase.js [--apply --plan-fingerprint SHA256]',
        '',
        'Default mode is dry-run. Apply requires the exact reviewed plan fingerprint.',
    ].join('\n');
}

const SAFE_ERROR_CODES = new Set([
    'APPLY_REQUIRED',
    'INVALID_TIMESTAMP',
    'LOADSOURCEROWS_REQUIRED',
    'LOADTARGETUSERS_REQUIRED',
    'PARENT_USERNAME_MISMATCH',
    'PLAN_FINGERPRINT_MISMATCH',
    'PLAN_FINGERPRINT_REQUIRED',
    'PLAN_FINGERPRINT_VALUE_INVALID',
    'SOURCE_CHILD_CREDENTIALS_INCOMPLETE',
    'SOURCE_CHILD_CREDENTIALS_INVALID',
    'SOURCE_PARENT_CREDENTIALS_INCOMPLETE',
    'SOURCE_PARENT_CREDENTIALS_INVALID',
    'SOURCE_PARENT_USERNAME_MISSING',
    'SOURCE_USER_DUPLICATE',
    'SOURCE_USER_USERNAME_MISSING',
    'TARGET_CHILD_CREDENTIALS_INCOMPLETE',
    'TARGET_CHILD_CREDENTIALS_INVALID',
    'TARGET_PARENT_CREDENTIALS_INCOMPLETE',
    'TARGET_PARENT_CREDENTIALS_INVALID',
    'TARGET_PARENT_USERNAME_MISSING',
    'TARGET_STATE_CHANGED',
    'TARGET_USER_DUPLICATE',
    'TARGET_USER_MISSING',
    'TARGET_USER_UPDATE_FAILED',
    'TARGET_USERS_CURSOR_INVALID',
    'TARGET_USERS_LOAD_FAILED',
    'UPDATETARGETUSER_REQUIRED',
]);

function safeErrorCode(error) {
    const code = String(error?.message || '').split(':')[0].trim();
    if (code === 'UNKNOWN_ARGUMENT' || SAFE_ERROR_CODES.has(code)) return code;
    return 'AUTH_SYNC_FAILED';
}

async function main(argv = process.argv.slice(2)) {
    const options = parseArgs(argv);
    if (options.help) {
        process.stdout.write(`${usage()}\n`);
        return null;
    }
    const result = await syncFeishuAuthToSupabase(createRuntimeDependencies(), options);
    process.stdout.write(`${formatReport(result)}\n`);
    return result;
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`${safeErrorCode(error)}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    AUTH_COLUMNS,
    buildAuthSyncPlan,
    createRuntimeDependencies,
    formatReport,
    main,
    parseArgs,
    safeErrorCode,
    syncFeishuAuthToSupabase,
};
