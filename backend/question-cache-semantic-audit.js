const { getQuestionQualityIssues } = require('./question-quality');

function parseList(value) {
    if (Array.isArray(value)) return value;
    try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed : []; } catch (_) { return []; }
}

function auditQuestionCacheRows(rows, users = []) {
    const usernames = new Map(users.map(user => [String(user.id), String(user.username || user.id)]));
    const affected = [];
    for (const row of rows || []) {
        if (row.quality_status !== 'ready' || !['active', 'reserved_next_day'].includes(String(row.cache_state || 'active'))) continue;
        const issues = getQuestionQualityIssues({
            type: Number(row.question_type) || 1,
            level: row.level || '', word: row.word || row.word_snapshot || '',
            context: row.question_text || '', options: parseList(row.options), answer: row.answer || '',
            optionMeanings: parseList(row.option_meanings), correctMeaning: row.correct_meaning || '',
        }).filter(issue => issue === 'overlapping_option_meanings');
        if (issues.length) affected.push({
            user: usernames.get(String(row.user_id)) || String(row.user_id || ''),
            cacheId: String(row.id || ''), word: String(row.word || row.word_snapshot || ''),
            reasons: issues, sourceVersion: String(row.source_version || ''), aiAuditStatus: String(row.ai_audit_status || ''),
        });
    }
    const byUser = {};
    for (const item of affected) byUser[item.user] = (byUser[item.user] || 0) + 1;
    return { scanned: (rows || []).length, affectedCount: affected.length, byUser, affected };
}

module.exports = { auditQuestionCacheRows };
