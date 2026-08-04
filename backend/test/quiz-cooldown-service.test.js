const test = require('node:test');
const assert = require('node:assert');
const {
    WORD_QUIZ_COOLDOWN_MS,
    getWordRecordTimestamp,
    isWordRecordPastQuizCooldown,
    isWordEligibleForQuiz,
    getQuizCooldownExcludedRecordIds,
} = require('../quiz-cooldown');

// Test helper to create a word record
function createWordRecord({ recordTime, createdTime, user } = {}) {
    const record = { fields: {} };
    if (recordTime !== undefined) record.fields.record_time = recordTime;
    if (createdTime !== undefined) record.created_time = createdTime;
    if (user !== undefined) record.fields.user = user;
    return record;
}

test('WORD_QUIZ_COOLDOWN_MS is 18 hours', () => {
    const expected = 18 * 60 * 60 * 1000;
    assert.strictEqual(WORD_QUIZ_COOLDOWN_MS, expected);
    assert.strictEqual(WORD_QUIZ_COOLDOWN_MS, 64800000);
});

test('getWordRecordTimestamp: uses record_time when available', () => {
    const record = createWordRecord({ recordTime: 1690000000000, createdTime: 1680000000000 });
    assert.strictEqual(getWordRecordTimestamp(record), 1690000000000);
});

test('getWordRecordTimestamp: falls back to created_time when record_time missing', () => {
    const record = createWordRecord({ createdTime: 1680000000000 });
    assert.strictEqual(getWordRecordTimestamp(record), 1680000000000);
});

test('getWordRecordTimestamp: returns 0 when both missing', () => {
    const record = createWordRecord({});
    assert.strictEqual(getWordRecordTimestamp(record), 0);
});

test('isWordRecordPastQuizCooldown: record older than 18 hours passes', () => {
    const now = Date.now();
    const eighteenHoursAgo = now - (18 * 60 * 60 * 1000) - 1000;
    const record = createWordRecord({ recordTime: eighteenHoursAgo });
    assert.strictEqual(isWordRecordPastQuizCooldown(record, { now }), true);
});

test('isWordRecordPastQuizCooldown: record newer than 18 hours fails', () => {
    const now = Date.now();
    const seventeenHoursAgo = now - (17 * 60 * 60 * 1000);
    const record = createWordRecord({ recordTime: seventeenHoursAgo });
    assert.strictEqual(isWordRecordPastQuizCooldown(record, { now }), false);
});

test('isWordRecordPastQuizCooldown: missing timestamp fails (conservative)', () => {
    const record = createWordRecord({});
    assert.strictEqual(isWordRecordPastQuizCooldown(record), false);
});

test('isWordRecordPastQuizCooldown: minAgeMs=0 disables cooldown', () => {
    const now = Date.now();
    const record = createWordRecord({ recordTime: now });
    assert.strictEqual(isWordRecordPastQuizCooldown(record, { now, minAgeMs: 0 }), true);
});

test('isWordEligibleForQuiz: delegates to isWordRecordPastQuizCooldown', () => {
    const now = Date.now();
    const eighteenHoursAgo = now - (18 * 60 * 60 * 1000) - 1000;
    const record = createWordRecord({ recordTime: eighteenHoursAgo });
    assert.strictEqual(isWordEligibleForQuiz(record, { now }), true);
});

test('getQuizCooldownExcludedRecordIds: excludes records in cooldown', () => {
    const now = Date.now();
    const eighteenHoursAgo = now - (18 * 60 * 60 * 1000) - 1000;
    const seventeenHoursAgo = now - (17 * 60 * 60 * 1000);
    
    const records = [
        { record_id: 'rec1', fields: { user: 'testuser', record_time: eighteenHoursAgo } },
        { record_id: 'rec2', fields: { user: 'testuser', record_time: seventeenHoursAgo } },
        { record_id: 'rec3', fields: { user: 'otheruser', record_time: seventeenHoursAgo } },
    ];
    
    const excluded = getQuizCooldownExcludedRecordIds(records, 'testuser', now);
    assert.strictEqual(excluded.size, 1);
    assert.strictEqual(excluded.has('rec2'), true);
    assert.strictEqual(excluded.has('rec1'), false);
    assert.strictEqual(excluded.has('rec3'), false);
});

test('getQuizCooldownExcludedRecordIds: handles empty records', () => {
    const excluded = getQuizCooldownExcludedRecordIds([], 'testuser');
    assert.strictEqual(excluded.size, 0);
});

test('getQuizCooldownExcludedRecordIds: handles null records', () => {
    const excluded = getQuizCooldownExcludedRecordIds(null, 'testuser');
    assert.strictEqual(excluded.size, 0);
});

test('isWordRecordPastQuizCooldown: exact 18 hour boundary passes', () => {
    const now = Date.now();
    const record = createWordRecord({ recordTime: now - WORD_QUIZ_COOLDOWN_MS });
    assert.strictEqual(isWordRecordPastQuizCooldown(record, { now }), true);
});

test('isWordRecordPastQuizCooldown: one millisecond before boundary fails', () => {
    const now = Date.now();
    const record = createWordRecord({ recordTime: now - WORD_QUIZ_COOLDOWN_MS + 1 });
    assert.strictEqual(isWordRecordPastQuizCooldown(record, { now }), false);
});
