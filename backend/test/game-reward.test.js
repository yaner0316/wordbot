const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateGameReward } = require('../game-reward');

test('grants the high reward for a perfect real quiz score', () => {
    assert.deepEqual(
        calculateGameReward({
            testId: 'real-quiz-1',
            mode: 'real',
            correct: 10,
            total: 10,
        }),
        {
            eligible: true,
            minutes: 10,
            tier: 'perfect',
            reason: 'perfect_score',
        }
    );
});

test('grants the regular reward for nine correct answers', () => {
    assert.deepEqual(
        calculateGameReward({
            testId: 'real-quiz-2',
            mode: 'real',
            correct: 9,
            total: 10,
        }),
        {
            eligible: true,
            minutes: 5,
            tier: 'excellent',
            reason: 'excellent_score',
        }
    );
});

test('deducts five minutes for five or more wrong answers in a real full quiz', () => {
    assert.deepEqual(
        calculateGameReward({
            testId: 'real-quiz-3',
            mode: 'real',
            correct: 5,
            total: 10,
        }),
        {
            eligible: true,
            minutes: -5,
            tier: 'penalty',
            reason: 'five_or_more_wrong',
        }
    );
});

test('does not grant game time for a perfect partial formal quiz', () => {
    assert.deepEqual(
        calculateGameReward({
            testId: 'real-partial-quiz',
            mode: 'real',
            correct: 9,
            total: 9,
        }),
        {
            eligible: false,
            minutes: 0,
            tier: 'none',
            reason: 'incomplete_quiz',
        }
    );
});

test('does not grant a reward for review rounds or test mode', () => {
    assert.equal(
        calculateGameReward({
            testId: 'real-review-1',
            mode: 'real',
            correct: 10,
            total: 10,
        }).eligible,
        false
    );
    assert.equal(
        calculateGameReward({
            testId: 'test-quiz-1',
            mode: 'test',
            correct: 10,
            total: 10,
        }).eligible,
        false
    );
});
