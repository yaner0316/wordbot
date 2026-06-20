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
            minutes: 12,
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
