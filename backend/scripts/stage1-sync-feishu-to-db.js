#!/usr/bin/env node
const { QUESTION_CACHE_TABLE } = require('../config');
const { getRecords } = require('../feishu');
const { createSupabaseMirrorClient } = require('../db/supabase-mirror-client');
const { inspectQuestionCacheRecord, mapQuestionCacheRecord } = require('../db/stage1-mapper');
const { syncQuestionCacheRows } = require('../db/stage1-sync');

async function loadFeishuSnapshot({ getRecordsImpl = getRecords } = {}) {
    return { questionCache: QUESTION_CACHE_TABLE ? await getRecordsImpl(QUESTION_CACHE_TABLE) : [] };
}
async function selectAllRows(db, table, columns) {
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
        const page = await db.select(table, columns, { limit: 1000, offset });
        rows.push(...(page || []));
        if (!page || page.length < 1000) return rows;
    }
}

async function runStage1Sync({ db = createSupabaseMirrorClient(), getRecordsImpl, now = () => new Date().toISOString() } = {}) {
    const syncedAt = now(); const batch = { id: 'stage1-cache-' + syncedAt.replace(/[:.]/g, '-'), syncedAt };
    const snapshot = await loadFeishuSnapshot({ getRecordsImpl });
    const invalidShapeCount = snapshot.questionCache.filter(record => !inspectQuestionCacheRecord(record).valid).length;
    if (snapshot.questionCache.length > 0 && invalidShapeCount / snapshot.questionCache.length > 0.2) throw new Error('NOT_QUESTION_CACHE_SOURCE');
    const [users, words] = await Promise.all([
        selectAllRows(db, 'users', 'id,feishu_record_id,username,learning_level'),
        selectAllRows(db, 'words', 'id,feishu_record_id,user_id,word,level'),
    ]);
    const usersByUsername = new Map(users.map(row => [String(row.username || '').trim().toLowerCase(), row]).filter(([key]) => key));
    const wordsByRecord = new Map(words.filter(row => row.feishu_record_id).map(row => [String(row.feishu_record_id), row]));
    const wordsByUserWord = new Map(words.map(row => [String(row.user_id) + String.fromCharCode(0) + String(row.word || '').trim().toLowerCase(), row]));
    const lookups = { usersByUsername, wordsByRecord, wordsByUserWord };
    const mapped = snapshot.questionCache.map(record => mapQuestionCacheRecord(record, batch, lookups));
    const invalidRows = snapshot.questionCache.length - mapped.filter(Boolean).length;
    const result = await syncQuestionCacheRows(db, mapped);
    return { batch, result, sourceCount: snapshot.questionCache.length, syncedCount: result.count, invalidRows };
}
if (require.main === module) runStage1Sync().then(value => console.log(JSON.stringify(value, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { loadFeishuSnapshot, runStage1Sync };
