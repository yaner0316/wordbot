const { createClient } = require('@supabase/supabase-js');
const { auditQuestionCacheRows } = require('../question-cache-semantic-audit');

async function readAll(client, table, columns) {
    const rows = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await client.from(table).select(columns).range(from, from + 999);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < 1000) return rows;
    }
}

async function main() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_READ_CREDENTIALS_REQUIRED');
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const [rows, users] = await Promise.all([
        readAll(client, 'question_cache', 'id,user_id,word,level,quality_status,cache_state,question_type,question_text,options,answer,option_meanings,correct_meaning,source_version,ai_audit_status'),
        readAll(client, 'users', 'id,username'),
    ]);
    process.stdout.write(JSON.stringify(auditQuestionCacheRows(rows, users), null, 2) + '\n');
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
