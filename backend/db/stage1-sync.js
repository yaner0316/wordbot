async function syncQuestionCacheRows(db, rows) {
    const validRows = (rows || []).filter(Boolean);
    if (validRows.length === 0) return { table: 'question_cache', count: 0, conflictKey: 'feishu_record_id' };
    await db.upsert('question_cache', validRows, 'feishu_record_id');
    return { table: 'question_cache', count: validRows.length, conflictKey: 'feishu_record_id' };
}

module.exports = { syncQuestionCacheRows };
