const test = require('node:test');
const assert = require('node:assert/strict');

const {
    DEFAULT_LEARNING_LEVEL,
    normalizeLearningLevel,
    buildLearningSettings,
    validateLearningLevelChange,
} = require('../user-learning-settings');

const NOW = Date.UTC(2026, 5, 16, 0, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

test('defaults learning settings to middle school level', () => {
    const settings = buildLearningSettings({ userId: 'qiuqiu', record: null, now: NOW });

    assert.equal(settings.userId, 'qiuqiu');
    assert.equal(settings.learningLevel, DEFAULT_LEARNING_LEVEL);
    assert.equal(settings.canChangeLevel, true);
    assert.equal(settings.questionCacheStatus, 'not_started');
});

test('allows a level change when the last change was at least 30 days ago', () => {
    const result = validateLearningLevelChange({
        currentLevel: '中学',
        requestedLevel: '高中',
        lastChangedAt: NOW - 31 * DAY,
        now: NOW,
    });

    assert.equal(result.ok, true);
    assert.equal(result.nextLevelChangeAt, NOW + 30 * DAY);
});

test('rejects a level change inside the 30 day cooldown', () => {
    const result = validateLearningLevelChange({
        currentLevel: '中学',
        requestedLevel: '高中',
        lastChangedAt: NOW - 10 * DAY,
        now: NOW,
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'cooldown');
    assert.equal(result.nextLevelChangeAt, NOW + 20 * DAY);
});

test('normalizes known learning levels and rejects unknown values', () => {
    assert.equal(normalizeLearningLevel('小学'), '小学');
    assert.equal(normalizeLearningLevel('CET/TOEFL'), 'CET4_6_TOEFL');
    assert.throws(() => normalizeLearningLevel('大学'), /invalid learning level/);
});
