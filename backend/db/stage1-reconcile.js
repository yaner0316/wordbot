const { collectUserAliases, findDuplicateMeanings, firstField, normalizeUserKey } = require('./stage1-mapper');

function emptyUser() { return { feishu: { words: 0, tests: 0, questionCache: 0 }, database: { words: 0, tests: 0, questionCache: 0 }, diff: { words: null, tests: null, questionCache: 0 }, questionCacheByLevelStatus: {} }; }
function ensure(report, key) { return report.users[key] || (report.users[key] = emptyUser()); }
function cacheStatus(fields) { return firstField(fields, ['quality_status', 'qualityStatus', 'status', 'Status']) || 'unknown'; }
function addBreakdown(target, level, status, side) {
    const l = level || 'unknown'; const s = status || 'unknown';
    target[l] ||= {}; target[l][s] ||= { feishu: 0, database: 0, diff: 0 }; target[l][s][side] += 1; target[l][s].diff = target[l][s].feishu - target[l][s].database;
}
function buildReconciliationReport({ feishuSnapshot, databaseRows }) {
    const cache = feishuSnapshot.questionCache || [];
    const db = databaseRows || [];
    const sourceIds = new Set(cache.map(row => String(row.record_id || row.recordId || '')).filter(Boolean));
    const trackedDb = db.filter(row => row.feishu_record_id);
    const trackedDbIds = new Set(trackedDb.map(row => String(row.feishu_record_id)));
    const sourceOnlyQuestionCache = [...sourceIds].filter(id => !trackedDbIds.has(id));
    const databaseOnlyQuestionCache = [...trackedDbIds].filter(id => !sourceIds.has(id));
    const untrackedDatabaseRows = db.filter(row => !row.feishu_record_id);
    const report = {
        generatedAt: new Date().toISOString(),
        totals: { questionCache: { feishu: cache.length, database: trackedDb.length, diff: cache.length - trackedDb.length } },
        databaseOnlyQuestionCache,
        sourceOnly: {
            questionCache: { count: sourceOnlyQuestionCache.length, ids: sourceOnlyQuestionCache },
            words: { feishu: (feishuSnapshot.words || []).length, database: null, diff: null },
            tests: { feishu: (feishuSnapshot.tests || []).length, database: null, diff: null },
        },
        users: {},
        duplicateUsers: collectUserAliases([...(feishuSnapshot.words || []), ...(feishuSnapshot.tests || []), ...cache, ...(feishuSnapshot.stats || [])]).filter(item => item.originalUsers.length > 1).map(({ userKey, originalUsers }) => ({ userKey, originalUsers })),
        duplicateMeanings: findDuplicateMeanings(feishuSnapshot.words || []),
        risks: [],
    };
    for (const row of feishuSnapshot.words || []) {
        const key = normalizeUserKey(row.fields?.user);
        if (key) ensure(report, key).feishu.words += 1;
    }
    for (const row of feishuSnapshot.tests || []) {
        const key = normalizeUserKey(row.fields?.user);
        if (key) ensure(report, key).feishu.tests += 1;
    }
    for (const row of cache) {
        const key = normalizeUserKey(row.fields?.user);
        if (!key) continue;
        const user = ensure(report, key);
        user.feishu.questionCache += 1;
        addBreakdown(user.questionCacheByLevelStatus, firstField(row.fields, ['level', 'learning_level', 'learningLevel']), cacheStatus(row.fields || row), 'feishu');
    }
    for (const row of trackedDb) {
        const key = normalizeUserKey(row.user_key) || 'unknown';
        const user = ensure(report, key);
        user.database.questionCache += 1;
        addBreakdown(user.questionCacheByLevelStatus, row.level, row.quality_status || row.status || 'unknown', 'database');
    }
    for (const user of Object.values(report.users)) user.diff.questionCache = user.feishu.questionCache - user.database.questionCache;
    if (report.totals.questionCache.diff) report.risks.push({ code: 'COUNT_DIFF', type: 'questionCache', diff: report.totals.questionCache.diff });
    if (report.databaseOnlyQuestionCache.length) report.risks.push({ code: 'ORPHAN_CACHE', message: 'Database cache rows no longer exist in the current Feishu snapshot; Stage 1 does not delete them', count: report.databaseOnlyQuestionCache.length });
    if (untrackedDatabaseRows.length) report.risks.push({ code: 'UNTRACKED_DATABASE_CACHE', message: 'Existing database question_cache rows have no feishu_record_id and are excluded from mirror comparison', count: untrackedDatabaseRows.length });
    if (report.sourceOnly.words.feishu || report.sourceOnly.tests.feishu) report.risks.push({ code: 'NOT_MIRRORED', message: 'Words and tests are reported from Feishu but have no Stage 1 database mirror yet' });
    if (report.duplicateUsers.length) report.risks.push({ code: 'DUPLICATE_USER_CASE', message: 'User casing aliases were merged in the report' });
    if (report.duplicateMeanings.length) report.risks.push({ code: 'DUPLICATE_MEANING', message: 'Duplicate word/meaning rows exist in Feishu' });
    return report;
}module.exports = { buildReconciliationReport };
