const test = require('node:test');
const assert = require('node:assert/strict');

const { buildReviewRecordFields } = require('../review-record');

test('serializes review linkage explicitly', () => {
    assert.deepEqual(
        buildReviewRecordFields({
            sourceTestId: 'real-q1',
            parentReviewId: '',
            round: 1,
            status: 'active',
            sourceQuestionId: 'question-row-1',
        }),
        {
            assessment_kind: 'review',
            source_test_id: 'real-q1',
            parent_review_id: '',
            review_round: 1,
            review_status: 'active',
            source_question_id: 'question-row-1',
        }
    );
});

test('rejects invalid review metadata', () => {
    assert.throws(
        () => buildReviewRecordFields({
            sourceTestId: '',
            round: 0,
            status: 'active',
        }),
        /复习记录/
    );
});
