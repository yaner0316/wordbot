const { ASSESSMENT_MODE } = require('./assessment-mode');
const { ASSESSMENT_KIND, getAssessmentKind } = require('./review-session');

const DEFAULT_EXCELLENT_MINUTES = 5;
const DEFAULT_PERFECT_MINUTES = 12;

function readMinutes(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

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
    if (questionCount <= 0 || score < 9) {
        return { eligible: false, minutes: 0, tier: 'none', reason: 'score_below_threshold' };
    }
    if (score >= questionCount) {
        return {
            eligible: true,
            minutes: readMinutes('WORDBOT_GAME_REWARD_PERFECT_MINUTES', DEFAULT_PERFECT_MINUTES),
            tier: 'perfect',
            reason: 'perfect_score',
        };
    }
    return {
        eligible: true,
        minutes: readMinutes('WORDBOT_GAME_REWARD_EXCELLENT_MINUTES', DEFAULT_EXCELLENT_MINUTES),
        tier: 'excellent',
        reason: 'excellent_score',
    };
}

module.exports = {
    calculateGameReward,
};
