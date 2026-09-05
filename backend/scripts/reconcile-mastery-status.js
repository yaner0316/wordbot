'use strict';

const { reconcileMasteryStatus } = require('../mastery-status-reconciliation');

const PAGE_SIZE = 1000;

function normalizeId(value) {
    return String(value || '').trim();
}

function parseArgs(argv = []) {
    const parsed = { apply: false, userId: null, planFingerprint: null, help: false };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--apply') {
            parsed.apply = true;
        } else if (argument === '--help' || argument === '-h') {
            parsed.help = true;
        } else if (argument === '--user-id') {
            const value = normalizeId(argv[index + 1]);
            if (!value || value.startsWith('--')) throw new Error('USER_ID_VALUE_REQUIRED');
            parsed.userId = value;
            index += 1;
        } else if (argument === '--plan-fingerprint') {
            const value = normalizeId(argv[index + 1]).toLowerCase();
            if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('PLAN_FINGERPRINT_VALUE_INVALID');
            parsed.planFingerprint = value;
            index += 1;
        } else {
            throw new Error(`UNKNOWN_ARGUMENT: ${argument}`);
        }
    }
    if (parsed.apply && !parsed.planFingerprint) throw new Error('PLAN_FINGERPRINT_REQUIRED');
    if (!parsed.apply && parsed.planFingerprint) throw new Error('APPLY_REQUIRED');
    return parsed;
}

async function loadAllRows(client, table, columns, userId) {
    const rows = [];
    let lastId = null;
    for (;;) {
        let query = client.from(table).select(columns);
        if (userId) query = query.eq('user_id', userId);
        if (lastId !== null) query = query.gt('id', lastId);
        query = query.order('id', { ascending: true }).limit(PAGE_SIZE);
        const { data, error } = await query;
        if (error) throw new Error(`${table.toUpperCase()}_LOAD_FAILED`);
        const page = data || [];
        rows.push(...page);
        if (page.length < PAGE_SIZE) return rows;
        const nextId = page.at(-1)?.id;
        if (!nextId || String(nextId) === String(lastId)) throw new Error(`${table.toUpperCase()}_KEYSET_CURSOR_INVALID`);
        lastId = nextId;
    }
}

function createSupabaseDependencies(client) {
    if (!client || typeof client.from !== 'function' || typeof client.rpc !== 'function') {
        throw new Error('SUPABASE_CLIENT_REQUIRED');
    }
    return {
        loadWords: ({ userId } = {}) => loadAllRows(
            client,
            'words',
            'id,user_id,feishu_record_id,mastery_status,remembered_at',
            userId,
        ),
        loadAssessments: ({ userId } = {}) => loadAllRows(
            client,
            'assessments',
            'id,user_id,word_id,source_word_record_id,test_id,assessment_kind,is_real_assessment,assessed_at,created_at,question_type,question_text,is_correct,submitted_answer,answer_confidence',
            userId,
        ),
        async applyWord(change) {
            const result = await client.rpc('reconcile_word_mastery_status', {
                p_user_id: change.userId,
                p_word_id: change.wordId,
                p_expected_mastery_status: change.storedStatus,
                p_expected_remembered_at: change.storedRememberedAt,
                p_new_mastery_status: change.expectedStatus,
                p_new_remembered_at: change.expectedRememberedAt,
            });
            if (result.error) throw new Error('WORD_RECONCILIATION_FAILED');
            if (result.data !== true) throw new Error('WORD_STATE_CHANGED');
            return true;
        },
    };
}

function usage() {
    return [
        'Usage: node backend/scripts/reconcile-mastery-status.js [--user-id UUID] [--apply --plan-fingerprint SHA256]',
        '',
        'Default mode is strictly read-only. Review the dry-run planFingerprint before apply.',
    ].join('\n');
}

async function main(argv = process.argv.slice(2)) {
    const options = parseArgs(argv);
    if (options.help) {
        process.stdout.write(`${usage()}\n`);
        return null;
    }
    const client = require('../supabase-client');
    const result = await reconcileMasteryStatus(createSupabaseDependencies(client), options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.failed > 0) process.exitCode = 1;
    return result;
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`${String(error?.message || 'MASTERY_RECONCILIATION_FAILED').split(':')[0]}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    createSupabaseDependencies,
    main,
    parseArgs,
};
