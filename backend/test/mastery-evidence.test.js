const test = require('node:test');
const assert = require('node:assert');
const {
    ANSWER_CONFIDENCE,
    evaluateMeaningMastery,
    evaluateWordMastery,
    normalizeSubmittedAnswer,
    parseStoredAnswer,
    encodeAnswer,
} = require('../mastery-evidence');

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
    return new Date(year, month - 1, day, hour, 0, 0).getTime();
}

test('ANSWER_CONFIDENCE constants', () => {
    assert.strictEqual(ANSWER_CONFIDENCE.SURE, 'sure');
    assert.strictEqual(ANSWER_CONFIDENCE.GUESS, 'guess');
});

test('normalizeSubmittedAnswer with integer', () => {
    const result = normalizeSubmittedAnswer(2);
    assert.deepStrictEqual(result, { option: 2, confidence: 'sure' });
});

test('normalizeSubmittedAnswer with object', () => {
    const result = normalizeSubmittedAnswer({ option: 1, confidence: 'guess' });
    assert.deepStrictEqual(result, { option: 1, confidence: 'guess' });
});

test('normalizeSubmittedAnswer with null confidence defaults to sure', () => {
    const result = normalizeSubmittedAnswer({ option: 1, confidence: null });
    assert.deepStrictEqual(result, { option: 1, confidence: 'sure' });
});

test('normalizeSubmittedAnswer throws on invalid format', () => {
    assert.throws(() => normalizeSubmittedAnswer('invalid'), /ANSWER_FORMAT_INVALID/);
});

test('encodeAnswer creates stored format', () => {
    assert.strictEqual(encodeAnswer(1, 'sure'), '1|sure');
    assert.strictEqual(encodeAnswer(2, 'guess'), '2|guess');
});

test('parseStoredAnswer parses stored format', () => {
    assert.deepStrictEqual(parseStoredAnswer('1|sure'), { option: '1', confidence: 'sure' });
    assert.deepStrictEqual(parseStoredAnswer('2|guess'), { option: '2', confidence: 'guess' });
    assert.deepStrictEqual(parseStoredAnswer('1'), { option: '1', confidence: 'sure' });
});

test('evaluateMeaningMastery: no attempts returns unseen', () => {
    const result = evaluateMeaningMastery([], () => true);
    assert.strictEqual(result.stage, 'unseen');
    assert.strictEqual(result.mastered, false);
    assert.strictEqual(result.evidenceCount, 0);
});

test('evaluateMeaningMastery: single correct attempt returns consolidating', () => {
    const records = [
        createRecord({ testTime: getTimestamp(2026, 8, 1), isCorrect: '1' }),
    ];
    const result = evaluateMeaningMastery(records, v => v === '1');
    assert.strictEqual(result.stage, 'consolidating');
    assert.strictEqual(result.mastered, false);
    assert.strictEqual(result.correctAfterLastWrongCount, 1);
});

test('evaluateMeaningMastery: two correct attempts same day returns consolidating', () => {
    const records = [
        createRecord({ testTime: getTimestamp(2026, 8, 1, 10), isCorrect: '1' }),
        createRecord({ testTime: getTimestamp(2026, 8, 1, 14), isCorrect: '1' }),
    ];
    const result = evaluateMeaningMastery(records, v => v === '1');
    assert.strictEqual(result.stage, 'consolidating');
    assert.strictEqual(result.mastered, false);
    assert.strictEqual(result.correctAfterLastWrongCount, 2);
    assert.strictEqual(result.distinctDays, 1);
});

test('evaluateMeaningMastery: two correct attempts different days returns mastered', () => {
    const records = [
        createRecord({ testTime: getTimestamp(2026, 8, 1), isCorrect: '1' }),
        createRecord({ testTime: getTimestamp(2026, 8, 3), isCorrect: '1' }),
    ];
    const result = evaluateMeaningMastery(records, v => v === '1');
    assert.strictEqual(result.stage, 'mastered');
    assert.strictEqual(result.mastered, true);
    assert.strictEqual(result.correctAfterLastWrongCount, 2);
    assert.strictEqual(result.distinctDays, 2);
});

test('evaluateMeaningMastery: wrong answer resets progress', () => {
    const records = [
        createRecord({ testTime: getTimestamp(2026, 8, 1), isCorrect: '1' }),
        createRecord({ testTime: getTimestamp(2026, 8, 2), isCorrect: '0' }), // wrong
        createRecord({ testTime: getTimestamp(2026, 8, 3), isCorrect: '1' }),
        createRecord({ testTime: getTimestamp(2026, 8, 4), isCorrect: '1' }),
    ];
    const result = evaluateMeaningMastery(records, v => v === '1');
    assert.strictEqual(result.stage, 'mastered');
    assert.strictEqual(result.mastered, true);
    assert.strictEqual(result.correctAfterLastWrongCount, 2);
    assert.strictEqual(result.distinctDays, 2);
});

test('evaluateMeaningMastery: wrong answer after mastery resets to consolidating', () => {
    const records = [
        createRecord({ testTime: getTimestamp(2026, 8, 1), isCorrect: '1' }),
        createRecord({ testTime: getTimestamp(2026, 8, 2), isCorrect: '1' }), // mastered
        createRecord({ testTime: getTimestamp(2026, 8, 3), isCorrect: '0' }), // wrong
    ];
    const result = evaluateMeaningMastery(records, v => v === '1');
    assert.strictEqual(result.stage, 'recognized');
    assert.strictEqual(result.mastered, false);
    assert.strictEqual(result.correctAfterLastWrongCount, 0);
});

test('evaluateMeaningMastery: guess answers count as evidence', () => {
    const records = [
        createRecord({ testTime: getTimestamp(2026, 8, 1), isCorrect: '1', yourAnswer: '1|guess' }),
        createRecord({ testTime: getTimestamp(2026, 8, 2), isCorrect: '1', yourAnswer: '1|guess' }),
    ];
    const result = evaluateMeaningMastery(records, v => v === '1');
    assert.strictEqual(result.mastered, true);
    assert.strictEqual(result.uncertainCorrectCount, 2);
});

test('evaluateMeaningMastery: non-real assessments are ignored', () => {
    const records = [
        createRecord({ testId: 'test-t1', testTime: getTimestamp(2026, 8, 1), isCorrect: '1' }),
        createRecord({ testId: 'real-t1', testTime: getTimestamp(2026, 8, 2), isCorrect: '1' }),
        createRecord({ testId: 'real-t2', testTime: getTimestamp(2026, 8, 3), isCorrect: '1' }),
    ];
    const result = evaluateMeaningMastery(records, v => v === '1');
    assert.strictEqual(result.mastered, true);
    assert.strictEqual(result.evidenceCount, 2); // only real assessments counted
});

test('evaluateWordMastery: single meaning mastered', () => {
    const records = [
        createRecord({ recordId: 'rec1', testTime: getTimestamp(2026, 8, 1), isCorrect: '1' }),
        createRecord({ recordId: 'rec1', testTime: getTimestamp(2026, 8, 2), isCorrect: '1' }),
    ];
    const result = evaluateWordMastery(['rec1'], records, v => v === '1');
    assert.strictEqual(result.mastered, true);
    assert.strictEqual(result.stage, 'mastered');
});

test('evaluateWordMastery: multiple meanings all mastered', () => {
    const records = [
        createRecord({ recordId: 'rec1', testTime: getTimestamp(2026, 8, 1), isCorrect: '1' }),
        createRecord({ recordId: 'rec1', testTime: getTimestamp(2026, 8, 2), isCorrect: '1' }),
        createRecord({ recordId: 'rec2', testTime: getTimestamp(2026, 8, 1), isCorrect: '1' }),
        createRecord({ recordId: 'rec2', testTime: getTimestamp(2026, 8, 2), isCorrect: '1' }),
    ];
    const result = evaluateWordMastery(['rec1', 'rec2'], records, v => v === '1');
    assert.strictEqual(result.mastered, true);
    assert.strictEqual(result.stage, 'mastered');
});

test('evaluateWordMastery: one meaning not mastered', () => {
    const records = [
        createRecord({ recordId: 'rec1', testTime: getTimestamp(2026, 8, 1), isCorrect: '1' }),
        createRecord({ recordId: 'rec1', testTime: getTimestamp(2026, 8, 2), isCorrect: '1' }),
        createRecord({ recordId: 'rec2', testTime: getTimestamp(2026, 8, 1), isCorrect: '1' }),
        // rec2 only has one correct attempt
    ];
    const result = evaluateWordMastery(['rec1', 'rec2'], records, v => v === '1');
    assert.strictEqual(result.mastered, false);
    assert.strictEqual(result.stage, 'mastered'); // strongest stage wins
});

test('evaluateWordMastery: empty recordIds returns not mastered', () => {
    const result = evaluateWordMastery([], [], v => v === '1');
    assert.strictEqual(result.mastered, false);
    assert.strictEqual(result.stage, 'unseen');
});

// Edge cases
test('evaluateMeaningMastery: non-consecutive days still mastered', () => {
    const records = [
        createRecord({ testTime: getTimestamp(2026, 8, 1), isCorrect: '1' }), // Monday
        createRecord({ testTime: getTimestamp(2026, 8, 4), isCorrect: '1' }), // Thursday
    ];
    const result = evaluateMeaningMastery(records, v => v === '1');
    assert.strictEqual(result.mastered, true);
    assert.strictEqual(result.distinctDays, 2);
});

test('evaluateMeaningMastery: many wrong answers before correct', () => {
    const records = [
        createRecord({ testTime: getTimestamp(2026, 8, 1), isCorrect: '0' }),
        createRecord({ testTime: getTimestamp(2026, 8, 2), isCorrect: '0' }),
        createRecord({ testTime: getTimestamp(2026, 8, 3), isCorrect: '1' }),
        createRecord({ testTime: getTimestamp(2026, 8, 4), isCorrect: '1' }),
    ];
    const result = evaluateMeaningMastery(records, v => v === '1');
    assert.strictEqual(result.mastered, true);
    assert.strictEqual(result.correctAfterLastWrongCount, 2);
});

test('evaluateMeaningMastery: mixed sure and guess answers', () => {
    const records = [
        createRecord({ testTime: getTimestamp(2026, 8, 1), isCorrect: '1', yourAnswer: '1|sure' }),
        createRecord({ testTime: getTimestamp(2026, 8, 2), isCorrect: '1', yourAnswer: '1|guess' }),
    ];
    const result = evaluateMeaningMastery(records, v => v === '1');
    assert.strictEqual(result.mastered, true);
    assert.strictEqual(result.uncertainCorrectCount, 1);
});
