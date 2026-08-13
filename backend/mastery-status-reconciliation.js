'use strict';

const { createHash } = require('node:crypto');
const {
    assessmentTimestamp,
    evaluateMeaningMastery,
    isSubmittedFormalQuiz,
} = require('./mastery-evidence');
const { toFeishuAssessmentRecord } = require('./quiz-adapter');

const STATUS_ORDER = Object.freeze(['pending', 'recognized', 'consolidating', 'mastered']);

function normalizeId(value) {
    return String(value || '').trim();
}

function normalizeStatus(value) {
    const status = String(value || '').trim().toLowerCase();
    return STATUS_ORDER.includes(status) ? status : 'pending';
}

function normalizeTimestamp(value) {
    if (!value) return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function isCorrectValue(value) {
    if (value === true || value === 1) return true;
    return ['1', 'true', 'correct', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function compareChanges(left, right) {
    return normalizeId(left?.userId).localeCompare(normalizeId(right?.userId))
        || normalizeId(left?.wordId).localeCompare(normalizeId(right?.wordId));
}

function canonicalChanges(changes = []) {
    return changes.map(change => ({
        userId: normalizeId(change?.userId),
        wordId: normalizeId(change?.wordId),
        storedStatus: normalizeStatus(change?.storedStatus),
        expectedStatus: normalizeStatus(change?.expectedStatus),
        storedRememberedAt: normalizeTimestamp(change?.storedRememberedAt),
        expectedRememberedAt: normalizeTimestamp(change?.expectedRememberedAt),
    })).sort(compareChanges);
}

function createPlanFingerprint({ userId = null, changes = [] } = {}) {
    const payload = {
        version: 1,
        userId: normalizeId(userId) || null,
        changes: canonicalChanges(changes),
    };
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function expectedRememberedAt(records, evidence, storedRememberedAt) {
    if (!evidence.mastered) return null;
    const stored = normalizeTimestamp(storedRememberedAt);
    if (stored) return stored;
    const attempts = records
        .filter(isSubmittedFormalQuiz)
        .sort((left, right) => assessmentTimestamp(left) - assessmentTimestamp(right));
    let lastWrongIndex = -1;
    attempts.forEach((record, index) => {
        if (!isCorrectValue(record.fields?.is_correct)) lastWrongIndex = index;
    });
    const latestCorrect = attempts.slice(lastWrongIndex + 1)
        .filter(record => isCorrectValue(record.fields?.is_correct))
        .map(assessmentTimestamp)
        .filter(Boolean)
        .at(-1);
    return latestCorrect ? new Date(latestCorrect).toISOString() : null;
}

function assessmentBelongsToWord(row, word, sourceCounts) {
    if (normalizeId(row?.user_id) !== normalizeId(word?.user_id)) return false;
    const assessmentWordId = normalizeId(row?.word_id);
    if (assessmentWordId) return assessmentWordId === normalizeId(word?.id);
    const sourceId = normalizeId(row?.source_word_record_id);
    const sourceKey = `${normalizeId(word?.user_id)}\u0000${sourceId}`;
    return sourceId
        && sourceId === normalizeId(word?.feishu_record_id)
        && sourceCounts.get(sourceKey) === 1;
}

function evidenceRecordsForWord(word, assessments, sourceCounts) {
    const sourceRecordIdByWordId = new Map([[normalizeId(word?.id), normalizeId(word?.feishu_record_id)]]);
    return assessments
        .filter(row => assessmentBelongsToWord(row, word, sourceCounts))
        .map(row => {
            const record = toFeishuAssessmentRecord(row, { username: '', sourceRecordIdByWordId });
            if (row?.is_correct !== undefined && row?.is_correct !== null) {
                record.fields.is_correct = row.is_correct;
            }
            return record;
        });
}

function planMasteryStatusReconciliation({ words = [], assessments = [] } = {}) {
    const changes = [];
    const expectedStatuses = Object.fromEntries(STATUS_ORDER.map(status => [status, 0]));
    const users = new Map();
    const sourceCounts = new Map();
    for (const word of words) {
        const sourceId = normalizeId(word?.feishu_record_id);
        if (!sourceId) continue;
        const key = `${normalizeId(word?.user_id)}\u0000${sourceId}`;
        sourceCounts.set(key, (sourceCounts.get(key) || 0) + 1);
    }

    for (const word of words) {
        const wordId = normalizeId(word?.id);
        const userId = normalizeId(word?.user_id);
        if (!wordId || !userId) continue;
        const records = evidenceRecordsForWord(word, assessments, sourceCounts);
        const evidence = evaluateMeaningMastery(records, isCorrectValue);
        const expectedStatus = evidence.stage === 'unseen' ? 'pending' : evidence.stage;
        const storedStatus = normalizeStatus(word?.mastery_status);
        const storedRememberedAt = normalizeTimestamp(word?.remembered_at);
        const rememberedAt = expectedRememberedAt(records, evidence, storedRememberedAt);
        expectedStatuses[expectedStatus] += 1;

        if (!users.has(userId)) {
            users.set(userId, { userId, scannedWords: 0, mismatches: 0, transitions: {} });
        }
        const user = users.get(userId);
        user.scannedWords += 1;

        if (storedStatus === expectedStatus && storedRememberedAt === rememberedAt) continue;
        const transition = `${storedStatus}->${expectedStatus}`;
        user.mismatches += 1;
        user.transitions[transition] = (user.transitions[transition] || 0) + 1;
        changes.push({
            userId,
            wordId,
            storedStatus,
            expectedStatus,
            storedRememberedAt,
            expectedRememberedAt: rememberedAt,
        });
    }

    changes.sort(compareChanges);
    const byUser = [...users.values()]
        .sort((left, right) => left.userId.localeCompare(right.userId));
    return {
        summary: {
            scannedWords: Object.values(expectedStatuses).reduce((total, count) => total + count, 0),
            mismatches: changes.length,
            expectedStatuses,
        },
        byUser,
        changes,
    };
}

function requireDependency(dependencies, name) {
    const dependency = dependencies?.[name];
    if (typeof dependency !== 'function') throw new Error(`${name.toUpperCase()}_REQUIRED`);
    return dependency;
}

async function reconcileMasteryStatus(dependencies, options = {}) {
    const loadWords = requireDependency(dependencies, 'loadWords');
    const loadAssessments = requireDependency(dependencies, 'loadAssessments');
    const apply = options.apply === true;
    const userId = normalizeId(options.userId) || null;
    const reviewedFingerprint = normalizeId(options.planFingerprint).toLowerCase() || null;
    const [words, assessments] = await Promise.all([
        loadWords({ userId }),
        loadAssessments({ userId }),
    ]);
    const plan = planMasteryStatusReconciliation({ words, assessments });
    const planFingerprint = createPlanFingerprint({ userId, changes: plan.changes });

    if (apply && !reviewedFingerprint) {
        throw new Error('PLAN_FINGERPRINT_REQUIRED: run and review a dry-run first');
    }
    if (apply && reviewedFingerprint !== planFingerprint) {
        throw new Error('PLAN_FINGERPRINT_MISMATCH: data changed; run and review a new dry-run');
    }

    const failures = [];
    let applied = 0;
    if (apply) {
        const applyWord = requireDependency(dependencies, 'applyWord');
        for (const change of plan.changes) {
            try {
                await applyWord(change);
                applied += 1;
            } catch (error) {
                const errorCode = String(error?.code || error?.message || 'MASTERY_RECONCILIATION_FAILED').split(':')[0];
                if (errorCode.startsWith('WORD_STATE_CHANGED') || errorCode === 'WORD_FINALIZE_ROLLBACK_FAILED') {
                    throw new Error(errorCode);
                }
                failures.push({
                    userId: change.userId,
                    wordId: change.wordId,
                    error: errorCode,
                });
            }
        }
    }

    return {
        mode: apply ? 'apply' : 'dry-run',
        userId,
        planFingerprint,
        planned: plan.changes.length,
        applied,
        failed: failures.length,
        failures,
        ...plan,
    };
}

module.exports = {
    STATUS_ORDER,
    createPlanFingerprint,
    planMasteryStatusReconciliation,
    reconcileMasteryStatus,
};
