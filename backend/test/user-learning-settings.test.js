const test = require('node:test');
const assert = require('node:assert/strict');

const {
    DEFAULT_LEARNING_LEVEL,
    normalizeLearningLevel,
    buildLearningSettings,
    createLearningSettingsOverlay,
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
    const elementary = String.fromCharCode(0x5c0f, 0x5b66);
    assert.equal(normalizeLearningLevel(elementary), elementary);
    assert.equal(normalizeLearningLevel(String.fromCodePoint(0x0421, 0x0467)), elementary);
    assert.equal(normalizeLearningLevel('??'), elementary);
    assert.equal(normalizeLearningLevel('CET/TOEFL'), 'CET4_6_TOEFL');
    assert.throws(() => normalizeLearningLevel('大学'), /invalid learning level/);
});

test('learning settings overlay returns saved settings during the consistency window', () => {
    let now = NOW;
    const overlay = createLearningSettingsOverlay({ ttlMs: 1000, now: () => now });
    const saved = {
        userId: 'temp-user',
        learningLevel: '小学',
        levelChangedAt: NOW,
        nextLevelChangeAt: NOW + 30 * DAY,
        canChangeLevel: false,
        questionCacheStatus: 'building',
    };

    overlay.set('temp-user', saved);

    assert.deepEqual(overlay.get('temp-user'), saved);
    now += 1001;
    assert.equal(overlay.get('temp-user'), null);
});
