const { createClient } = require('@supabase/supabase-js');
const { auditQuestionCacheRows } = require('../question-cache-semantic-audit');

async function readAll(client, table, columns) {
    const rows = [];
    let lastId = null;
    for (;;) {
        let query = client.from(table).select(columns).order('id', { ascending: true });
        if (lastId !== null) query = query.gt('id', lastId);
        const { data, error } = await query.limit(1000);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < 1000) return rows;
        lastId = String(data[data.length - 1].id);
    }
}

async function collectQuestionCacheSemanticAudit(client) {
    const [rows, users, words] = await Promise.all([
        readAll(client, 'question_cache', 'id,user_id,word_id,level,quality_status,cache_state,question_type,question_text,options,answer,option_meanings,correct_meaning,source_version,ai_audit_status'),
        readAll(client, 'users', 'id,username'),
        readAll(client, 'words', 'id,word'),
    ]);
    const wordsById = new Map(words.map(word => [String(word.id), String(word.word || '')]));
    const audit = auditQuestionCacheRows(rows.map(row => ({
        ...row,
        word: wordsById.get(String(row.word_id)) || '',
    })), users);
    return {
        scanned: audit.scanned,
        eligibleScanned: audit.eligibleScanned,
        affected: audit.affectedCount,
        affectedCount: audit.affectedCount,
        allEligibleAudited: audit.allEligibleAudited,
        byReason: audit.byReason,
        multiAnswerReadinessIssues: audit.multiAnswerReadinessIssues,
        byUser: audit.byUser,
        items: audit.affected,
    };
}

async function main() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_READ_CREDENTIALS_REQUIRED');
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const report = await collectQuestionCacheSemanticAudit(client);
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

function formatAuditError(error) {
    return error && error.message === 'SUPABASE_READ_CREDENTIALS_REQUIRED'
        ? error.message
        : 'QUESTION_CACHE_SEMANTIC_AUDIT_FAILED';
}

if (require.main === module) main().catch(error => {
    console.error(formatAuditError(error));
    process.exitCode = 1;
});

module.exports = { readAll, collectQuestionCacheSemanticAudit, formatAuditError };
