const ANSWER_CONFIDENCE = Object.freeze({
    SURE: 'sure',
    GUESS: 'guess',
});

function normalizeConfidence(confidence) {
    if (confidence === undefined || confidence === null || confidence === '') {
        return ANSWER_CONFIDENCE.SURE;
    }
    if (!Object.values(ANSWER_CONFIDENCE).includes(confidence)) {
        throw new Error('ANSWER_CONFIDENCE_REQUIRED');
    }
    return confidence;
}

function normalizeSubmittedAnswer(answer) {
    if (Number.isInteger(answer)) {
        return { option: answer, confidence: ANSWER_CONFIDENCE.SURE };
    }
    if (!answer || typeof answer !== 'object') {
        throw new Error('ANSWER_FORMAT_INVALID');
    }
    return {
        option: answer.option,
        confidence: normalizeConfidence(answer.confidence),
    };
}

function encodeAnswer(option, confidence) {
    const normalized = normalizeConfidence(confidence);
    return `${option}|${normalized}`;
}

function parseStoredAnswer(value) {
    const text = String(value || '');
    const [option, confidence] = text.split('|');
    return {
        option,
        confidence: Object.values(ANSWER_CONFIDENCE).includes(confidence)
            ? confidence
            : ANSWER_CONFIDENCE.SURE,
    };
}

function fieldValue(value) {
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return fieldValue(value[0]);
    if (typeof value === 'object') {
        return String(value.text ?? value.name ?? value.value ?? value.id ?? '');
    }
    return String(value);
}

function learningDay(time) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date(Number(time)));
}

function timestampValue(value) {
    const text = fieldValue(value).trim();
    if (!text) return 0;
    const numeric = Number(text);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function assessmentTimestamp(record) {
    const fields = record?.fields || {};
    return Math.max(
        timestampValue(fields.test_time),
        timestampValue(fields.record_time),
        timestampValue(fields.assessed_at),
        timestampValue(fields.created_at),
        timestampValue(record?.assessed_at),
        timestampValue(record?.created_at),
        timestampValue(record?.created_time)
    );
}

function formalFlagValue(value) {
    const normalized = fieldValue(value).trim().toLowerCase();
    if (!normalized) return null;
    return ['true', '1', 'yes'].includes(normalized);
}

function isFormalAssessment(record) {
    const fields = record?.fields || {};
    const testId = fieldValue(fields.test_id).trim();
    if (!/^real(?:-|$)/.test(testId) || /^real-(?:review|preview|test)/.test(testId)) return false;
    const kind = fieldValue(fields.assessment_kind).trim().toLowerCase();
    if (['review', 'test', 'preview'].includes(kind)) return false;
    const rawFlag = fields.is_real_assessment !== undefined
        ? fields.is_real_assessment
        : record?.is_real_assessment;
    return formalFlagValue(rawFlag) !== false;
}

function isSubmittedFormalQuiz(record) {
    const fields = record?.fields || {};
    return isFormalAssessment(record) && fieldValue(fields.is_correct).trim() !== '';
}

function evaluateMeaningMastery(records, isCorrectValue) {
    const attempts = records.filter(isSubmittedFormalQuiz).sort((a, b) => assessmentTimestamp(a) - assessmentTimestamp(b));
    let lastWrongIndex = -1;
    attempts.forEach((record, index) => { if (!isCorrectValue(record.fields?.is_correct)) lastWrongIndex = index; });
    const correctAttempts = attempts.slice(lastWrongIndex + 1).filter(record => isCorrectValue(record.fields?.is_correct));
    const uncertainCorrect = correctAttempts.filter(record => parseStoredAnswer(fieldValue(record.fields?.your_answer)).confidence === ANSWER_CONFIDENCE.GUESS);
    const distinctDays = new Set(correctAttempts.map(assessmentTimestamp).filter(Boolean).map(learningDay)).size;
    const distinctTypes = new Set(correctAttempts.map(record => Number(record.fields?.question_type || 0)).filter(Boolean)).size;
    const latestTwoCorrect = correctAttempts.slice(-2);
    const latestCorrectTimestamps = latestTwoCorrect.map(assessmentTimestamp);
    const latestCorrectIntervalMs = latestCorrectTimestamps.length === 2 && latestCorrectTimestamps.every(Boolean)
        ? latestCorrectTimestamps[1] - latestCorrectTimestamps[0]
        : null;
    const mastered = latestCorrectIntervalMs !== null
        && latestCorrectIntervalMs >= 18 * 60 * 60 * 1000
        && latestCorrectIntervalMs <= 720 * 60 * 60 * 1000;
    const correctAfterLastWrongCount = correctAttempts.length;
    const stage = attempts.length === 0 ? 'unseen' : mastered ? 'mastered' : correctAfterLastWrongCount >= 1 ? 'consolidating' : 'recognized';
    return { mastered, stage, evidenceCount: correctAttempts.length, uncertainCorrectCount: uncertainCorrect.length, correctAfterLastWrongCount, latestCorrectIntervalMs, distinctDays, distinctTypes };
}
function strongestStage(stages) {
    if (stages.includes('mastered')) return 'mastered';
    if (stages.includes('consolidating')) return 'consolidating';
    if (stages.includes('recognized')) return 'recognized';
    return 'unseen';
}

function evaluateWordMastery(recordIds, records, isCorrectValue) {
    const meanings = {};
    for (const recordId of recordIds) {
        meanings[recordId] = evaluateMeaningMastery(
            records.filter(record => fieldValue(record.fields?.record_id) === recordId),
            isCorrectValue
        );
    }
    const mastered = recordIds.length > 0
        && recordIds.every(recordId => meanings[recordId].mastered);
    const stage = mastered
        ? 'mastered'
        : strongestStage(Object.values(meanings).map(meaning => meaning.stage));
    return {
        mastered,
        stage,
        meanings,
    };
}

module.exports = {
    ANSWER_CONFIDENCE,
    assessmentTimestamp,
    encodeAnswer,
    evaluateMeaningMastery,
    evaluateWordMastery,
    isFormalAssessment,
    isSubmittedFormalQuiz,
    normalizeSubmittedAnswer,
    parseStoredAnswer,
};
