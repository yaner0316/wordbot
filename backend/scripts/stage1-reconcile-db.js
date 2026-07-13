#!/usr/bin/env node
const { WORD_TABLE, TEST_TABLE, STATS_TABLE, QUESTION_CACHE_TABLE } = require('../config');
const { getRecords } = require('../feishu');
const { createSupabaseMirrorClient } = require('../db/supabase-mirror-client');
const { buildReconciliationReport } = require('../db/stage1-reconcile');
async function runStage1Reconciliation({ db = createSupabaseMirrorClient(), getRecordsImpl = getRecords } = {}) {
    const [words, tests, stats, questionCache] = await Promise.all([getRecordsImpl(WORD_TABLE), getRecordsImpl(TEST_TABLE), getRecordsImpl(STATS_TABLE), QUESTION_CACHE_TABLE ? getRecordsImpl(QUESTION_CACHE_TABLE) : Promise.resolve([])]);
    const snapshot = { words, tests, stats, questionCache };
    const databaseRows = await db.select('question_cache');
    return buildReconciliationReport({ feishuSnapshot: snapshot, databaseRows });
}
if (require.main === module) runStage1Reconciliation().then(value => console.log(JSON.stringify(value, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { runStage1Reconciliation };
