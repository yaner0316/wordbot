const test = require('node:test');
const assert = require('node:assert/strict');

const {
    ANSWER_CONFIDENCE,
    encodeAnswer,
    evaluateMeaningMastery,
    evaluateWordMastery,
    parseStoredAnswer,
} = require('../mastery-evidence');

const DAY = 24 * 60 * 60 * 1000;

function attempt({
    time,
    type,
    correct = true,
    confidence = ANSWER_CONFIDENCE.SURE,
    testId = 'real-test',
}) {
    return {
        fields: {
            test_id: testId,
            test_time: time,
            question_type: type,
            is_correct: correct ? 'correct-option' : 'wrong-option',
            your_answer: encodeAnswer('A', confidence),
        },
    };
}

const isCorrect = value => value === 'correct-option';

test('stored answers preserve option and confidence without a new field', () => {
    assert.deepEqual(parseStoredAnswer('B|guess'), {
        option: 'B',
        confidence: ANSWER_CONFIDENCE.GUESS,
    });
    assert.deepEqual(parseStoredAnswer('C'), {
        option: 'C',
        confidence: ANSWER_CONFIDENCE.SURE,
    });
});

test('one certain correct answer is not enough for mastery', () => {
    const result = evaluateMeaningMastery([
        attempt({ time: Date.UTC(2026, 5, 1), type: 1 }),
    ], isCorrect);

    assert.equal(result.mastered, false);
    assert.equal(result.evidenceCount, 1);
});

test('two certain correct answers on different days master a meaning', () => {
    const result = evaluateMeaningMastery([
        attempt({ time: Date.UTC(2026, 5, 1), type: 1 }),
        attempt({ time: Date.UTC(2026, 5, 2), type: 1 }),
    ], isCorrect);

    assert.equal(result.mastered, true);
    assert.equal(result.distinctDays, 2);
    assert.equal(result.distinctTypes, 1);
});

test('three correct uncertain answers master a meaning', () => {
    const result = evaluateMeaningMastery([
        attempt({ time: Date.UTC(2026, 5, 1), type: 1, confidence: ANSWER_CONFIDENCE.GUESS }),
        attempt({ time: Date.UTC(2026, 5, 2), type: 2, confidence: ANSWER_CONFIDENCE.GUESS }),
        attempt({ time: Date.UTC(2026, 5, 3), type: 3, confidence: ANSWER_CONFIDENCE.GUESS }),
    ], isCorrect);

    assert.equal(result.mastered, true);
    assert.equal(result.uncertainCorrectCount, 3);
});

test('two correct uncertain answers are not enough for mastery', () => {
    const result = evaluateMeaningMastery([
        attempt({ time: Date.UTC(2026, 5, 1), type: 1, confidence: ANSWER_CONFIDENCE.GUESS }),
        attempt({ time: Date.UTC(2026, 5, 2), type: 2, confidence: ANSWER_CONFIDENCE.GUESS }),
    ], isCorrect);

    assert.equal(result.mastered, false);
    assert.equal(result.uncertainCorrectCount, 2);
});

test('two correct answers on the same day are not enough', () => {
    const result = evaluateMeaningMastery([
        attempt({ time: Date.UTC(2026, 5, 1, 8), type: 1 }),
        attempt({ time: Date.UTC(2026, 5, 1, 14), type: 2 }),
    ], isCorrect);

    assert.equal(result.mastered, false);
    assert.equal(result.distinctDays, 1);
});

test('different calendar days are evaluated in China Standard Time', () => {
    const records = [
        attempt({
            time: Date.parse('2026-06-01T15:30:00.000Z'),
            type: 1,
        }),
        attempt({
            time: Date.parse('2026-06-01T16:30:00.000Z'),
            type: 2,
        }),
    ];

    assert.equal(evaluateMeaningMastery(records, isCorrect).mastered, true);
});

test('two correct answers of the same type on different days are enough', () => {
    const result = evaluateMeaningMastery([
        attempt({ time: Date.UTC(2026, 5, 1), type: 1 }),
        attempt({ time: Date.UTC(2026, 5, 1) + DAY, type: 1 }),
    ], isCorrect);

    assert.equal(result.mastered, true);
    assert.equal(result.distinctTypes, 1);
});

test('a wrong answer resets earlier mastery evidence', () => {
    const result = evaluateMeaningMastery([
        attempt({ time: Date.UTC(2026, 5, 1), type: 1 }),
        attempt({ time: Date.UTC(2026, 5, 2), type: 2 }),
        attempt({ time: Date.UTC(2026, 5, 3), type: 3, correct: false }),
        attempt({ time: Date.UTC(2026, 5, 4), type: 1 }),
    ], isCorrect);

    assert.equal(result.mastered, false);
    assert.equal(result.evidenceCount, 1);
});

test('test-mode attempts never count as mastery evidence', () => {
    const result = evaluateMeaningMastery([
        attempt({ time: Date.UTC(2026, 5, 1), type: 1, testId: 'test-one' }),
        attempt({ time: Date.UTC(2026, 5, 2), type: 2, testId: 'test-two' }),
    ], isCorrect);

    assert.equal(result.mastered, false);
    assert.equal(result.evidenceCount, 0);
});

test('no real correct attempts remain unseen', () => {
    const result = evaluateMeaningMastery([], isCorrect);

    assert.equal(result.mastered, false);
    assert.equal(result.stage, 'unseen');
    assert.equal(result.correctAfterLastWrongCount, 0);
});

test('a multi-definition word is mastered only when every meaning is mastered', () => {
    const records = [
        { ...attempt({ time: Date.UTC(2026, 5, 1), type: 1 }), fields: { ...attempt({ time: Date.UTC(2026, 5, 1), type: 1 }).fields, record_id: 'meaning-1' } },
        { ...attempt({ time: Date.UTC(2026, 5, 2), type: 2 }), fields: { ...attempt({ time: Date.UTC(2026, 5, 2), type: 2 }).fields, record_id: 'meaning-1' } },
        { ...attempt({ time: Date.UTC(2026, 5, 1), type: 1 }), fields: { ...attempt({ time: Date.UTC(2026, 5, 1), type: 1 }).fields, record_id: 'meaning-2' } },
    ];

    const result = evaluateWordMastery(
        ['meaning-1', 'meaning-2'],
        records,
        isCorrect
    );

    assert.equal(result.mastered, false);
    assert.equal(result.meanings['meaning-1'].mastered, true);
    assert.equal(result.meanings['meaning-2'].mastered, false);
});

test('a word with partial progress reports the strongest non-mastered stage', () => {
    const records = [];
    const item = attempt({ time: Date.UTC(2026, 5, 1), type: 1 });
    item.fields.record_id = 'meaning-1';
    records.push(item);

    const result = evaluateWordMastery(
        ['meaning-1', 'meaning-2'],
        records,
        isCorrect
    );

    assert.equal(result.mastered, false);
    assert.equal(result.stage, 'recognized');
});
test('all meanings mastered marks the whole multi-definition word mastered', () => {
    const records = [];
    for (const recordId of ['meaning-1', 'meaning-2']) {
        for (const [day, type] of [[1, 1], [2, 2]]) {
            const item = attempt({ time: Date.UTC(2026, 5, day), type });
            item.fields.record_id = recordId;
            records.push(item);
        }
    }

    assert.equal(
        evaluateWordMastery(['meaning-1', 'meaning-2'], records, isCorrect).mastered,
        true
    );
});
