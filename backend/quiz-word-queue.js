const { assessmentTimestamp, evaluateWordMastery, isFormalAssessment, isSubmittedFormalQuiz } = require('./mastery-evidence');
const { getTypePolicy, isCacheQuestionReady, normalizeCacheRow } = require('./question-cache');
const { getReadyPrimaryPairIssues } = require('./question-cache-pair');

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

function timestamp(value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

function lastDisplayedTimestamp(record) {
    const fields = record?.fields || {};
    return Math.max(
        timestamp(fields.last_displayed_at),
        timestamp(fields.lastDisplayedAt),
        timestamp(record?.last_displayed_at),
        timestamp(record?.lastDisplayedAt)
    );
}

function isPastCooldown(record, { now, minAgeMs, latestFormalDisplayAt = 0 }) {
    if (!minAgeMs) return true;
    const enteredAt = recordTimestamp(record);
    if (!enteredAt) return false;
    return Number(now) >= Math.max(enteredAt, lastDisplayedTimestamp(record), latestFormalDisplayAt) + minAgeMs;
}
function isCacheRowAvailable(row, now) {
    if (row.cacheState !== 'reserved_next_day') return true;
    return Boolean(row.availableFrom
        && Number.isFinite(Date.parse(row.availableFrom))
        && Date.parse(row.availableFrom) <= Number(now));
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
        .filter(row => !requireAvailable || isCacheRowAvailable(row, now))
        .filter(row => isCacheQuestionReady(row));
}

function toReadyPrimaryPairRow(row) {
    return {
        question_text: row.question?.context,
        question_fingerprint: row.questionFingerprint,
        options: row.question?.options,
        answer: row.question?.answer,
    };
}

function filterRowsInValidReadyPrimaryPairs(rows) {
    const groups = new Map();
    for (const row of rows || []) {
        if (!row.wordRecordId) continue;
        if (!groups.has(row.wordRecordId)) groups.set(row.wordRecordId, []);
        groups.get(row.wordRecordId).push(row);
    }
    const validRows = new Set();
    for (const group of groups.values()) {
        for (let leftIndex = 0; leftIndex < group.length; leftIndex += 1) {
            for (let rightIndex = leftIndex + 1; rightIndex < group.length; rightIndex += 1) {
                const pair = [group[leftIndex], group[rightIndex]];
                if (getReadyPrimaryPairIssues(pair.map(toReadyPrimaryPairRow)).length) continue;
                validRows.add(pair[0]);
                validRows.add(pair[1]);
            }
        }
    }
    return (rows || []).filter(row => validRows.has(row));
}

function buildReadyCacheRecordIds(cacheRows, { userId, level, roundType = 'primary', now = Date.now() }) {
    return new Set(
        normalizeSelectableCacheRows(cacheRows, { userId, level, roundType, now })
            .map(row => row.wordRecordId)
            .filter(Boolean)
    );
}

function buildAssessmentSummary(assessmentRecords, { userId }) {
    const summary = new Map();
    for (const record of assessmentRecords || []) {
        const fields = record.fields || {};
        if (userId && userKey(fields.user) !== userKey(userId)) continue;
        if (!isSubmittedFormalQuiz(record)) continue;
        const recordId = fieldValue(fields.record_id).trim();
        if (!recordId) continue;
        if (!summary.has(recordId)) summary.set(recordId, { hasAny: false, lastWrongAt: 0, latestAttemptAt: 0 });
        const item = summary.get(recordId);
        item.hasAny = true;
        item.latestAttemptAt = Math.max(item.latestAttemptAt, assessmentTimestamp(record));
        if (!isCorrectField(fields.is_correct)) item.lastWrongAt = Math.max(item.lastWrongAt, assessmentTimestamp(record));
    }
    return summary;
}
function buildMasteryByRecordId(wordRecords, assessmentRecords) {
    const recordsByWord = new Map();
    const formalDisplayRecords = (assessmentRecords || []).filter(isFormalAssessment);
    for (const record of wordRecords || []) {
        const word = fieldValue(record.fields?.Word).trim().toLowerCase();
        if (!word) continue;
        if (!recordsByWord.has(word)) recordsByWord.set(word, []);
        recordsByWord.get(word).push(record);
    }
    const masteryByRecordId = new Map();
    for (const group of recordsByWord.values()) {
        const recordIds = group.map(record => record.record_id).filter(Boolean);
        const evaluation = evaluateWordMastery(recordIds, formalDisplayRecords, isCorrectField);
        for (const recordId of recordIds) {
            masteryByRecordId.set(recordId, evaluation.meanings?.[recordId]);
        }
    }
    return masteryByRecordId;
}

function buildDisplayEventSummary(displayEvents, { userId }) {
    const summary = new Map();
    for (const record of displayEvents || []) {
        if (userId && userKey(record?.user) !== userKey(userId)) continue;
        if (record?.countsForCooldown === false) continue;
        const recordId = fieldValue(record?.meaningId).trim();
        const displayedAt = timestamp(record?.displayedAt);
        if (!recordId || !displayedAt) continue;
        summary.set(recordId, Math.max(summary.get(recordId) || 0, displayedAt));
    }
    return summary;
}

function buildActiveDisplayStemsByMeaning(displayEvents, { userId, now = Date.now() } = {}) {
    const result = new Map();
    for (const record of displayEvents || []) {
        if (userId && userKey(record?.user) !== userKey(userId)) continue;
        const recordId = fieldValue(record?.meaningId).trim();
        const questionText = normalizeQuestionText(record?.stem);
        const historyExpiresAt = timestamp(record?.historyExpiresAt);
        if (!recordId || !questionText || !historyExpiresAt || historyExpiresAt <= Number(now)) continue;
        if (!result.has(recordId)) result.set(recordId, new Set());
        result.get(recordId).add(questionText);
    }
    return result;
}

function buildFormalAssessmentDisplaySummary(assessmentRecords, { userId }) {
    const summary = new Map();
    for (const record of assessmentRecords || []) {
        const fields = record?.fields || {};
        if (userId && userKey(fields.user) !== userKey(userId)) continue;
        if (!isFormalAssessment(record)) continue;
        const recordId = fieldValue(fields.record_id).trim();
        const displayedAt = assessmentTimestamp(record);
        if (!recordId || !displayedAt) continue;
        summary.set(recordId, Math.max(summary.get(recordId) || 0, displayedAt));
    }
    return summary;
}

function mergeLatestTimestamps(...summaries) {
    const merged = new Map();
    for (const summary of summaries) {
        for (const [recordId, value] of summary || []) {
            merged.set(recordId, Math.max(merged.get(recordId) || 0, value));
        }
    }
    return merged;
}

function buildRecentQuestionTextsByWord(assessmentRecords, { userId, now = Date.now(), historyWindowMs = 30 * 24 * 60 * 60 * 1000 } = {}) {
    const result = new Map();
    const earliest = Number(now) - historyWindowMs;
    for (const record of assessmentRecords || []) {
        const fields = record.fields || {};
        if (userId && userKey(fields.user) !== userKey(userId)) continue;
        if (!isFormalAssessment(record)) continue;
        const recordId = fieldValue(fields.record_id).trim();
        const questionText = normalizeQuestionText(fields.context || fields.question_text);
        const shownAt = assessmentTimestamp(record);
        if (!recordId || !questionText || !shownAt || shownAt < earliest || shownAt > Number(now)) continue;
        if (!result.has(recordId)) result.set(recordId, new Set());
        result.get(recordId).add(questionText);
    }
    return result;
}
function buildQuizWordQueue({ cacheRows = [], wordRecords, assessmentRecords = [], displayEvents = [], userId, level = '', limit = 10, now = Date.now(), minAgeMs = 0 }) {
    const assessmentSummary = buildAssessmentSummary(assessmentRecords, { userId });
    const formalDisplayByRecordId = mergeLatestTimestamps(
        buildFormalAssessmentDisplaySummary(assessmentRecords, { userId }),
        buildDisplayEventSummary(displayEvents, { userId })
    );
    const masteryByRecordId = buildMasteryByRecordId(wordRecords, assessmentRecords);
    const readyCacheRecordIds = level ? buildReadyCacheRecordIds(cacheRows, { userId, level, roundType: 'primary', now }) : new Set();
    const targetUser = userKey(userId);
    const eligible = (wordRecords || [])
        .filter(record => userKey(record.fields?.user) === targetUser)
        .filter(record => !level || !fieldValue(record.fields?.Level).trim() || fieldValue(record.fields?.Level).trim() === level || readyCacheRecordIds.has(record.record_id))
        .filter(record => isPastCooldown(record, { now, minAgeMs, latestFormalDisplayAt: formalDisplayByRecordId.get(record.record_id) || 0 }))
        .filter(record => !masteryByRecordId.get(record.record_id)?.mastered);
    const oldWrong = eligible.filter(record => assessmentSummary.get(record.record_id)?.lastWrongAt)
        .sort((left, right) => assessmentSummary.get(left.record_id).lastWrongAt - assessmentSummary.get(right.record_id).lastWrongAt || recordTimestamp(left) - recordTimestamp(right));
    const untested = eligible.filter(record => !assessmentSummary.get(record.record_id)?.hasAny)
        .sort((left, right) => recordTimestamp(left) - recordTimestamp(right));
    const touchedCorrectOnly = eligible.filter(record => assessmentSummary.get(record.record_id)?.hasAny && !assessmentSummary.get(record.record_id)?.lastWrongAt)
        .sort((left, right) => assessmentSummary.get(left.record_id).latestAttemptAt - assessmentSummary.get(right.record_id).latestAttemptAt || recordTimestamp(left) - recordTimestamp(right));
    return [...oldWrong, ...touchedCorrectOnly, ...untested].slice(0, limit).map(record => record.record_id);
}
function countEligibleReadyMeaningsByLevel({
    cacheRows = [],
    wordRecords = [],
    assessmentRecords = [],
    displayEvents = [],
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
            displayEvents,
            userId,
            level,
            limit: wordRecords.length,
            now,
            minAgeMs,
        });
        const queuedRecordIds = new Set(queue);
        const approvedRows = normalizeSelectableCacheRows(
            cacheRows,
            { userId, level, roundType, now, requireAvailable: false }
        ).filter(row => String(row.aiAuditStatus || '').trim().toLowerCase() === 'approved');
        const validPairRows = filterRowsInValidReadyPrimaryPairs(approvedRows);
        const recentQuestionTextsByWord = buildActiveDisplayStemsByMeaning(displayEvents, { userId, now });
        counts[level] = new Set(validPairRows
            .filter(row => isCacheRowAvailable(row, now))
            .filter(row => !new Set(recentQuestionTextsByWord.get(row.wordRecordId) || [])
                .has(normalizeQuestionText(row.question.context)))
            .map(row => row.wordRecordId)
            .filter(recordId => queuedRecordIds.has(recordId))).size;
    }
    return counts;
}

function selectCachedQuestionsForWordQueue({
    cacheRows,
    queue,
    userId,
    level,
    roundType = 'primary',
    requireReadyPair = false,
    limit = 10,
    recentQuestionTextsByWord = new Map(),
    now = Date.now(),
}) {
    const { quota, allowed } = getTypePolicy(level, limit);
    const storedRows = normalizeSelectableCacheRows(cacheRows, {
        userId,
        level,
        roundType,
        now,
        requireAvailable: false,
    });
    const pairCheckedRows = requireReadyPair ? filterRowsInValidReadyPrimaryPairs(storedRows) : storedRows;
    const normalizedRows = pairCheckedRows.filter(row =>
        isCacheRowAvailable(row, now));
    const byRecordId = new Map();
    for (const row of normalizedRows) {
        const excluded = new Set([...(recentQuestionTextsByWord.get(row.wordRecordId) || [])].map(normalizeQuestionText));
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
    buildActiveDisplayStemsByMeaning,
};
