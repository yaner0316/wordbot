const crypto = require('crypto');
const { getQuestionQualityIssues, hasMeaningfulChineseMeaning, isQuestionQualityAcceptable } = require('./question-quality');

const QUESTION_CACHE_STATUS = {
    PENDING: 'pending',
    READY: 'ready',
    FAILED: 'failed',
    STALE: 'stale',
};

function stringify(value) {
    return typeof value === 'string' ? value : JSON.stringify(value || []);
}

function parseJsonList(value) {
    if (Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(String(value || '[]'));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return String(value || '').split(/\n|\|/).map(item => item.trim()).filter(Boolean);
    }
}

const OPTION_MEANING_FAILURE_PREFIX = String.fromCharCode(0x4e2d, 0x6587, 0x91ca, 0x4e49, 0x8865, 0x5145);

function userKey(value) {
    return String(value || '').trim().toLowerCase();
}

function buildCacheQuestionFields({ question, sourceVersion, now = Date.now() }) {
    return {
        question_type: question.type,
        question_text: question.context,
        context_cn: question.contextCN || '',
        suffix: question.suffix || '',
        options: stringify(question.options),
        answer: question.answer,
        option_meanings: stringify(question.optionMeanings),
        correct_meaning: question.correctMeaning || '',
        quality_status: QUESTION_CACHE_STATUS.READY,
        ai_audit_status: 'skipped',
        used_count: 0,
        last_used_at: '',
        generated_at: now,
        source_version: sourceVersion || 'v1',
    };
}

function buildCacheRow({ userId, level, roundType, question, sourceVersion, now }) {
    return {
        user: userId,
        word_record_id: question.record_id,
        word: question.word,
        level,
        round_type: roundType,
        ...buildCacheQuestionFields({ question, sourceVersion, now }),
    };
}

function buildCacheRowsForRecord({ userId, level, primaryQuestion, reviewQuestion, sourceVersion = 'v1', now = Date.now() }) {
    const rows = [];
    if (primaryQuestion) {
        rows.push(buildCacheRow({ userId, level, roundType: 'primary', question: primaryQuestion, sourceVersion, now }));
    }
    if (reviewQuestion) {
        rows.push(buildCacheRow({ userId, level, roundType: 'review', question: reviewQuestion, sourceVersion, now }));
    }
    return rows;
}

const OPTIONAL_FEISHU_CACHE_FIELDS = new Set([
    'context_cn',
    'suffix',
    'ai_audit_status',
    'last_used_at',
    'source_version',
]);

function stripOptionalQuestionCacheFields(row, fieldsToStrip = OPTIONAL_FEISHU_CACHE_FIELDS) {
    const fields = new Set(fieldsToStrip);
    const stripped = {};
    for (const [key, value] of Object.entries(row || {})) {
        if (!fields.has(key)) stripped[key] = value;
    }
    return stripped;
}

function normalizeCacheRow(row) {
    const fields = row.fields || row;
    return {
        recordId: row.record_id || row.recordId || '',
        user: fields.user || '',
        wordRecordId: fields.word_record_id || '',
        word: fields.word || '',
        type: Number(fields.question_type) || 1,
        level: fields.level || '',
        roundType: fields.round_type || 'primary',
        qualityStatus: fields.quality_status || QUESTION_CACHE_STATUS.PENDING,
        usedCount: Number(fields.used_count || 0),
        generatedAt: Number(fields.generated_at || 0),
        question: {
            record_id: fields.word_record_id || '',
            type: Number(fields.question_type) || 1,
            word: fields.word || '',
            level: fields.level || '',
            context: fields.question_text || '',
            contextCN: fields.context_cn || '',
            suffix: fields.suffix || '',
            options: parseJsonList(fields.options),
            answer: fields.answer || '',
            optionMeanings: parseJsonList(fields.option_meanings),
            correctMeaning: fields.correct_meaning || '',
        },
    };
}

function isFailedOptionMeaning(value) {
    const text = String(value || '').trim();
    return text.startsWith(OPTION_MEANING_FAILURE_PREFIX) || text.startsWith('涓枃閲婁箟琛ュ厖');
}

function getCacheQuestionReadinessIssues(row) {
    const normalized = row && row.question ? row : normalizeCacheRow(row);
    const question = normalized.question || {};
    const issues = [];
    if (normalized.qualityStatus !== QUESTION_CACHE_STATUS.READY) issues.push('not_ready_status');
    if (!question.record_id) issues.push('missing_record_id');
    if (!question.word) issues.push('missing_word');
    if (!String(question.context || '').trim()) issues.push('missing_context');
    if (!['A', 'B', 'C', 'D'].includes(question.answer)) issues.push('bad_answer');
    if (!Array.isArray(question.options) || question.options.length !== 4) {
        issues.push('bad_options');
    } else if (!question.options.every(option => /^[A-D]\.\s+\S/.test(String(option || '')))) {
        issues.push('bad_option_format');
    }
    issues.push(...getQuestionQualityIssues(question));
    if (!Array.isArray(question.optionMeanings) || question.optionMeanings.length !== 4) {
        issues.push('bad_option_meanings');
    } else if (!question.optionMeanings.every(meaning => {
        const value = String(meaning || '').trim();
        return hasMeaningfulChineseMeaning(value) && !isFailedOptionMeaning(value);
    })) {
        issues.push('bad_option_meanings');
    }
    return [...new Set(issues)];
}

function isCacheQuestionReady(row) {
    return getCacheQuestionReadinessIssues(row).length === 0;
}
function getTypePolicy(level, limit) {
    const elementaryLevel = String.fromCharCode(0x5c0f, 0x5b66);
    const juniorHighLevel = String.fromCharCode(0x4e2d, 0x5b66);
    const normalizedLevel = String(level || '').trim();
    if (normalizedLevel === elementaryLevel) return { quota: { 1: limit, 2: 0, 3: 0 }, allowed: new Set([1]) };
    if (normalizedLevel === juniorHighLevel) return { quota: { 1: 9, 2: 0, 3: 1 }, allowed: new Set([1, 3]) };
    return { quota: { 1: 7, 2: 2, 3: 1 }, allowed: new Set([1, 2, 3]) };
}

function questionSignature(row) {
    const question = row.question || {};
    return [
        row.type,
        String(row.word || '').trim().toLowerCase(),
        String(question.context || '').trim().toLowerCase().replace(/\s+/g, ' '),
        JSON.stringify(question.options || []),
    ].join('|');
}

function shuffleRows(rows) {
    const result = [...rows];
    for (let i = result.length - 1; i > 0; i--) {
        const j = crypto.randomInt(0, i + 1);
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

function shuffleWithinUsedCount(rows) {
    const groups = new Map();
    for (const row of rows) {
        if (!groups.has(row.usedCount)) groups.set(row.usedCount, []);
        groups.get(row.usedCount).push(row);
    }
    return [...groups.keys()]
        .sort((a, b) => a - b)
        .flatMap(usedCount => shuffleRows(groups.get(usedCount)));
}
function dedupeSelectableRows(rows) {
    const selectedKeys = new Set();
    const selectedWordRecordIds = new Set();
    const selectedQuestionSignatures = new Set();
    const result = [];
    for (const row of rows) {
        const key = row.recordId || row.wordRecordId || `${row.word}:${row.type}`;
        const wordRecordId = String(row.wordRecordId || '').trim();
        const signature = wordRecordId ? '' : questionSignature(row);
        if (selectedKeys.has(key)) continue;
        if (wordRecordId && selectedWordRecordIds.has(wordRecordId)) continue;
        if (signature && selectedQuestionSignatures.has(signature)) continue;
        result.push(row);
        selectedKeys.add(key);
        if (wordRecordId) selectedWordRecordIds.add(wordRecordId);
        else selectedQuestionSignatures.add(signature);
    }
    return result;
}

function buildSelectableCachePool({ rows, userId, level, roundType = 'primary', excludedRecordIds = new Set() }) {
    const targetUserKey = userKey(userId);
    const normalizedExcluded = new Set([...excludedRecordIds].map(id => String(id || '').trim()).filter(Boolean));
    const eligible = (rows || [])
        .map(normalizeCacheRow)
        .filter(row => userKey(row.user) === targetUserKey && row.level === level && row.roundType === roundType)
        .filter(row => row.qualityStatus === QUESTION_CACHE_STATUS.READY)
        .filter(row => isCacheQuestionReady(row))
        .filter(row => !normalizedExcluded.has(String(row.wordRecordId || '').trim()));
    return dedupeSelectableRows(shuffleWithinUsedCount(eligible));
}

function selectRowsFromFrontier(frontier, { level, limit }) {
    const { quota, allowed } = getTypePolicy(level, limit);
    const counts = { 1: 0, 2: 0, 3: 0 };
    const selected = [];
    const selectedIds = new Set();
    function select(row) {
        selected.push(row);
        selectedIds.add(row.recordId || row.wordRecordId || `${row.word}:${row.type}`);
        counts[row.type] = (counts[row.type] || 0) + 1;
    }
    for (const row of frontier) {
        if (selected.length >= limit) break;
        if (!allowed.has(row.type)) continue;
        if ((counts[row.type] || 0) < (quota[row.type] || 0)) select(row);
    }
    if (selected.length < limit) {
        for (const row of frontier) {
            if (selected.length >= limit) break;
            const key = row.recordId || row.wordRecordId || `${row.word}:${row.type}`;
            if (!allowed.has(row.type) || selectedIds.has(key)) continue;
            select(row);
        }
    }
    return selected;
}

function rowToQuestion(row) {
    return {
        ...row.question,
        cacheRecordId: row.recordId,
        cacheUsedCount: row.usedCount,
    };
}

function analyzeReadyCachedQuestions({ rows, userId, level, roundType = 'primary', limit = 10, excludedRecordIds = new Set() }) {
    const pool = buildSelectableCachePool({ rows, userId, level, roundType, excludedRecordIds });
    if (pool.length === 0) {
        return { questions: [], poolCount: 0, minUsed: null, frontierCount: 0, exhausted: false, notReady: true };
    }
    const minUsed = Math.min(...pool.map(row => row.usedCount));
    if (pool.length < limit) {
        return { questions: [], poolCount: pool.length, minUsed, frontierCount: pool.length, exhausted: false, notReady: true };
    }
    if (minUsed >= 1) {
        return { questions: [], poolCount: pool.length, minUsed, frontierCount: 0, exhausted: true, notReady: false };
    }
    const frontier = pool.filter(row => row.usedCount === minUsed);
    if (frontier.length < limit) {
        return { questions: [], poolCount: pool.length, minUsed, frontierCount: frontier.length, exhausted: true, notReady: false };
    }
    const selected = selectRowsFromFrontier(frontier, { level, limit });
    if (selected.length < limit) {
        return { questions: [], poolCount: pool.length, minUsed, frontierCount: frontier.length, exhausted: true, notReady: false };
    }
    return {
        questions: selected.map(rowToQuestion),
        poolCount: pool.length,
        minUsed,
        frontierCount: frontier.length,
        exhausted: false,
        notReady: false,
    };
}

function selectReadyCachedQuestions(options) {
    return analyzeReadyCachedQuestions(options).questions;
}
function incrementSummary(bucket, row) {
    if (!bucket[row.level]) bucket[row.level] = { total: 0, ready: 0 };
    bucket[row.level].total += 1;
    if (isCacheQuestionReady(row)) bucket[row.level].ready += 1;
}

function summarizeCacheStatus(rows) {
    const normalized = (rows || []).map(normalizeCacheRow);
    const summary = { total: normalized.length, ready: 0, byLevel: {}, byRoundType: {} };
    for (const row of normalized) {
        if (isCacheQuestionReady(row)) summary.ready += 1;
        incrementSummary(summary.byLevel, row);
        if (!summary.byRoundType[row.roundType]) summary.byRoundType[row.roundType] = { total: 0, ready: 0 };
        summary.byRoundType[row.roundType].total += 1;
        if (isCacheQuestionReady(row)) summary.byRoundType[row.roundType].ready += 1;
    }
    return summary;
}

module.exports = {
    QUESTION_CACHE_STATUS,
    buildCacheRowsForRecord,
    buildCacheQuestionFields,
    getCacheQuestionReadinessIssues,
    isCacheQuestionReady,
    normalizeCacheRow,
    selectReadyCachedQuestions,
    analyzeReadyCachedQuestions,
    stripOptionalQuestionCacheFields,
    summarizeCacheStatus,
};
