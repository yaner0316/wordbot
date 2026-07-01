const { isQuestionQualityAcceptable } = require('./question-quality');

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

function userKey(value) {
    return String(value || '').trim().toLowerCase();
}

function buildCacheRow({ userId, level, roundType, question, sourceVersion, now }) {
    return {
        user: userId,
        word_record_id: question.record_id,
        word: question.word,
        question_type: question.type,
        level,
        round_type: roundType,
        question_text: question.context,
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

function buildCacheRowsForRecord({ userId, level, primaryQuestion, reviewQuestion, sourceVersion = 'v1', now = Date.now() }) {
    return [
        buildCacheRow({ userId, level, roundType: 'primary', question: primaryQuestion, sourceVersion, now }),
        buildCacheRow({ userId, level, roundType: 'review', question: reviewQuestion, sourceVersion, now }),
    ];
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
            context: fields.question_text || '',
            suffix: fields.suffix || '',
            options: parseJsonList(fields.options),
            answer: fields.answer || '',
            optionMeanings: parseJsonList(fields.option_meanings),
            correctMeaning: fields.correct_meaning || '',
        },
    };
}

function isCacheQuestionReady(row) {
    const normalized = row && row.question ? row : normalizeCacheRow(row);
    const question = normalized.question;
    return normalized.qualityStatus === QUESTION_CACHE_STATUS.READY &&
        Boolean(question.record_id) &&
        Boolean(question.word) &&
        Boolean(String(question.context || '').trim()) &&
        ['A', 'B', 'C', 'D'].includes(question.answer) &&
        Array.isArray(question.options) &&
        question.options.length === 4 &&
        question.options.every(option => /^[A-D]\.\s+\S/.test(String(option || ''))) &&
        isQuestionQualityAcceptable(question) &&
        Array.isArray(question.optionMeanings) &&
        question.optionMeanings.length === 4 &&
        question.optionMeanings.every(meaning => {
            const s = String(meaning || '').trim();
            return Boolean(s) && !s.startsWith('中文释义补充');
        });
}

function selectReadyCachedQuestions({ rows, userId, level, roundType = 'primary', limit = 10, excludedRecordIds = new Set() }) {
    const QUOTA = { 1: 6, 2: 3, 3: 1 };
    const targetUserKey = userKey(userId);
    const eligible = (rows || [])
        .map(normalizeCacheRow)
        .filter(row => userKey(row.user) === targetUserKey && row.level === level && row.roundType === roundType)
        .filter(row => row.qualityStatus === QUESTION_CACHE_STATUS.READY)
        .filter(row => isCacheQuestionReady(row))
        .filter(row => !excludedRecordIds.has(row.wordRecordId))
        .sort((a, b) => a.usedCount - b.usedCount || b.generatedAt - a.generatedAt || a.word.localeCompare(b.word));
    const counts = { 1: 0, 2: 0, 3: 0 };
    const selected = [];
    for (const row of eligible) {
        if (selected.length >= limit) break;
        if ((counts[row.type] || 0) < (QUOTA[row.type] || 0)) {
            selected.push(row);
            counts[row.type] = (counts[row.type] || 0) + 1;
        }
    }
    if (selected.length < limit) {
        const taken = new Set(selected.map(r => r.recordId));
        for (const row of eligible) {
            if (selected.length >= limit) break;
            if (!taken.has(row.recordId)) selected.push(row);
        }
    }
    return selected.map(row => ({ ...row.question, cacheRecordId: row.recordId }));
}

function incrementSummary(bucket, row) {
    if (!bucket[row.level]) bucket[row.level] = { total: 0, ready: 0 };
    bucket[row.level].total += 1;
    if (row.qualityStatus === QUESTION_CACHE_STATUS.READY) bucket[row.level].ready += 1;
}

function summarizeCacheStatus(rows) {
    const normalized = (rows || []).map(normalizeCacheRow);
    const summary = { total: normalized.length, ready: 0, byLevel: {}, byRoundType: {} };
    for (const row of normalized) {
        if (row.qualityStatus === QUESTION_CACHE_STATUS.READY) summary.ready += 1;
        incrementSummary(summary.byLevel, row);
        if (!summary.byRoundType[row.roundType]) summary.byRoundType[row.roundType] = { total: 0, ready: 0 };
        summary.byRoundType[row.roundType].total += 1;
        if (row.qualityStatus === QUESTION_CACHE_STATUS.READY) summary.byRoundType[row.roundType].ready += 1;
    }
    return summary;
}

module.exports = {
    QUESTION_CACHE_STATUS,
    buildCacheRowsForRecord,
    isCacheQuestionReady,
    normalizeCacheRow,
    selectReadyCachedQuestions,
    summarizeCacheStatus,
};
