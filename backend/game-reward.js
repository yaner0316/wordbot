const { ASSESSMENT_MODE } = require('./assessment-mode');
const { ASSESSMENT_KIND, getAssessmentKind } = require('./review-session');

const DEFAULT_EXCELLENT_MINUTES = 5;
const DEFAULT_PERFECT_MINUTES = 10;

function calculateGameReward({ testId, mode, correct, total }) {
    const assessmentKind = getAssessmentKind(testId);
    const normalizedMode = mode || ASSESSMENT_MODE.REAL;
    const score = Number(correct) || 0;
    const questionCount = Number(total) || 0;

    if (assessmentKind !== ASSESSMENT_KIND.QUIZ) {
        return { eligible: false, minutes: 0, tier: 'none', reason: 'review_round' };
    }
    if (normalizedMode !== ASSESSMENT_MODE.REAL) {
        return { eligible: false, minutes: 0, tier: 'none', reason: 'test_mode' };
    }
    if (score <= 5) {
        if (questionCount === 10) {
            return { eligible: true, minutes: -5, tier: 'penalty', reason: 'five_or_more_wrong' };
        }
        return { eligible: false, minutes: 0, tier: 'none', reason: 'score_below_threshold' };
    }
    if (score < 9) {
        return { eligible: false, minutes: 0, tier: 'none', reason: 'score_below_threshold' };
    }
    if (questionCount !== 10) {
        return { eligible: false, minutes: 0, tier: 'none', reason: 'incomplete_quiz' };
    }
    if (score >= questionCount) {
        return {
            eligible: true,
            minutes: DEFAULT_PERFECT_MINUTES,
            tier: 'perfect',
            reason: 'perfect_score',
        };
    }
    return {
        eligible: true,
        minutes: DEFAULT_EXCELLENT_MINUTES,
        tier: 'excellent',
        reason: 'excellent_score',
    };
}

module.exports = {
    calculateGameReward,
};
