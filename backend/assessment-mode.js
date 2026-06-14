const ASSESSMENT_MODE = Object.freeze({
    REAL: 'real',
    TEST: 'test',
});

function normalizeAssessmentMode(mode) {
    const normalized = mode || ASSESSMENT_MODE.REAL;
    if (!Object.values(ASSESSMENT_MODE).includes(normalized)) {
        throw new Error('考核模式只能是 real 或 test');
    }
    return normalized;
}

function getAssessmentMode(testId) {
    return String(testId || '').startsWith(`${ASSESSMENT_MODE.TEST}-`)
        ? ASSESSMENT_MODE.TEST
        : ASSESSMENT_MODE.REAL;
}

function isRealAssessment(testId) {
    return getAssessmentMode(testId) === ASSESSMENT_MODE.REAL;
}

function isTestAssessment(testId) {
    return getAssessmentMode(testId) === ASSESSMENT_MODE.TEST;
}

function createAssessmentId(mode, createId) {
    const normalized = normalizeAssessmentMode(mode);
    return `${normalized}-${createId()}`;
}

function recordTestId(record) {
    const value = record?.fields?.test_id;
    if (Array.isArray(value)) return value[0] || '';
    if (value && typeof value === 'object') {
        return value.text || value.name || value.value || value.id || '';
    }
    return value || '';
}

function filterAssessmentRecords(records, mode) {
    const normalized = normalizeAssessmentMode(mode);
    return records.filter(record => getAssessmentMode(recordTestId(record)) === normalized);
}

function shouldAffectLearningState(testId) {
    return isRealAssessment(testId);
}

module.exports = {
    ASSESSMENT_MODE,
    createAssessmentId,
    filterAssessmentRecords,
    getAssessmentMode,
    isRealAssessment,
    isTestAssessment,
    normalizeAssessmentMode,
    shouldAffectLearningState,
};
