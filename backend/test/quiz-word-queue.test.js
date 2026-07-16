const test = require('node:test');
const assert = require('node:assert/strict');

const { buildQuizWordQueue, selectCachedQuestionsForWordQueue } = require('../quiz-word-queue');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-15T04:00:00.000Z');
const YESTERDAY = NOW - DAY;
const TODAY = NOW;
const LEVEL = 'middle';

function word(index, overrides = {}) {
    return {
        record_id: `rec-${index}`,
        created_time: index,
        fields: {
            user: 'student',
            Word: `word-${index}`,
            record_time: index,
            ...overrides.fields,
        },
        ...overrides,
    };
}

function cache(index, overrides = {}) {
    const { fields: fieldOverrides = {}, ...rowOverrides } = overrides;
    return {
        record_id: `cache-${index}`,
        fields: {
            user: 'student',
            word_record_id: `rec-${index}`,
            word: `word-${index}`,
            level: LEVEL,
            round_type: 'primary',
            quality_status: 'ready',
            question_type: 1,
            question_text: `A clear sentence for word-${index}.`,
            options: JSON.stringify(['A. word', 'B. bad', 'C. wrong', 'D. no']),
            answer: 'A',
            option_meanings: JSON.stringify(['meaning', 'bad', 'wrong', 'no']),
            used_count: 0,
            ...fieldOverrides,
        },
        ...rowOverrides,
    };
}

function assessment(recordId, { testId = 'real-old', time = YESTERDAY, correct = false, answer = 'B|sure' } = {}) {
    return {
        fields: {
            user: 'student',
            test_id: testId,
            record_id: recordId,
            word: recordId.replace('rec-', 'word-'),
            question_type: 1,
            test_time: time,
            is_correct: correct ? 'correct' : 'wrong',
            your_answer: answer,
        },
    };
}

test('word queue prioritizes unmastered touched words and fills with earliest unseen words', () => {
    const wordRecords = Array.from({ length: 100 }, (_, index) => word(index + 1));
    const cacheRows = Array.from({ length: 100 }, (_, index) => cache(index + 1));
    const assessmentRecords = [1, 2, 3, 4, 5].map(index => assessment(`rec-${index}`));

    const queue = buildQuizWordQueue({
        wordRecords,
        cacheRows,
        assessmentRecords,
        userId: 'student',
        level: LEVEL,
        limit: 10,
        now: NOW,
        minAgeMs: 0,
    });

    assert.deepEqual(queue, ['rec-1', 'rec-2', 'rec-3', 'rec-4', 'rec-5', 'rec-6', 'rec-7', 'rec-8', 'rec-9', 'rec-10']);
});

test('word queue skips words already attempted today when building the next same-day quiz', () => {
    const wordRecords = Array.from({ length: 100 }, (_, index) => word(index + 1));
    const cacheRows = Array.from({ length: 100 }, (_, index) => cache(index + 1));
    const assessmentRecords = [
        ...[1, 2, 3, 4, 5].map(index => assessment(`rec-${index}`, { time: YESTERDAY })),
        ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(index => assessment(`rec-${index}`, { testId: 'real-today', time: TODAY, correct: index > 3 })),
    ];

    const queue = buildQuizWordQueue({
        wordRecords,
        cacheRows,
        assessmentRecords,
        userId: 'student',
        level: LEVEL,
        limit: 10,
        now: NOW,
        minAgeMs: 0,
    });

    assert.deepEqual(queue, ['rec-11', 'rec-12', 'rec-13', 'rec-14', 'rec-15', 'rec-16', 'rec-17', 'rec-18', 'rec-19', 'rec-20']);
});

test('word queue still introduces earliest eligible words when cache rows were used before', () => {
    const wordRecords = Array.from({ length: 20 }, (_, index) => word(index + 1));
    const cacheRows = Array.from({ length: 20 }, (_, index) => cache(index + 1, { fields: { used_count: 1 } }));

    const queue = buildQuizWordQueue({
        wordRecords,
        cacheRows,
        assessmentRecords: [],
        userId: 'student',
        level: LEVEL,
        limit: 10,
        now: NOW,
        minAgeMs: 0,
    });

    assert.deepEqual(queue, ['rec-1', 'rec-2', 'rec-3', 'rec-4', 'rec-5', 'rec-6', 'rec-7', 'rec-8', 'rec-9', 'rec-10']);
});

test('word queue is based on words even before ready cache rows exist', () => {
    const wordRecords = Array.from({ length: 20 }, (_, index) => word(index + 1));

    const queue = buildQuizWordQueue({
        wordRecords,
        cacheRows: [],
        assessmentRecords: [],
        userId: 'student',
        level: LEVEL,
        limit: 10,
        now: NOW,
        minAgeMs: 0,
    });

    assert.deepEqual(queue, ['rec-1', 'rec-2', 'rec-3', 'rec-4', 'rec-5', 'rec-6', 'rec-7', 'rec-8', 'rec-9', 'rec-10']);
});


test('cached question selection fills from later ready rows in word queue order', () => {
    const queue = Array.from({ length: 14 }, (_, index) => `rec-${index + 1}`);
    const cacheRows = [1, 2, 5, 7, 8, 9, 10, 11, 12, 13, 14].map(index => cache(index));

    const selected = selectCachedQuestionsForWordQueue({
        cacheRows,
        queue,
        userId: 'student',
        level: LEVEL,
        roundType: 'primary',
        limit: 10,
    });

    assert.deepEqual(
        selected.map(question => question.cacheRecordId),
        ['cache-1', 'cache-2', 'cache-5', 'cache-7', 'cache-8', 'cache-9', 'cache-10', 'cache-11', 'cache-12', 'cache-13']
    );
});
