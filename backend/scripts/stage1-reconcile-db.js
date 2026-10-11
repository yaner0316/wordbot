#!/usr/bin/env node
const { WORD_TABLE, TEST_TABLE, STATS_TABLE, QUESTION_CACHE_TABLE } = require('../config');
const { getRecords } = require('../feishu');
const { createSupabaseMirrorClient } = require('../db/supabase-mirror-client');
const { buildReconciliationReport } = require('../db/stage1-reconcile');
async function runStage1Reconciliation({ db = createSupabaseMirrorClient(), getRecordsImpl = getRecords } = {}) {
    const [words, tests, stats, questionCache, users] = await Promise.all([getRecordsImpl(WORD_TABLE), getRecordsImpl(TEST_TABLE), getRecordsImpl(STATS_TABLE), QUESTION_CACHE_TABLE ? getRecordsImpl(QUESTION_CACHE_TABLE) : Promise.resolve([]), db.select('users', 'id,username')]);
    const snapshot = { words, tests, stats, questionCache };
    const usersById = new Map(users.map(row => [String(row.id), row]));
    const databaseRows = [];
    for (let offset = 0; ; offset += 1000) {
        const page = await db.select('question_cache', '*', { limit: 1000, offset });
        databaseRows.push(...page.map(row => ({ ...row, user_key: usersById.get(String(row.user_id))?.username?.trim().toLowerCase() || null })));
        if (page.length < 1000) break;
    }
    return buildReconciliationReport({ feishuSnapshot: snapshot, databaseRows });
}
if (require.main === module) runStage1Reconciliation().then(value => console.log(JSON.stringify(value, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { runStage1Reconciliation };
