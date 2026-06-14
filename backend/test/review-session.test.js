const test = require('node:test');
const assert = require('node:assert/strict');

const {
    ASSESSMENT_KIND,
    REVIEW_STATUS,
    createReviewId,
    getAssessmentKind,
    getReviewMode,
    summarizeReviewRound,
} = require('../review-session');

test('review ids retain assessment mode and identify review records', () => {
    const id = createReviewId('test', () => 'abc123');

    assert.equal(id, 'test-review-abc123');
    assert.equal(getReviewMode(id), 'test');
    assert.equal(getAssessmentKind(id), ASSESSMENT_KIND.REVIEW);
});

test('normal and legacy ids remain quiz assessments', () => {
    assert.equal(getAssessmentKind('real-abc123'), ASSESSMENT_KIND.QUIZ);
    assert.equal(getAssessmentKind('legacy-id'), ASSESSMENT_KIND.QUIZ);
});

test('round summary returns only still-wrong record ids', () => {
    assert.deepEqual(
        summarizeReviewRound([
            { recordId: 'word-1', correct: true },
            { recordId: 'word-2', correct: false },
        ]),
        {
            reviewed: 2,
            correct: 1,
            remainingRecordIds: ['word-2'],
            complete: false,
            status: REVIEW_STATUS.SUBMITTED,
        }
    );
});

test('round summary marks an all-correct review complete', () => {
    assert.equal(
        summarizeReviewRound([{ recordId: 'word-1', correct: true }]).status,
        REVIEW_STATUS.COMPLETE
    );
});
