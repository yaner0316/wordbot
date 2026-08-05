const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildQuizWordQueue,
    buildRecentQuestionTextsByWord,
    countEligibleReadyMeaningsByLevel,
    selectCachedQuestionsForWordQueue,
} = require('../quiz-word-queue');

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
            correct_meaning: String.fromCharCode(0x91ca, 0x4e49),
            option_meanings: JSON.stringify(['释义', '错误', '错误的', '没有']),
            used_count: 0,
            ...fieldOverrides,
        },
        ...rowOverrides,
    };
}

function cacheVariant(wordIndex, variantSlot, overrides = {}) {
    return cache(`${wordIndex}-${variantSlot}`, {
        fields: {
            word_record_id: `rec-${wordIndex}`,
            word: `word-${wordIndex}`,
            variant_slot: variantSlot,
            question_fingerprint: `fp-${wordIndex}-${variantSlot}`,
            question_text: `Variant ${variantSlot} sentence for word-${wordIndex}.`,
            ...overrides,
        },
    });
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

test('word queue excludes meanings answered correctly today and keeps wrong meanings retryable', () => {
    const wordRecords = Array.from({ length: 100 }, (_, index) => word(index + 1));
    wordRecords[1].fields.Word = wordRecords[0].fields.Word;
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

    assert.deepEqual(queue, ['rec-1', 'rec-2', 'rec-3', 'rec-11', 'rec-12', 'rec-13', 'rec-14', 'rec-15', 'rec-16', 'rec-17']);
});

test('cached question selection chooses a different primary variant after the previous normal question', () => {
    const queue = ['rec-prospect'];
    const cacheRows = [
        cache('prospect-old', { fields: { word_record_id: 'rec-prospect', word: 'prospect', question_text: 'The company sees a bright _____ for growth.' } }),
        cache('prospect-new', { fields: { word_record_id: 'rec-prospect', word: 'prospect', question_text: 'The young _____ trained for a career in science.' } }),
    ];
    const selected = selectCachedQuestionsForWordQueue({
        cacheRows, queue, userId: 'student', level: LEVEL, roundType: 'primary',
        recentQuestionTextsByWord: new Map([['prospect', new Set(['The company sees a bright _____ for growth.'])]]),
        limit: 1,
    });
    assert.deepEqual(selected.map(question => question.cacheRecordId), ['cache-prospect-new']);
});

test('cached question selection excludes only the latest question text so variants can rotate', () => {
    const selected = selectCachedQuestionsForWordQueue({
        cacheRows: [
            cache('prospect-a', { fields: { word_record_id: 'rec-prospect', word: 'prospect', question_text: 'Question A _____.' } }),
            cache('prospect-b', { fields: { word_record_id: 'rec-prospect', word: 'prospect', question_text: 'Question B _____.' } }),
        ],
        queue: ['rec-prospect'],
        userId: 'student',
        level: LEVEL,
        roundType: 'primary',
        recentQuestionTextsByWord: buildRecentQuestionTextsByWord([
            { fields: { user: 'student', test_id: 'real-day-one', word: 'prospect', context: 'Question A _____.', test_time: NOW - DAY } },
            { fields: { user: 'student', test_id: 'real-day-two', word: 'prospect', context: 'Question B _____.', test_time: NOW } },
        ], { userId: 'student' }),
        limit: 1,
    });
    assert.deepEqual(selected.map(question => question.cacheRecordId), ['cache-prospect-a']);
});
test('word queue allows retrying words generated today when no answer was submitted', () => {
    const wordRecords = Array.from({ length: 20 }, (_, index) => word(index + 1));
    const cacheRows = Array.from({ length: 20 }, (_, index) => cache(index + 1));
    const generatedToday = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(index =>
        assessment(`rec-${index}`, { testId: 'real-generated', time: TODAY, correct: false, answer: '' })
    );
    for (const record of generatedToday) {
        record.fields.is_correct = null;
        record.fields.your_answer = '';
    }

    const queue = buildQuizWordQueue({
        wordRecords,
        cacheRows,
        assessmentRecords: generatedToday,
        userId: 'student',
        level: LEVEL,
        limit: 10,
        now: NOW,
        minAgeMs: 0,
    });

    assert.deepEqual(queue, ['rec-1', 'rec-2', 'rec-3', 'rec-4', 'rec-5', 'rec-6', 'rec-7', 'rec-8', 'rec-9', 'rec-10']);
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

test('word queue only includes words from the requested level', () => {
    const wordRecords = [
        ...Array.from({ length: 12 }, (_, index) => {
            const record = word(index + 1);
            record.fields.Level = 'other';
            return record;
        }),
        ...Array.from({ length: 10 }, (_, index) => {
            const record = word(index + 13);
            record.fields.Level = LEVEL;
            return record;
        }),
    ];

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

    assert.deepEqual(queue, ['rec-13', 'rec-14', 'rec-15', 'rec-16', 'rec-17', 'rec-18', 'rec-19', 'rec-20', 'rec-21', 'rec-22']);
});

test('word queue accepts a mismatched word level when ready cache exists for the requested level', () => {
    const wordRecords = Array.from({ length: 10 }, (_, index) => {
        const record = word(index + 1);
        record.fields.Level = 'other';
        return record;
    });
    const cacheRows = Array.from({ length: 10 }, (_, index) => cache(index + 1));

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

test('cached question selection rejects all junior-high type 2 rows', () => {
    const juniorHigh = String.fromCharCode(0x4e2d, 0x5b66);
    const queue = Array.from({ length: 10 }, (_, index) => `rec-${index + 1}`);
    const cacheRows = queue.map((recordId, index) => cache(index + 1, {
        fields: {
            word_record_id: recordId,
            level: juniorHigh,
            question_type: index < 9 ? 1 : 2,
        },
    }));

    const selected = selectCachedQuestionsForWordQueue({
        cacheRows,
        queue,
        userId: 'student',
        level: juniorHigh,
        roundType: 'primary',
        limit: 10,
    });

    assert.equal(selected.some(question => question.type === 2), false);
    assert.equal(selected.length, 9);
});

test('cached question selection does not backfill from ready cache rows outside the queue', () => {
    const queue = Array.from({ length: 12 }, (_, index) => `rec-${index + 1}`);
    const cacheRows = [1, 2, 3, 4, 5, 6, 7, 8, 13, 14, 15, 16].map(index => cache(index));

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
        ['cache-1', 'cache-2', 'cache-3', 'cache-4', 'cache-5', 'cache-6', 'cache-7', 'cache-8']
    );
});

test('cached question selection does not backfill bad ready rows outside the queue', () => {
    const queue = Array.from({ length: 12 }, (_, index) => `rec-${index + 1}`);
    const cacheRows = [1, 2, 3, 4, 5, 6, 7, 8].map(index => cache(index));
    cacheRows.push(cache(13, {
        fields: {
            word_record_id: 'rec-genaine',
            word: 'genaine',
            question_text: 'The student wrote _____ in the sentence.',
            options: JSON.stringify(['A. genaine', 'B. resilient', 'C. bomb', 'D. crowded']),
            answer: 'A',
            option_meanings: JSON.stringify(['bad spelling', 'strong', 'explosive', 'full']),
        },
    }));

    const selected = selectCachedQuestionsForWordQueue({
        cacheRows,
        queue,
        userId: 'student',
        level: LEVEL,
        roundType: 'primary',
        limit: 10,
    });

    assert.equal(selected.length, 8);
    assert.equal(selected.some(question => question.word === 'genaine'), false);
});

test('word queue excludes only the answered meaning and keeps another meaning with the same spelling', () => {
    const wordRecords = Array.from({ length: 12 }, (_, index) => word(index + 1));
    wordRecords[0].fields.Word = 'bank';
    wordRecords[1].fields.Word = 'bank';
    const cacheRows = Array.from({ length: 12 }, (_, index) => cache(index + 1));
    cacheRows[0].fields.word = 'bank';
    cacheRows[1].fields.word = 'bank';
    const assessmentRecords = [
        assessment('rec-1', { testId: 'real-today', time: TODAY, correct: true, answer: 'A|sure' }),
    ];
    assessmentRecords[0].fields.word = 'bank';

    const queue = buildQuizWordQueue({
        wordRecords,
        cacheRows,
        assessmentRecords,
        userId: 'student',
        level: LEVEL,
        limit: 3,
        now: NOW,
        minAgeMs: 0,
    });

    assert.deepEqual(queue, ['rec-2', 'rec-3', 'rec-4']);
});

test('review and empty submissions do not exclude a meaning from the formal queue', () => {
    const wordRecords = Array.from({ length: 12 }, (_, index) => word(index + 1));
    const cacheRows = Array.from({ length: 12 }, (_, index) => cache(index + 1));
    const reviewCorrect = assessment('rec-1', {
        testId: 'real-review-source-round-1',
        time: TODAY,
        correct: true,
        answer: 'A|sure',
    });
    reviewCorrect.fields.assessment_kind = 'review';
    const empty = assessment('rec-2', {
        testId: 'real-unsubmitted',
        time: TODAY,
        correct: false,
        answer: '',
    });
    empty.fields.is_correct = '';

    const queue = buildQuizWordQueue({
        wordRecords,
        cacheRows,
        assessmentRecords: [reviewCorrect, empty],
        userId: 'student',
        level: LEVEL,
        limit: 3,
        now: NOW,
        minAgeMs: 0,
    });

    assert.deepEqual(queue, ['rec-1', 'rec-2', 'rec-3']);
});

test('word queue keeps a meaning retryable after a submitted wrong answer today', () => {
    const wordRecords = Array.from({ length: 12 }, (_, index) => word(index + 1));
    const cacheRows = Array.from({ length: 12 }, (_, index) => cache(index + 1));
    const assessmentRecords = [
        assessment('rec-1', { testId: 'real-today', time: TODAY, correct: false, answer: 'B|sure' }),
    ];
    const queue = buildQuizWordQueue({
        wordRecords,
        cacheRows,
        assessmentRecords,
        userId: 'student',
        level: LEVEL,
        limit: 3,
        now: NOW,
        minAgeMs: 0,
    });
    assert.deepEqual(queue, ['rec-1', 'rec-2', 'rec-3']);
});

test('eligible ready meaning count requires two active distinct ready variants', () => {
    const counts = countEligibleReadyMeaningsByLevel({
        wordRecords: [word(1), word(2)],
        cacheRows: [
            cacheVariant(1, 1),
            cacheVariant(1, 2),
            cacheVariant(2, 1),
            cacheVariant(2, 2, { cache_state: 'retired' }),
        ],
        assessmentRecords: [],
        userId: 'student',
        levels: [LEVEL],
        now: NOW,
        minAgeMs: 0,
    });

    assert.deepEqual(counts, { [LEVEL]: 1 });
});

test('eligible ready meaning count accepts a stored pair when the reserved variant is for the next learning day', () => {
    const counts = countEligibleReadyMeaningsByLevel({
        wordRecords: [word(1)],
        cacheRows: [
            cacheVariant(1, 1),
            cacheVariant(1, 2, {
                cache_state: 'reserved_next_day',
                available_from: new Date(NOW + DAY).toISOString(),
            }),
        ],
        assessmentRecords: [],
        userId: 'student',
        levels: [LEVEL],
        now: NOW,
        minAgeMs: 0,
    });

    assert.equal(counts[LEVEL], 1);
});

test('future reserved variant counts as stored readiness but cannot be selected today', () => {
    const rows = [cacheVariant(1, 1), cacheVariant(1, 2, { cache_state: 'reserved_next_day', available_from: new Date(NOW + DAY).toISOString() })];
    const counts = countEligibleReadyMeaningsByLevel({ wordRecords: [word(1)], cacheRows: rows, assessmentRecords: [], userId: 'student', levels: [LEVEL], now: NOW, minAgeMs: 0 });
    const selected = selectCachedQuestionsForWordQueue({ cacheRows: rows, queue: ['rec-1'], userId: 'student', level: LEVEL, roundType: 'primary', limit: 2, now: NOW });
    assert.equal(counts[LEVEL], 1);
    assert.deepEqual(selected.map(question => question.cacheRecordId), ['cache-1-1']);
});

test('reserved variant without an availability timestamp fails closed for same-day selection', () => {
    const rows = [cacheVariant(1, 2, { cache_state: 'reserved_next_day', available_from: '' })];

    const selected = selectCachedQuestionsForWordQueue({
        cacheRows: rows,
        queue: ['rec-1'],
        userId: 'student',
        level: LEVEL,
        roundType: 'primary',
        limit: 2,
        now: NOW,
    });

    assert.deepEqual(selected, []);
});

test('eligible ready meaning count is separated by learning level', () => {
    const otherLevel = 'other';
    const secondWord = word(2);
    secondWord.fields.Level = otherLevel;
    const counts = countEligibleReadyMeaningsByLevel({
        wordRecords: [word(1), secondWord],
        cacheRows: [
            cacheVariant(1, 1),
            cacheVariant(1, 2),
            cacheVariant(2, 1, { level: otherLevel }),
            cacheVariant(2, 2, { level: otherLevel }),
        ],
        assessmentRecords: [],
        userId: 'student',
        levels: [LEVEL, otherLevel],
        now: NOW,
        minAgeMs: 0,
    });

    assert.deepEqual(counts, { [LEVEL]: 1, [otherLevel]: 1 });
});

test('eligible ready meaning count enforces the formal cooldown', () => {
    const recentWord = word(1);
    recentWord.fields.record_time = NOW - (18 * 60 * 60 * 1000) + 1;
    recentWord.created_time = recentWord.fields.record_time;
    const counts = countEligibleReadyMeaningsByLevel({
        wordRecords: [recentWord],
        cacheRows: [cacheVariant(1, 1), cacheVariant(1, 2)],
        assessmentRecords: [],
        userId: 'student',
        levels: [LEVEL],
        now: NOW,
        minAgeMs: 18 * 60 * 60 * 1000,
    });

    assert.equal(counts[LEVEL], 0);
});

test('eligible ready meaning count excludes mastered and correct-today meanings', () => {
    const counts = countEligibleReadyMeaningsByLevel({
        wordRecords: [word(1), word(2), word(3)],
        cacheRows: [1, 2, 3].flatMap(index => [cacheVariant(index, 1), cacheVariant(index, 2)]),
        assessmentRecords: [
            assessment('rec-1', { testId: 'real-old-1', time: NOW - (3 * DAY), correct: true }),
            assessment('rec-1', { testId: 'real-old-2', time: NOW - (2 * DAY), correct: true }),
            assessment('rec-2', { testId: 'real-today', time: NOW, correct: true }),
        ],
        userId: 'student',
        levels: [LEVEL],
        now: NOW,
        minAgeMs: 0,
    });

    assert.equal(counts[LEVEL], 1);
});
