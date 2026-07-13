#!/usr/bin/env node
const { QUESTION_CACHE_TABLE } = require('../config');
const { getRecords } = require('../feishu');
const { createSupabaseMirrorClient } = require('../db/supabase-mirror-client');
const { mapQuestionCacheRecord } = require('../db/stage1-mapper');
const { syncQuestionCacheRows } = require('../db/stage1-sync');

async function loadFeishuSnapshot({ getRecordsImpl = getRecords } = {}) {
    return { questionCache: QUESTION_CACHE_TABLE ? await getRecordsImpl(QUESTION_CACHE_TABLE) : [] };
}
async function runStage1Sync({ db = createSupabaseMirrorClient(), getRecordsImpl, now = () => new Date().toISOString() } = {}) {
    const syncedAt = now(); const batch = { id: 'stage1-cache-' + syncedAt.replace(/[:.]/g, '-'), syncedAt };
    const snapshot = await loadFeishuSnapshot({ getRecordsImpl });
    const mapped = snapshot.questionCache.map(record => mapQuestionCacheRecord(record, batch));
    const invalidRows = snapshot.questionCache.length - mapped.filter(Boolean).length;
    const result = await syncQuestionCacheRows(db, mapped);
    return { batch, result, sourceCount: snapshot.questionCache.length, syncedCount: result.count, invalidRows };
}
if (require.main === module) runStage1Sync().then(value => console.log(JSON.stringify(value, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { loadFeishuSnapshot, runStage1Sync };
