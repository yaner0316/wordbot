const { isRealAssessment } = require('./assessment-mode');

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

function evaluateMeaningMastery(records, isCorrectValue) {
    const attempts = records
        .filter(record => isRealAssessment(fieldValue(record.fields?.test_id)))
        .sort((a, b) => Number(a.fields?.test_time || 0) - Number(b.fields?.test_time || 0));

    let lastWrongIndex = -1;
    attempts.forEach((record, index) => {
        if (!isCorrectValue(record.fields?.is_correct)) lastWrongIndex = index;
    });

    const correctAttempts = attempts.slice(lastWrongIndex + 1).filter(record =>
        isCorrectValue(record.fields?.is_correct)
    );
    const uncertainCorrect = correctAttempts.filter(record => {
        const stored = parseStoredAnswer(fieldValue(record.fields?.your_answer));
        return stored.confidence === ANSWER_CONFIDENCE.GUESS;
    });
    const distinctDays = new Set(
        correctAttempts.map(record => learningDay(record.fields?.test_time))
    ).size;
    const distinctTypes = new Set(
        correctAttempts.map(record => Number(record.fields?.question_type || 0)).filter(Boolean)
    ).size;

    const correctAfterLastWrongCount = correctAttempts.length;
    const mastered = correctAfterLastWrongCount >= 2 && distinctDays >= 2;
    const stage = attempts.length === 0
        ? 'unseen'
        : mastered
            ? 'mastered'
            : correctAfterLastWrongCount >= 1
                ? 'consolidating'
                : 'recognized';

    return {
        mastered,
        stage,
        evidenceCount: correctAttempts.length,
        uncertainCorrectCount: uncertainCorrect.length,
        correctAfterLastWrongCount,
        distinctDays,
        distinctTypes,
    };
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
    encodeAnswer,
    evaluateMeaningMastery,
    evaluateWordMastery,
    normalizeSubmittedAnswer,
    parseStoredAnswer,
};
