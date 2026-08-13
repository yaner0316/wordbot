'use strict';

const { createClient } = require('@supabase/supabase-js');
const { auditQuestionGenerationBacklog } = require('../question-generation-backlog-audit');

const PAGE_SIZE = 1000;

async function readAll(client, table, columns) {
    const rows = [];
    let afterId = null;
    for (;;) {
        let query = client.from(table).select(columns).order('id', { ascending: true });
        if (afterId !== null) query = query.gt('id', afterId);
        const { data, error } = await query.limit(PAGE_SIZE);
        if (error) throw new Error('QUESTION_GENERATION_BACKLOG_AUDIT_FAILED');
        const page = data || [];
        rows.push(...page);
        if (page.length < PAGE_SIZE) return rows;
        const nextAfterId = page[page.length - 1]?.id;
        if (!nextAfterId || nextAfterId === afterId) throw new Error('QUESTION_GENERATION_BACKLOG_AUDIT_FAILED');
        afterId = nextAfterId;
    }
}

async function collectQuestionGenerationBacklogAudit(client) {
    if (!client || typeof client.from !== 'function') throw new Error('QUESTION_GENERATION_BACKLOG_AUDIT_FAILED');
    const [users, words, cacheRows, jobs] = await Promise.all([
        readAll(client, 'users', 'id,username'),
        readAll(client, 'words', 'id,user_id,word,mastery_status,question_generation_version'),
        readAll(client, 'question_cache', 'id,user_id,word_id,round_type,quality_status,cache_state,question_type,variant_slot'),
        readAll(client, 'question_generation_jobs', 'id,user_id,word_id,word_version,status,reason,attempt_count,next_attempt_at,lease_expires_at,last_error_code'),
    ]);
    return auditQuestionGenerationBacklog({ users, words, cacheRows, jobs });
}

function formatAuditError(error) {
    return error && error.message === 'SUPABASE_READ_CREDENTIALS_REQUIRED'
        ? error.message
        : 'QUESTION_GENERATION_BACKLOG_AUDIT_FAILED';
}

async function main() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_READ_CREDENTIALS_REQUIRED');
    const client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    const report = await collectQuestionGenerationBacklogAudit(client);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) main().catch(error => {
    process.stderr.write(`${formatAuditError(error)}\n`);
    process.exitCode = 1;
});

module.exports = {
    PAGE_SIZE,
    readAll,
    collectQuestionGenerationBacklogAudit,
    formatAuditError,
};
