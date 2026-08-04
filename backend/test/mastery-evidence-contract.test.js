const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateMeaningMastery } = require('../mastery-evidence');

const shanghai = (day, hour = 10) => Date.UTC(2026, 7, day, hour - 8);
const record = ({ testId, day, correct, kind, submitted = true }) => ({
    fields: {
        test_id: testId,
        test_time: shanghai(day),
        is_correct: submitted ? correct : null,
        your_answer: submitted ? 'A|sure' : '',
        assessment_kind: kind || 'quiz',
        question_type: 1,
    },
});
const isCorrect = value => value === 'correct';

test('review and test-mode answers never count toward mastery', () => {
    const result = evaluateMeaningMastery([
        record({ testId: 'real-day-1', day: 1, correct: 'correct' }),
        record({ testId: 'real-review-1', day: 2, correct: 'correct', kind: 'review' }),
        record({ testId: 'test-day-3', day: 3, correct: 'correct' }),
    ], isCorrect);
    assert.equal(result.mastered, false);
    assert.equal(result.distinctDays, 1);
});

test('an unsubmitted assessment neither counts nor resets a correct sequence', () => {
    const result = evaluateMeaningMastery([
        record({ testId: 'real-day-1', day: 1, correct: 'correct' }),
        record({ testId: 'real-day-2', day: 2, submitted: false }),
        record({ testId: 'real-day-3', day: 3, correct: 'correct' }),
    ], isCorrect);
    assert.equal(result.mastered, true);
    assert.equal(result.distinctDays, 2);
});
