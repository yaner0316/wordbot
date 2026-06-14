const { ASSESSMENT_KIND, REVIEW_STATUS } = require('./review-session');

function buildReviewRecordFields({
    sourceTestId,
    parentReviewId = '',
    round,
    status,
    sourceQuestionId = '',
}) {
    if (
        !sourceTestId ||
        !Number.isInteger(round) ||
        round < 1 ||
        !Object.values(REVIEW_STATUS).includes(status)
    ) {
        throw new Error('复习记录元数据无效');
    }

    return {
        assessment_kind: ASSESSMENT_KIND.REVIEW,
        source_test_id: sourceTestId,
        parent_review_id: parentReviewId,
        review_round: round,
        review_status: status,
        source_question_id: sourceQuestionId,
    };
}

module.exports = { buildReviewRecordFields };
