const {
    ASSESSMENT_MODE,
    getAssessmentMode,
    normalizeAssessmentMode,
} = require('./assessment-mode');

const ASSESSMENT_KIND = Object.freeze({
    QUIZ: 'quiz',
    REVIEW: 'review',
});

const REVIEW_STATUS = Object.freeze({
    ACTIVE: 'active',
    SUBMITTED: 'submitted',
    DEFERRED: 'deferred',
    COMPLETE: 'complete',
});

function createReviewId(mode, createId) {
    return `${normalizeAssessmentMode(mode)}-review-${createId()}`;
}

function getAssessmentKind(assessmentId) {
    return /^(real|test)-review-/.test(String(assessmentId || ''))
        ? ASSESSMENT_KIND.REVIEW
        : ASSESSMENT_KIND.QUIZ;
}

function getReviewMode(reviewId) {
    if (getAssessmentKind(reviewId) !== ASSESSMENT_KIND.REVIEW) {
        throw new Error('复习 ID 格式无效');
    }
    return getAssessmentMode(reviewId);
}

function summarizeReviewRound(results) {
    const remainingRecordIds = results
        .filter(result => !result.correct)
        .map(result => result.recordId)
        .filter(Boolean);
    const correct = results.filter(result => result.correct).length;
    const complete = remainingRecordIds.length === 0;

    return {
        reviewed: results.length,
        correct,
        remainingRecordIds,
        complete,
        status: complete ? REVIEW_STATUS.COMPLETE : REVIEW_STATUS.SUBMITTED,
    };
}

module.exports = {
    ASSESSMENT_KIND,
    ASSESSMENT_MODE,
    REVIEW_STATUS,
    createReviewId,
    getAssessmentKind,
    getReviewMode,
    summarizeReviewRound,
};
