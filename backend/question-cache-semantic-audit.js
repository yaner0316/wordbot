const { getQuestionQualityIssues, hasMeaningfulChineseMeaning } = require('./question-quality');

const MULTI_ANSWER_READINESS_ISSUES = new Set([
    'ambiguous_elementary_context',
    'ambiguous_fill_in_context',
    'distractor_form_overlap',
    'duplicate_option_meanings',
    'overlapping_option_meanings',
]);

function parseList(value) {
    if (Array.isArray(value)) return { value, valid: true };
    try {
        const parsed = JSON.parse(String(value || ''));
        return { value: Array.isArray(parsed) ? parsed : [], valid: Array.isArray(parsed) };
    } catch (_) {
        return { value: [], valid: false };
    }
}

function countByReason(items) {
    const counts = new Map();
    for (const item of items) {
        for (const reason of item.reasons) counts.set(reason, (counts.get(reason) || 0) + 1);
    }
    return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function getDuplicateOptionMeaningIssue(optionMeanings) {
    const normalized = optionMeanings.map(value => String(value || '').trim().toLowerCase());
    return new Set(normalized).size === normalized.length ? [] : ['duplicate_option_meanings'];
}

function auditQuestionCacheRows(rows, users = []) {
    const usernames = new Map(users.map(user => [String(user.id), String(user.username || user.id)]));
    const affected = [];
    let eligibleScanned = 0;
    for (const row of rows || []) {
        if (row.quality_status !== 'ready' || !['active', 'reserved_next_day'].includes(String(row.cache_state || 'active'))) continue;
        eligibleScanned += 1;
        const options = parseList(row.options).value;
        const optionMeanings = parseList(row.option_meanings);
        const reasons = [];
        if (String(row.ai_audit_status || '').trim().toLowerCase() !== 'approved') {
            reasons.push('not_ai_approved');
        }
        const hasCompleteOptionMeanings = optionMeanings.valid
            && optionMeanings.value.length === 4
            && optionMeanings.value.every(value => hasMeaningfulChineseMeaning(value));
        if (!hasCompleteOptionMeanings) {
            reasons.push('missing_option_meanings', 'unauditable');
        }
        const readinessIssues = getQuestionQualityIssues({
            type: Number(row.question_type) || 1,
            level: row.level || '', word: row.word || row.word_snapshot || '',
            context: row.question_text || '', options, answer: row.answer || '',
            optionMeanings: optionMeanings.value, correctMeaning: row.correct_meaning || '',
        }).filter(issue => MULTI_ANSWER_READINESS_ISSUES.has(issue));
        if (hasCompleteOptionMeanings) {
            readinessIssues.push(...getDuplicateOptionMeaningIssue(optionMeanings.value));
        }
        reasons.push(...readinessIssues);
        const uniqueReasons = [...new Set(reasons)];
        if (uniqueReasons.length) affected.push({
            user: usernames.get(String(row.user_id)) || String(row.user_id || ''),
            cacheId: String(row.id || ''), word: String(row.word || row.word_snapshot || ''),
            reasons: uniqueReasons, sourceVersion: String(row.source_version || ''), aiAuditStatus: String(row.ai_audit_status || ''),
        });
    }
    const byUser = {};
    for (const item of affected) byUser[item.user] = (byUser[item.user] || 0) + 1;
    const byReason = countByReason(affected);
    const multiAnswerReadinessIssues = Object.fromEntries(Object.entries(byReason)
        .filter(([reason]) => MULTI_ANSWER_READINESS_ISSUES.has(reason)));
    return {
        scanned: (rows || []).length,
        eligibleScanned,
        affectedCount: affected.length,
        allEligibleAudited: !byReason.unauditable && !byReason.not_ai_approved,
        byReason,
        multiAnswerReadinessIssues,
        byUser,
        affected,
    };
}

module.exports = { auditQuestionCacheRows };
