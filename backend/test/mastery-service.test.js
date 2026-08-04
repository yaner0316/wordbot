const test = require('node:test');
const assert = require('node:assert');
const {
    evaluateMeaning,
    evaluateWord,
    summarizeProgress,
    isWordEligibleForQuiz,
    getWordTimestamp,
} = require('../mastery-service');

// Helper to create a mock record
function createRecord({ recordId = 'rec1', testId = 'real-t1', testTime, isCorrect, yourAnswer = '1|sure', questionType = 1 }) {
    return {
        fields: {
            record_id: recordId,
            test_id: testId,
            test_time: testTime,
            is_correct: isCorrect,
            your_answer: yourAnswer,
            question_type: questionType,
        },
    };
}

// Helper to get timestamp for a specific date
function getTimestamp(year, month, day, hour = 10) {
    // Shanghai is UTC+8 and does not observe daylight saving time.
    return Date.UTC(year, month - 1, day, hour - 8, 0, 0);
}

test('evaluateMeaning: no attempts returns unseen', () => {
    const result = evaluateMeaning([], () => true);
    assert.strictEqual(result.stage, 'unseen');
    assert.strictEqual(result.mastered, false);
});

test('evaluateMeaning: two correct attempts different days returns mastered', () => {
    const records = [
        createRecord({ testTime: getTimestamp(2026, 8, 1), isCorrect: '1' }),
        createRecord({ testTime: getTimestamp(2026, 8, 3), isCorrect: '1' }),
    ];
    const result = evaluateMeaning(records, v => v === '1');
    assert.strictEqual(result.stage, 'mastered');
    assert.strictEqual(result.mastered, true);
});

test('evaluateWord: single meaning mastered', () => {
    const records = [
        createRecord({ recordId: 'rec1', testTime: getTimestamp(2026, 8, 1), isCorrect: '1' }),
        createRecord({ recordId: 'rec1', testTime: getTimestamp(2026, 8, 2), isCorrect: '1' }),
    ];
    const result = evaluateWord(['rec1'], records, v => v === '1');
    assert.strictEqual(result.mastered, true);
    assert.strictEqual(result.stage, 'mastered');
});

test('evaluateWord: multiple meanings all mastered', () => {
    const records = [
        createRecord({ recordId: 'rec1', testTime: getTimestamp(2026, 8, 1), isCorrect: '1' }),
        createRecord({ recordId: 'rec1', testTime: getTimestamp(2026, 8, 2), isCorrect: '1' }),
        createRecord({ recordId: 'rec2', testTime: getTimestamp(2026, 8, 1), isCorrect: '1' }),
        createRecord({ recordId: 'rec2', testTime: getTimestamp(2026, 8, 2), isCorrect: '1' }),
    ];
    const result = evaluateWord(['rec1', 'rec2'], records, v => v === '1');
    assert.strictEqual(result.mastered, true);
    assert.strictEqual(result.stage, 'mastered');
});

test('summarizeProgress: groups words correctly', () => {
    const wordRecords = [
        { fields: { Word: 'bank' }, record_id: 'rec1' },
        { fields: { Word: 'bank' }, record_id: 'rec2' },
        { fields: { Word: 'apple' }, record_id: 'rec3' },
    ];
    const submittedRecords = [
        createRecord({ recordId: 'rec1', testTime: getTimestamp(2026, 8, 1), isCorrect: '1' }),
        createRecord({ recordId: 'rec1', testTime: getTimestamp(2026, 8, 2), isCorrect: '1' }),
        createRecord({ recordId: 'rec2', testTime: getTimestamp(2026, 8, 1), isCorrect: '1' }),
        createRecord({ recordId: 'rec2', testTime: getTimestamp(2026, 8, 2), isCorrect: '1' }),
    ];
    
    const result = summarizeProgress(
        wordRecords,
        submittedRecords,
        v => v === '1',
        record => record.fields?.Word?.trim().toLowerCase(),
        record => record.record_id
    );
    
    assert.strictEqual(result.totalWords, 2);
    assert.strictEqual(result.masteredWords, 1); // bank is mastered
    assert.strictEqual(result.unseenWords, 1); // apple is unseen
});

test('isWordEligibleForQuiz: record older than 18 hours is eligible', () => {
    const now = Date.now();
    const eighteenHoursAgo = now - (18 * 60 * 60 * 1000) - 1000;
    const word = { fields: { record_time: eighteenHoursAgo } };
    assert.strictEqual(isWordEligibleForQuiz(word, { now }), true);
});

test('isWordEligibleForQuiz: record newer than 18 hours is not eligible', () => {
    const now = Date.now();
    const seventeenHoursAgo = now - (17 * 60 * 60 * 1000);
    const word = { fields: { record_time: seventeenHoursAgo } };
    assert.strictEqual(isWordEligibleForQuiz(word, { now }), false);
});

test('isWordEligibleForQuiz: missing timestamp is not eligible (conservative)', () => {
    const word = { fields: {} };
    assert.strictEqual(isWordEligibleForQuiz(word), false);
});

test('getWordTimestamp: uses record_time when available', () => {
    const record = { fields: { record_time: 1690000000000 }, created_time: 1680000000000 };
    assert.strictEqual(getWordTimestamp(record), 1690000000000);
});

test('getWordTimestamp: falls back to created_time', () => {
    const record = { created_time: 1680000000000 };
    assert.strictEqual(getWordTimestamp(record), 1680000000000);
});

test('getWordTimestamp: returns 0 when both missing', () => {
    const record = {};
    assert.strictEqual(getWordTimestamp(record), 0);
});

test('evaluateMeaning: a wrong answer resets the two-day sequence', () => {
    const records = [
        createRecord({ testTime: getTimestamp(2026, 8, 3), isCorrect: '1' }),
        createRecord({ testTime: getTimestamp(2026, 8, 4), isCorrect: '0' }),
        createRecord({ testTime: getTimestamp(2026, 8, 5), isCorrect: '1' }),
    ];
    const result = evaluateMeaning(records, v => v === '1');
    assert.strictEqual(result.mastered, false);
    assert.strictEqual(result.distinctDays, 1);
    assert.strictEqual(result.correctAfterLastWrongCount, 1);
});

test('evaluateMeaning: same-day correct answers count as one learning day', () => {
    const records = [
        createRecord({ testTime: getTimestamp(2026, 8, 3, 9), isCorrect: '1' }),
        createRecord({ testTime: getTimestamp(2026, 8, 3, 18), isCorrect: '1' }),
    ];
    const result = evaluateMeaning(records, v => v === '1');
    assert.strictEqual(result.mastered, false);
    assert.strictEqual(result.distinctDays, 1);
});
