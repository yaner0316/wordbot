const { evaluateWordMastery } = require('./mastery-evidence');
const { isCacheQuestionReady, normalizeCacheRow } = require('./question-cache');

function fieldValue(value) {
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return fieldValue(value[0]);
    if (typeof value === 'object') {
        return String(value.text ?? value.name ?? value.value ?? value.id ?? '');
    }
    return String(value);
}

function userKey(value) {
    return String(value || '').trim().toLowerCase();
}

function isCorrectField(value) {
    const normalized = fieldValue(value).trim();
    return normalized === 'optHGT7gYf' || normalized === '\u6b63\u786e' || normalized.toLowerCase() === 'true' || normalized.toLowerCase() === 'correct';
}

function hasSubmittedAnswer(record) {
    return record?.fields?.is_correct !== undefined && record?.fields?.is_correct !== null;
}

function isRealAssessment(testId) {
    return String(testId || '').startsWith('real-') || String(testId || '') === 'real';
}

function learningDay(time) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date(Number(time)));
}

function recordTimestamp(record) {
    const recordTime = Number(fieldValue(record?.fields?.record_time));
    if (Number.isFinite(recordTime) && recordTime > 0) return recordTime;
    const createdTime = Number(record?.created_time || 0);
    return Number.isFinite(createdTime) && createdTime > 0 ? createdTime : 0;
}

function isPastCooldown(record, { now, minAgeMs }) {
    if (!minAgeMs) return true;
    const timestamp = recordTimestamp(record);
    if (!timestamp) return true;
    return now - timestamp >= minAgeMs;
}

function buildReadyCacheRecordIds(cacheRows, { userId, level, roundType = 'primary' }) {
    const targetUser = userKey(userId);
    const result = new Set();
    for (const row of cacheRows || []) {
        const normalized = normalizeCacheRow(row);
        if (userKey(normalized.user) !== targetUser) continue;
        if (level && normalized.level !== level) continue;
        if (normalized.roundType !== roundType) continue;
        if (normalized.qualityStatus !== 'ready') continue;
        if (!isCacheQuestionReady(normalized)) continue;
        if (normalized.wordRecordId) result.add(normalized.wordRecordId);
    }
    return result;
}

function buildAssessmentSummary(assessmentRecords, { userId, now }) {
    const today = learningDay(now);
    const summary = new Map();
    for (const record of assessmentRecords || []) {
        const fields = record.fields || {};
        if (userId && userKey(fields.user) !== userKey(userId)) continue;
        if (!hasSubmittedAnswer(record)) continue;
        if (!isRealAssessment(fieldValue(fields.test_id))) continue;
        const recordId = fieldValue(fields.record_id).trim();
        if (!recordId) continue;
        const day = learningDay(Number(fields.test_time || 0));
        if (!summary.has(recordId)) {
            summary.set(recordId, { hasAny: false, hasBeforeToday: false, hasToday: false });
        }
        const item = summary.get(recordId);
        item.hasAny = true;
        if (day === today) item.hasToday = true;
        else item.hasBeforeToday = true;
    }
    return summary;
}

function buildMasteryByRecordId(wordRecords, assessmentRecords) {
    const recordsByWord = new Map();
    for (const record of wordRecords || []) {
        const word = fieldValue(record.fields?.Word).trim().toLowerCase();
        if (!word) continue;
        if (!recordsByWord.has(word)) recordsByWord.set(word, []);
        recordsByWord.get(word).push(record);
    }
    const masteryByRecordId = new Map();
    for (const group of recordsByWord.values()) {
        const recordIds = group.map(record => record.record_id).filter(Boolean);
        const evaluation = evaluateWordMastery(recordIds, assessmentRecords || [], isCorrectField);
        for (const recordId of recordIds) {
            masteryByRecordId.set(recordId, evaluation.meanings?.[recordId]);
        }
    }
    return masteryByRecordId;
}

function buildQuizWordQueue({
    wordRecords,
    cacheRows = [],
    assessmentRecords = [],
    userId,
    level = '',
    limit = 10,
    now = Date.now(),
    minAgeMs = 0,
}) {
    const assessmentSummary = buildAssessmentSummary(assessmentRecords, { userId, now });
    const masteryByRecordId = buildMasteryByRecordId(wordRecords, assessmentRecords);
    const readyCacheRecordIds = level
        ? buildReadyCacheRecordIds(cacheRows, { userId, level, roundType: 'primary' })
        : new Set();
    const targetUser = userKey(userId);

    const eligible = (wordRecords || [])
        .filter(record => userKey(record.fields?.user) === targetUser)
        .filter(record => {
            if (!level) return true;
            const recordLevel = fieldValue(record.fields?.Level).trim();
            return !recordLevel || recordLevel === level || readyCacheRecordIds.has(record.record_id);
        })
        .filter(record => isPastCooldown(record, { now, minAgeMs }))
        .sort((left, right) => recordTimestamp(left) - recordTimestamp(right))
        .filter(record => !masteryByRecordId.get(record.record_id)?.mastered)
        .filter(record => !assessmentSummary.get(record.record_id)?.hasToday);

    const due = eligible.filter(record => assessmentSummary.get(record.record_id)?.hasBeforeToday);
    const unseen = eligible.filter(record => !assessmentSummary.get(record.record_id)?.hasAny);
    return [...due, ...unseen].slice(0, limit).map(record => record.record_id);
}

function selectCachedQuestionsForWordQueue({
    cacheRows,
    queue,
    userId,
    level,
    roundType = 'primary',
    limit = 10,
}) {
    const targetUser = userKey(userId);
    const normalizedRows = (cacheRows || [])
        .map(normalizeCacheRow)
        .filter(row => userKey(row.user) === targetUser)
        .filter(row => !level || row.level === level)
        .filter(row => row.roundType === roundType)
        .filter(row => row.qualityStatus === 'ready')
        .filter(row => isCacheQuestionReady(row));
    const byRecordId = new Map();
    for (const row of normalizedRows) {
        if (!byRecordId.has(row.wordRecordId) || row.usedCount < byRecordId.get(row.wordRecordId).usedCount) {
            byRecordId.set(row.wordRecordId, row);
        }
    }
    return (queue || [])
        .map(recordId => byRecordId.get(recordId))
        .filter(Boolean)
        .slice(0, limit)
        .map(row => ({
            ...row.question,
            cacheRecordId: row.recordId,
            cacheUsedCount: row.usedCount,
        }));
}

module.exports = {
    buildQuizWordQueue,
    selectCachedQuestionsForWordQueue,
};
