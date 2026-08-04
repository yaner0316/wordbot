const test = require('node:test');
const assert = require('node:assert');

const {
    WORD_QUIZ_COOLDOWN_MS,
    getWordRecordTimestamp,
    isWordRecordPastQuizCooldown,
} = require('../quiz-cooldown');

// Test helper to create a word record
function createWordRecord({ recordTime, createdTime } = {}) {
    const record = { fields: {} };
    if (recordTime !== undefined) record.fields.record_time = recordTime;
    if (createdTime !== undefined) record.created_time = createdTime;
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

test('getWordRecordTimestamp: returns 0 when record_time is invalid', () => {
    const record = createWordRecord({ recordTime: 'invalid', createdTime: 1680000000000 });
    assert.strictEqual(getWordRecordTimestamp(record), 1680000000000);
});

test('isWordRecordPastQuizCooldown: record older than 18 hours passes', () => {
    const now = Date.now();
    const eighteenHoursAgo = now - (18 * 60 * 60 * 1000) - 1000; // 18 hours + 1 second ago
    const record = createWordRecord({ recordTime: eighteenHoursAgo });
    assert.strictEqual(isWordRecordPastQuizCooldown(record, { now }), true);
});

test('isWordRecordPastQuizCooldown: record newer than 18 hours fails', () => {
    const now = Date.now();
    const seventeenHoursAgo = now - (17 * 60 * 60 * 1000); // 17 hours ago
    const record = createWordRecord({ recordTime: seventeenHoursAgo });
    assert.strictEqual(isWordRecordPastQuizCooldown(record, { now }), false);
});

test('isWordRecordPastQuizCooldown: record exactly 18 hours old passes', () => {
    const now = Date.now();
    const exactlyEighteenHoursAgo = now - (18 * 60 * 60 * 1000);
    const record = createWordRecord({ recordTime: exactlyEighteenHoursAgo });
    assert.strictEqual(isWordRecordPastQuizCooldown(record, { now }), true);
});

test('isWordRecordPastQuizCooldown: missing timestamp fails closed', () => {
    const record = createWordRecord({});
    assert.strictEqual(isWordRecordPastQuizCooldown(record), false);
});

test('isWordRecordPastQuizCooldown: minAgeMs=0 disables cooldown', () => {
    const now = Date.now();
    const record = createWordRecord({ recordTime: now });
    assert.strictEqual(isWordRecordPastQuizCooldown(record, { now, minAgeMs: 0 }), true);
});

test('isWordRecordPastQuizCooldown: custom minAgeMs works', () => {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    const record = createWordRecord({ recordTime: oneHourAgo });
    
    // With 30 minute cooldown, should pass
    assert.strictEqual(isWordRecordPastQuizCooldown(record, { now, minAgeMs: 30 * 60 * 1000 }), true);
    
    // With 2 hour cooldown, should fail
    assert.strictEqual(isWordRecordPastQuizCooldown(record, { now, minAgeMs: 2 * 60 * 60 * 1000 }), false);
});

// Edge cases
test('isWordRecordPastQuizCooldown: future timestamp fails', () => {
    const now = Date.now();
    const future = now + (60 * 60 * 1000); // 1 hour in future
    const record = createWordRecord({ recordTime: future });
    assert.strictEqual(isWordRecordPastQuizCooldown(record, { now }), false);
});

test('isWordRecordPastQuizCooldown: negative timestamp treated as missing', () => {
    const record = createWordRecord({ recordTime: -1000 });
    assert.strictEqual(getWordRecordTimestamp(record), 0);
    assert.strictEqual(isWordRecordPastQuizCooldown(record), false);
});

test('isWordRecordPastQuizCooldown: string timestamp parsed correctly', () => {
    const now = Date.now();
    const eighteenHoursAgo = now - (18 * 60 * 60 * 1000) - 1000;
    const record = createWordRecord({ recordTime: String(eighteenHoursAgo) });
    assert.strictEqual(isWordRecordPastQuizCooldown(record, { now }), true);
});

// Security tests
test('isWordRecordPastQuizCooldown: very old record passes', () => {
    const now = Date.now();
    const veryOld = now - (365 * 24 * 60 * 60 * 1000); // 1 year ago
    const record = createWordRecord({ recordTime: veryOld });
    assert.strictEqual(isWordRecordPastQuizCooldown(record, { now }), true);
});

test('isWordRecordPastQuizCooldown: NaN timestamp treated as missing', () => {
    const record = createWordRecord({ recordTime: NaN });
    assert.strictEqual(getWordRecordTimestamp(record), 0);
    assert.strictEqual(isWordRecordPastQuizCooldown(record), false);
});
