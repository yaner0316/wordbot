const { evaluateWordMastery, isSubmittedFormalQuiz } = require('./mastery-evidence');
const { getTypePolicy, isCacheQuestionReady, normalizeCacheRow } = require('./question-cache');
const { isWordRecordPastQuizCooldown } = require('./quiz-cooldown');

function fieldValue(value) {
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return fieldValue(value[0]);
    if (typeof value === 'object') {
        return String(value.text ?? value.name ?? value.value ?? value.id ?? '');
    }
    return String(value);
}
function normalizeWord(value) {
    return fieldValue(value).trim().toLowerCase();
}

function normalizeQuestionText(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function userKey(value) {
    return String(value || '').trim().toLowerCase();
}

function isCorrectField(value) {
    const normalized = fieldValue(value).trim();
    return normalized === 'optHGT7gYf' || normalized === '\u6b63\u786e' || normalized.toLowerCase() === 'true' || normalized.toLowerCase() === 'correct';
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
    return isWordRecordPastQuizCooldown(record, { now, minAgeMs });
}

function normalizeSelectableCacheRows(cacheRows, {
    userId,
    level,
    roundType = 'primary',
    now = Date.now(),
    requireAvailable = true,
}) {
    const targetUser = userKey(userId);
    return (cacheRows || [])
        .map(sourceRow => {
            const fields = sourceRow?.fields || sourceRow || {};
            return {
                ...normalizeCacheRow(sourceRow),
                questionFingerprint: fieldValue(fields.question_fingerprint).trim(),
            };
        })
        .filter(row => userKey(row.user) === targetUser)
        .filter(row => !level || row.level === level)
        .filter(row => row.roundType === roundType)
        .filter(row => row.qualityStatus === 'ready')
        .filter(row => ['active', 'reserved_next_day'].includes(row.cacheState))
        .filter(row => !requireAvailable
            || row.cacheState !== 'reserved_next_day'
            || (row.availableFrom && Number.isFinite(Date.parse(row.availableFrom))
                && Date.parse(row.availableFrom) <= Number(now)))
        .filter(row => isCacheQuestionReady(row));
}

function buildReadyCacheRecordIds(cacheRows, { userId, level, roundType = 'primary', now = Date.now() }) {
    return new Set(
        normalizeSelectableCacheRows(cacheRows, { userId, level, roundType, now })
            .map(row => row.wordRecordId)
            .filter(Boolean)
    );
}

function buildAssessmentSummary(assessmentRecords, { userId, now }) {
    const today = learningDay(now);
    const summary = new Map();
    for (const record of assessmentRecords || []) {
        const fields = record.fields || {};
        if (userId && userKey(fields.user) !== userKey(userId)) continue;
        if (!isSubmittedFormalQuiz(record)) continue;
        const recordId = fieldValue(fields.record_id).trim();
        if (!recordId) continue;
        const day = learningDay(Number(fields.test_time || 0));
        if (!summary.has(recordId)) {
            summary.set(recordId, { hasAny: false, hasBeforeToday: false, hasCorrectToday: false });
        }
        const item = summary.get(recordId);
        if (day === today && isCorrectField(fields.is_correct)) item.hasCorrectToday = true;
        item.hasAny = true;
        if (day !== today) item.hasBeforeToday = true;
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

function buildRecentQuestionTextsByWord(assessmentRecords, { userId } = {}) {
    const latestByWord = new Map();
    for (const record of assessmentRecords || []) {
        const fields = record.fields || {};
        if (userId && userKey(fields.user) !== userKey(userId)) continue;
        if (!isSubmittedFormalQuiz(record)) continue;
        const word = normalizeWord(fields.word);
        const questionText = normalizeQuestionText(fields.context || fields.question_text);
        if (!word || !questionText) continue;
        const timestamp = Number(fields.test_time || fields.record_time || record.created_time || 0) || 0;
        const current = latestByWord.get(word);
        if (!current || timestamp >= current.timestamp) latestByWord.set(word, { timestamp, questionText });
    }
    return new Map([...latestByWord].map(([word, item]) => [word, new Set([item.questionText])]));
}
function buildQuizWordQueue({
    cacheRows = [],
    wordRecords,
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
        ? buildReadyCacheRecordIds(cacheRows, { userId, level, roundType: 'primary', now })
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
        .filter(record => !masteryByRecordId.get(record.record_id)?.mastered);

    const availableToday = eligible.filter(record => !assessmentSummary.get(record.record_id)?.hasCorrectToday);
    const due = availableToday.filter(record => assessmentSummary.get(record.record_id)?.hasAny);
    const unseen = availableToday.filter(record => !assessmentSummary.get(record.record_id)?.hasAny);
    return [...due, ...unseen].slice(0, limit).map(record => record.record_id);
}

function countEligibleReadyMeaningsByLevel({
    cacheRows = [],
    wordRecords = [],
    assessmentRecords = [],
    userId,
    levels = [],
    now = Date.now(),
    minAgeMs = 0,
    roundType = 'primary',
}) {
    const counts = {};
    for (const level of [...new Set((levels || []).map(fieldValue).map(value => value.trim()).filter(Boolean))]) {
        const queue = buildQuizWordQueue({
            cacheRows,
            wordRecords,
            assessmentRecords,
            userId,
            level,
            limit: wordRecords.length,
            now,
            minAgeMs,
        });
        const queuedRecordIds = new Set(queue);
        const groups = new Map();
        for (const row of normalizeSelectableCacheRows(cacheRows, { userId, level, roundType, now, requireAvailable: false })) {
            if (!queuedRecordIds.has(row.wordRecordId)) continue;
            const fingerprint = String(row.questionFingerprint || '').trim();
            const stem = normalizeQuestionText(row.question?.context);
            if (!fingerprint || !stem) continue;
            if (!groups.has(row.wordRecordId)) {
                groups.set(row.wordRecordId, { fingerprints: new Set(), stems: new Set() });
            }
            groups.get(row.wordRecordId).fingerprints.add(fingerprint);
            groups.get(row.wordRecordId).stems.add(stem);
        }
        counts[level] = [...groups.values()].filter(group =>
            group.fingerprints.size >= 2 && group.stems.size >= 2
        ).length;
    }
    return counts;
}

function selectCachedQuestionsForWordQueue({
    cacheRows,
    queue,
    userId,
    level,
    roundType = 'primary',
    limit = 10,
    recentQuestionTextsByWord = new Map(),
    now = Date.now(),
}) {
    const { quota, allowed } = getTypePolicy(level, limit);
    const normalizedRows = normalizeSelectableCacheRows(cacheRows, {
        userId,
        level,
        roundType,
        now,
    });
    const byRecordId = new Map();
    for (const row of normalizedRows) {
        const wordKey = normalizeWord(row.word);
        const excluded = new Set([...(recentQuestionTextsByWord.get(wordKey) || [])].map(normalizeQuestionText));
        if (excluded.has(normalizeQuestionText(row.question.context))) continue;
        const current = byRecordId.get(row.wordRecordId);
        if (!current || row.usedCount < current.usedCount) {
            byRecordId.set(row.wordRecordId, row);
        }
    }
    const selected = [];
    const selectedIds = new Set();
    const counts = { 1: 0, 2: 0, 3: 0 };
    for (const recordId of queue || []) {
        if (selected.length >= limit) break;
        const row = byRecordId.get(recordId);
        if (!row || !allowed.has(row.type)) continue;
        const key = row.recordId || row.wordRecordId || `${row.word}:${row.type}`;
        if (selectedIds.has(key)) continue;
        if ((counts[row.type] || 0) >= (quota[row.type] || 0)) continue;
        selected.push(row);
        selectedIds.add(key);
        counts[row.type] = (counts[row.type] || 0) + 1;
    }
    return selected.map(row => ({
            ...row.question,
            cacheRecordId: row.recordId,
            cacheUsedCount: row.usedCount,
        }));
}

module.exports = {
    buildQuizWordQueue,
    countEligibleReadyMeaningsByLevel,
    selectCachedQuestionsForWordQueue,
    buildRecentQuestionTextsByWord,
};
