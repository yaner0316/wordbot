const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildQuizWordQueue,
    buildRecentQuestionTextsByWord,
    countEligibleReadyMeaningsByLevel,
    selectCachedQuestionsForWordQueue,
} = require('../quiz-word-queue');
const { evaluateMeaningMastery } = require('../mastery-evidence');

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
            ai_audit_status: 'approved',
            question_type: 1,
            question_text: `A clear sentence for word-${index}.`,
            context_cn: `\u8fd9\u662fword-${index}\u5bf9\u5e94\u7684\u5b8c\u6574\u4e2d\u6587\u53e5\u5b50\u3002`,
            options: JSON.stringify(['A. word', 'B. bad', 'C. wrong', 'D. no']),
            answer: 'A',
            correct_meaning: String.fromCharCode(0x91ca, 0x4e49),
            option_meanings: JSON.stringify(['释义', '错误', '错误的', '没有']),
            used_count: 0,
            ...fieldOverrides,
            question_fingerprint: fieldOverrides.question_fingerprint || `fp-${index}`,
            option_meanings: fieldOverrides.option_meanings || JSON.stringify(['\u91ca\u4e49', '\u9519\u8bef', '\u4e0d\u5bf9', '\u6ca1\u6709']),
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
            options: JSON.stringify(['A. word-' + wordIndex, 'B. distractor-' + variantSlot + '-1', 'C. distractor-' + variantSlot + '-2', 'D. distractor-' + variantSlot + '-3']),
            ...overrides,
        },
    });
}

function assessment(recordId, { testId = 'real-old', time = YESTERDAY, correct = false, answer = 'B|sure', questionText = '' } = {}) {
    return {
        fields: {
            user: 'student',
            test_id: testId,
            record_id: recordId,
            word: recordId.replace('rec-', 'word-'),
            question_type: 1,
            question_text: questionText,
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

test('word queue prioritizes wrong meanings over later touched correct-only meanings', () => {
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

    assert.deepEqual(queue, ['rec-4', 'rec-5', 'rec-1', 'rec-2', 'rec-3', 'rec-6', 'rec-7', 'rec-8', 'rec-9', 'rec-10']);
});

test('cached question selection chooses a different primary variant after the previous normal question', () => {
    const queue = ['rec-prospect'];
    const cacheRows = [
        cache('prospect-old', { fields: { word_record_id: 'rec-prospect', word: 'prospect', question_text: 'The company sees a bright _____ for growth.' } }),
        cache('prospect-new', { fields: { word_record_id: 'rec-prospect', word: 'prospect', question_text: 'The young _____ trained for a career in science.' } }),
    ];
    const selected = selectCachedQuestionsForWordQueue({
        cacheRows, queue, userId: 'student', level: LEVEL, roundType: 'primary',
        recentQuestionTextsByWord: new Map([['rec-prospect', new Set(['The company sees a bright _____ for growth.'])]]),
        limit: 1,
    });
    assert.deepEqual(selected.map(question => question.cacheRecordId), ['cache-prospect-new']);
});

test('cached question selection carries approved AI audit status into the quiz question DTO', () => {
    const selected = selectCachedQuestionsForWordQueue({
        cacheRows: [cache('audited', { fields: { word_record_id: 'rec-audited', ai_audit_status: 'approved' } })],
        queue: ['rec-audited'],
        userId: 'student',
        level: LEVEL,
        limit: 1,
        now: NOW,
    });

    assert.equal(selected[0]?.aiAuditStatus, 'approved');
});

test('eligible ready meaning counts exclude cache pairs without approved AI audit', () => {
    const now = Date.now();
    const wordRecords = [word(1), word(2)];
    const cacheRows = [
        cacheVariant(1, 1, { ai_audit_status: 'approved' }),
        cacheVariant(1, 2, { ai_audit_status: 'approved' }),
        cacheVariant(2, 1, { ai_audit_status: 'skipped' }),
        cacheVariant(2, 2, { ai_audit_status: 'skipped' }),
    ];
    const counts = countEligibleReadyMeaningsByLevel({
        cacheRows,
        wordRecords,
        assessmentRecords: [],
        displayEvents: [],
        userId: 'student',
        levels: ['middle'],
        now,
    });
    assert.equal(counts.middle, 1);
});

test('cached question selection tracks recent variants by word record ID', () => {
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
            { fields: { user: 'student', test_id: 'real-day-one', record_id: 'rec-prospect', word: 'prospect', context: 'Question A _____.', test_time: NOW - DAY, is_correct: 'wrong' } },
            { fields: { user: 'student', test_id: 'real-day-two', record_id: 'rec-prospect', word: 'prospect', context: 'Question B _____.', test_time: NOW, is_correct: 'wrong' } },
        ], { userId: 'student', now: NOW }),
        limit: 1,
    });
    assert.deepEqual(selected.map(question => question.cacheRecordId), []);
});
test('cached question selection keeps same-spelling meanings independent by word record ID', () => {
    const financeRecent = 'The _____ approved the loan.';
    const riverRecent = 'She walked along the _____ after work.';
    const selected = selectCachedQuestionsForWordQueue({
        cacheRows: [
            cache('bank-finance-old', { fields: { word_record_id: 'rec-bank-finance', word: 'bank', question_text: financeRecent } }),
            cache('bank-finance-other-sense-stem', { fields: { word_record_id: 'rec-bank-finance', word: 'bank', question_text: riverRecent } }),
            cache('bank-river-old', { fields: { word_record_id: 'rec-bank-river', word: 'bank', question_text: riverRecent } }),
            cache('bank-river-other-sense-stem', { fields: { word_record_id: 'rec-bank-river', word: 'bank', question_text: financeRecent } }),
        ],
        queue: ['rec-bank-finance', 'rec-bank-river'],
        userId: 'student',
        level: LEVEL,
        roundType: 'primary',
        recentQuestionTextsByWord: buildRecentQuestionTextsByWord([
            { fields: { user: 'student', test_id: 'real-finance', record_id: 'rec-bank-finance', word: 'bank', context: financeRecent, test_time: NOW - DAY, is_correct: 'wrong' } },
            { fields: { user: 'student', test_id: 'real-river', record_id: 'rec-bank-river', word: 'bank', context: riverRecent, test_time: NOW, is_correct: 'wrong' } },
        ], { userId: 'student', now: NOW }),
        limit: 2,
    });
    assert.deepEqual(selected.map(question => question.cacheRecordId), [
        'cache-bank-finance-other-sense-stem',
        'cache-bank-river-other-sense-stem',
    ]);
});

test('cached question selection skips a normal word when only its recent question is available', () => {
    const context = 'The company sees a bright _____ for growth.';
    const selected = selectCachedQuestionsForWordQueue({
        cacheRows: [
            cache('prospect-only', { fields: { word_record_id: 'rec-prospect', word: 'prospect', question_text: context } }),
        ],
        queue: ['rec-prospect'],
        userId: 'student',
        level: LEVEL,
        roundType: 'primary',
        recentQuestionTextsByWord: buildRecentQuestionTextsByWord([
            { fields: { user: 'student', test_id: 'real-prospect', record_id: 'rec-prospect', word: 'prospect', context, test_time: NOW, is_correct: 'wrong' } },
        ], { userId: 'student', now: NOW }),
        limit: 1,
    });
    assert.deepEqual(selected, []);
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

test('word queue keeps same-spelling meanings independent while retaining an unmastered correct-only meaning', () => {
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

    assert.deepEqual(queue, ['rec-1', 'rec-2', 'rec-3']);
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

test('readiness and selection reject a pair with overlapping distractors', () => {
    const sharedOptions = JSON.stringify(['A. word-1', 'B. shared-1', 'C. shared-2', 'D. shared-3']);
    const rows = [
        cacheVariant(1, 1, { options: sharedOptions }),
        cacheVariant(1, 2, { options: sharedOptions }),
    ];

    const counts = countEligibleReadyMeaningsByLevel({
        wordRecords: [word(1)],
        cacheRows: rows,
        assessmentRecords: [],
        userId: 'student',
        levels: [LEVEL],
        now: NOW,
        minAgeMs: 0,
    });
    const selected = selectCachedQuestionsForWordQueue({
        cacheRows: rows,
        queue: ['rec-1'],
        userId: 'student',
        level: LEVEL,
        roundType: 'primary',
        requireReadyPair: true,
        limit: 1,
        now: NOW,
    });

    assert.equal(counts[LEVEL], 0);
    assert.deepEqual(selected, []);
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

test('eligible ready meaning count requires an unused display-history variant', () => {
    const rows = [cacheVariant(1, 1), cacheVariant(1, 2)];
    const counts = countEligibleReadyMeaningsByLevel({
        wordRecords: [word(1)],
        cacheRows: rows,
        assessmentRecords: [],
        displayEvents: rows.map((row, index) => ({
            id: `display-${index + 1}`,
            user: 'student',
            meaningId: 'rec-1',
            stem: row.fields.question_text,
            displayedAt: NOW - DAY,
            historyExpiresAt: NOW + DAY,
            countsForCooldown: true,
        })),
        userId: 'student', levels: [LEVEL], now: NOW, minAgeMs: 0,
    });

    assert.equal(counts[LEVEL], 0);
});

test('eligible ready meaning count keeps a synonym meaning when one of two variants is unused', () => {
    const rows = [cacheVariant(1, 1), cacheVariant(1, 2)];
    const counts = countEligibleReadyMeaningsByLevel({
        wordRecords: [word(1)], cacheRows: rows, assessmentRecords: [],
        displayEvents: [{
            id: 'display-1', user: 'student', meaningId: 'rec-1',
            stem: rows[0].fields.question_text, displayedAt: NOW - DAY,
            historyExpiresAt: NOW + DAY, countsForCooldown: true,
        }],
        userId: 'student', levels: [LEVEL], now: NOW, minAgeMs: 0,
    });

    assert.equal(counts[LEVEL], 1);
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

test('eligible ready meaning count excludes mastered but retains correct-today unmastered meanings', () => {
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

    assert.equal(counts[LEVEL], 2);
});


test('word queue prioritizes old wrong meanings, then correct-only meanings, then untested meanings', () => {
    const wordRecords = [word(1), word(2), word(3), word(4)];
    wordRecords.forEach((record, index) => {
        record.fields.record_time = NOW - (30 + index) * DAY;
        record.created_time = record.fields.record_time;
    });
    const queue = buildQuizWordQueue({
        wordRecords,
        cacheRows: Array.from({ length: 4 }, (_, index) => cache(index + 1)),
        assessmentRecords: [
            assessment('rec-1', { testId: 'real-wrong-newer', time: NOW - 4 * DAY, correct: false }),
            assessment('rec-2', { testId: 'real-wrong-older', time: NOW - 6 * DAY, correct: false }),
            assessment('rec-3', { testId: 'real-correct-only', time: NOW - 8 * DAY, correct: true }),
        ],
        userId: 'student', level: LEVEL, limit: 4, now: NOW, minAgeMs: 18 * 60 * 60 * 1000,
    });
    assert.deepEqual(queue, ['rec-2', 'rec-1', 'rec-3', 'rec-4']);
});

test('word queue uses the later of entry and meaning display cooldown timestamps', () => {
    const record = word(1);
    record.fields.record_time = NOW - 3 * DAY;
    record.fields.last_displayed_at = NOW - 18 * 60 * 60 * 1000 + 1;
    record.created_time = record.fields.record_time;
    const queue = buildQuizWordQueue({
        wordRecords: [record], cacheRows: [cache(1)], assessmentRecords: [], userId: 'student',
        level: LEVEL, limit: 1, now: NOW, minAgeMs: 18 * 60 * 60 * 1000,
    });
    assert.deepEqual(queue, []);
});

test('recent question history keeps all formal display stems for each meaning inside 30 days', () => {
    const recent = buildRecentQuestionTextsByWord([
        assessment('rec-bank-finance', { testId: 'real-display-1', time: NOW - DAY, answer: '', questionText: 'Finance stem _____.' }),
        assessment('rec-bank-finance', { testId: 'real-display-2', time: NOW - 2 * DAY, answer: '', questionText: 'Second finance stem _____.' }),
        assessment('rec-bank-river', { testId: 'real-display-3', time: NOW - DAY, answer: '', questionText: 'River stem _____.' }),
        assessment('rec-bank-finance', { testId: 'real-display-old', time: NOW - 31 * DAY, answer: '', questionText: 'Expired stem _____.' }),
        assessment('rec-bank-finance', { testId: 'test-preview', time: NOW - DAY, answer: '', questionText: 'Preview stem _____.' }),
        assessment('rec-bank-finance', { testId: 'real-review-1', time: NOW - DAY, answer: '', questionText: 'Review stem _____.' }),
    ], { userId: 'student', now: NOW });
    assert.deepEqual([...(recent.get('rec-bank-finance') || [])].sort(), ['finance stem _____.', 'second finance stem _____.']);
    assert.deepEqual([...(recent.get('rec-bank-river') || [])], ['river stem _____.']);
});

test('correct-once meaning remains queued and ready after formal cooldown', () => {
    const record = word(1);
    record.fields.record_time = NOW - 3 * DAY;
    record.created_time = record.fields.record_time;
    const assessmentRecords = [assessment('rec-1', { testId: 'real-correct-once', time: NOW - 2 * DAY, correct: true })];
    const queue = buildQuizWordQueue({
        wordRecords: [record], cacheRows: [cacheVariant(1, 1), cacheVariant(1, 2)], assessmentRecords,
        userId: 'student', level: LEVEL, limit: 1, now: NOW, minAgeMs: 18 * 60 * 60 * 1000,
    });
    const counts = countEligibleReadyMeaningsByLevel({
        wordRecords: [record], cacheRows: [cacheVariant(1, 1), cacheVariant(1, 2)], assessmentRecords,
        userId: 'student', levels: [LEVEL], now: NOW, minAgeMs: 18 * 60 * 60 * 1000,
    });

    assert.deepEqual(queue, ['rec-1']);
    assert.equal(counts[LEVEL], 1);
});

test('multiple correct but unmastered meanings remain queued after cooldown', () => {
    const record = word(1);
    record.fields.record_time = NOW - 4 * DAY;
    record.created_time = record.fields.record_time;
    const queue = buildQuizWordQueue({
        wordRecords: [record], cacheRows: [cache(1)],
        assessmentRecords: [
            assessment('rec-1', { testId: 'real-correct-1', time: NOW - 3 * DAY, correct: true }),
            assessment('rec-1', { testId: 'real-correct-2', time: NOW - 3 * DAY + 60 * 60 * 1000, correct: true }),
        ],
        userId: 'student', level: LEVEL, limit: 1, now: NOW, minAgeMs: 18 * 60 * 60 * 1000,
    });

    assert.deepEqual(queue, ['rec-1']);
});

test('display-only formal row one millisecond before cooldown excludes queue and ready count', () => {
    const record = word(1);
    record.fields.record_time = NOW - 3 * DAY;
    record.created_time = record.fields.record_time;
    const display = assessment('rec-1', { testId: 'real-display-only', time: NOW - 18 * 60 * 60 * 1000 + 1, answer: '', questionText: 'Display-only stem ____.' });
    display.fields.is_correct = null;
    const queue = buildQuizWordQueue({
        wordRecords: [record], cacheRows: [cacheVariant(1, 1), cacheVariant(1, 2)], assessmentRecords: [display],
        userId: 'student', level: LEVEL, limit: 1, now: NOW, minAgeMs: 18 * 60 * 60 * 1000,
    });
    const counts = countEligibleReadyMeaningsByLevel({
        wordRecords: [record], cacheRows: [cacheVariant(1, 1), cacheVariant(1, 2)], assessmentRecords: [display],
        userId: 'student', levels: [LEVEL], now: NOW, minAgeMs: 18 * 60 * 60 * 1000,
    });

    assert.deepEqual(queue, []);
    assert.equal(counts[LEVEL], 0);
});

test('display-only formal row at exact cooldown boundary is eligible', () => {
    const record = word(1);
    record.fields.record_time = NOW - 3 * DAY;
    record.created_time = record.fields.record_time;
    const display = assessment('rec-1', { testId: 'real-display-boundary', time: NOW - 18 * 60 * 60 * 1000, answer: '', questionText: 'Boundary stem ____.' });
    display.fields.is_correct = null;
    const queue = buildQuizWordQueue({ wordRecords: [record], cacheRows: [cache(1)], assessmentRecords: [display], userId: 'student', level: LEVEL, limit: 1, now: NOW, minAgeMs: 18 * 60 * 60 * 1000 });

    assert.deepEqual(queue, ['rec-1']);
});


test('display-only formal rows enter question history without becoming mastery evidence', () => {
    const display = assessment('rec-1', { testId: 'real-display-only', time: NOW - DAY, answer: '', questionText: 'Display-only stem ____.' });
    display.fields.is_correct = null;
    const history = buildRecentQuestionTextsByWord([display], { userId: 'student', now: NOW });
    const mastery = evaluateMeaningMastery([display], value => value === 'correct');

    assert.deepEqual([...history.get('rec-1')], ['display-only stem ____.']);
    assert.equal(mastery.stage, 'unseen');
});

test('test, preview, review, and non-real display rows do not cool or enter formal history', () => {
    const wordRecords = [word(1), word(2), word(3), word(4)];
    wordRecords.forEach(record => { record.fields.record_time = NOW - 3 * DAY; record.created_time = record.fields.record_time; });
    const rows = [
        assessment('rec-1', { testId: 'test-preview', time: NOW, answer: '', questionText: 'Test stem ____.' }),
        assessment('rec-2', { testId: 'real-preview', time: NOW, answer: '', questionText: 'Preview stem ____.' }),
        assessment('rec-3', { testId: 'real-review-source', time: NOW, answer: '', questionText: 'Review stem ____.' }),
        assessment('rec-4', { testId: 'real-non-real', time: NOW, answer: '', questionText: 'Non-real stem ____.' }),
    ];
    rows[1].fields.assessment_kind = 'preview';
    rows[2].fields.assessment_kind = 'review';
    rows[3].fields.is_real_assessment = false;
    rows.forEach(row => { row.fields.is_correct = null; });
    const queue = buildQuizWordQueue({
        wordRecords, cacheRows: wordRecords.map((_, index) => cache(index + 1)), assessmentRecords: rows,
        userId: 'student', level: LEVEL, limit: 4, now: NOW, minAgeMs: 18 * 60 * 60 * 1000,
    });
    const history = buildRecentQuestionTextsByWord(rows, { userId: 'student', now: NOW });

    assert.deepEqual(queue, ['rec-1', 'rec-2', 'rec-3', 'rec-4']);
    assert.deepEqual(history, new Map());
});

test('ID-only preview, test, and review rows are non-formal while ordinary real IDs still count', () => {
    const wordRecords = [word(1), word(2), word(3), word(4)];
    wordRecords.forEach(record => {
        record.fields.record_time = NOW - 3 * DAY;
        record.created_time = record.fields.record_time;
    });
    const rows = [
        assessment('rec-1', { testId: 'real-preview-id-only', time: NOW, answer: '', questionText: 'Preview ID stem ____.' }),
        assessment('rec-2', { testId: 'real-test-id-only', time: NOW, answer: '', questionText: 'Test ID stem ____.' }),
        assessment('rec-3', { testId: 'real-review-id-only', time: NOW, answer: '', questionText: 'Review ID stem ____.' }),
        assessment('rec-4', { testId: 'real-quiz-id-only', time: NOW, answer: '', questionText: 'Formal ID stem ____.' }),
    ];
    rows.forEach(row => {
        row.fields.assessment_kind = '';
        row.fields.is_correct = null;
    });

    const queue = buildQuizWordQueue({
        wordRecords, cacheRows: wordRecords.map((_, index) => cache(index + 1)), assessmentRecords: rows,
        userId: 'student', level: LEVEL, limit: 4, now: NOW, minAgeMs: 18 * 60 * 60 * 1000,
    });
    const history = buildRecentQuestionTextsByWord(rows, { userId: 'student', now: NOW });

    assert.deepEqual(queue, ['rec-1', 'rec-2', 'rec-3']);
    assert.deepEqual([...history.keys()], ['rec-4']);
    assert.deepEqual([...history.get('rec-4')], ['formal id stem ____.']);
});

test('display cooldown uses the maximum valid compatibility alias timestamp', () => {
    const record = word(1);
    record.fields.record_time = NOW - 4 * DAY;
    record.created_time = record.fields.record_time;
    record.fields.last_displayed_at = NOW - 3 * DAY;
    record.fields.lastDisplayedAt = NOW - 18 * 60 * 60 * 1000 + 1;
    record.last_displayed_at = 'invalid';
    record.lastDisplayedAt = NOW - 2 * DAY;

    const queue = buildQuizWordQueue({
        wordRecords: [record], cacheRows: [cache(1)], assessmentRecords: [], userId: 'student',
        level: LEVEL, limit: 1, now: NOW, minAgeMs: 18 * 60 * 60 * 1000,
    });

    assert.deepEqual(queue, []);
});

test('cooldown takes the maximum of entry, compatibility aliases, and formal display with an inclusive boundary', () => {
    const record = word(1);
    record.fields.record_time = NOW - 4 * DAY;
    record.created_time = record.fields.record_time;
    record.fields.last_displayed_at = NOW - 3 * DAY;
    record.lastDisplayedAt = NOW - 2 * DAY;
    const display = assessment('rec-1', {
        testId: 'real-quiz-boundary', time: NOW - 18 * 60 * 60 * 1000, answer: '', questionText: 'Formal boundary stem ____.',
    });
    display.fields.is_correct = null;

    const queue = buildQuizWordQueue({
        wordRecords: [record], cacheRows: [cache(1)], assessmentRecords: [display], userId: 'student',
        level: LEVEL, limit: 1, now: NOW, minAgeMs: 18 * 60 * 60 * 1000,
    });

    assert.deepEqual(queue, ['rec-1']);
});

test('wrong meanings with the same last wrong time sort by entered time', () => {
    const laterEntered = word(1);
    laterEntered.fields.record_time = NOW - 3 * DAY;
    laterEntered.created_time = laterEntered.fields.record_time;
    const earlierEntered = word(2);
    earlierEntered.fields.record_time = NOW - 4 * DAY;
    earlierEntered.created_time = earlierEntered.fields.record_time;
    const wrongAt = NOW - 2 * DAY;

    const queue = buildQuizWordQueue({
        wordRecords: [laterEntered, earlierEntered], cacheRows: [cache(1), cache(2)],
        assessmentRecords: [
            assessment('rec-1', { testId: 'real-wrong-1', time: wrongAt, correct: false }),
            assessment('rec-2', { testId: 'real-wrong-2', time: wrongAt, correct: false }),
        ],
        userId: 'student', level: LEVEL, limit: 2, now: NOW, minAgeMs: 18 * 60 * 60 * 1000,
    });

    assert.deepEqual(queue, ['rec-2', 'rec-1']);
});

test('malformed test_time falls back to record_time for formal display cooldown', () => {
    const record = word(1);
    record.fields.record_time = NOW - 3 * DAY;
    record.created_time = record.fields.record_time;
    const display = assessment('rec-1', { testId: 'real-display-fallback', time: 'malformed', answer: '', questionText: 'Fallback display stem ____.' });
    display.fields.record_time = NOW - 18 * 60 * 60 * 1000 + 1;
    display.fields.is_correct = null;

    const queue = buildQuizWordQueue({
        wordRecords: [record], cacheRows: [cache(1)], assessmentRecords: [display], userId: 'student',
        level: LEVEL, limit: 1, now: NOW, minAgeMs: 18 * 60 * 60 * 1000,
    });

    assert.deepEqual(queue, []);
});

test('malformed test_time falls back to record_time for wrong priority ordering', () => {
    const wordRecords = [word(1), word(2)];
    wordRecords.forEach(record => {
        record.fields.record_time = NOW - 5 * DAY;
        record.created_time = record.fields.record_time;
    });
    const fallbackWrong = assessment('rec-1', { testId: 'real-wrong-fallback', time: 'malformed', correct: false });
    fallbackWrong.fields.record_time = NOW - 4 * DAY;

    const queue = buildQuizWordQueue({
        wordRecords, cacheRows: [cache(1), cache(2)],
        assessmentRecords: [fallbackWrong, assessment('rec-2', { testId: 'real-wrong-valid', time: NOW - 3 * DAY, correct: false })],
        userId: 'student', level: LEVEL, limit: 2, now: NOW, minAgeMs: 18 * 60 * 60 * 1000,
    });

    assert.deepEqual(queue, ['rec-1', 'rec-2']);
});

test('false-like and malformed real flags do not cool or enter history', () => {
    const flags = [false, 0, '0', 'false', 'no', 'unexpected'];
    const wordRecords = flags.map((_, index) => word(index + 1));
    wordRecords.forEach(record => {
        record.fields.record_time = NOW - 3 * DAY;
        record.created_time = record.fields.record_time;
    });
    const rows = flags.map((flag, index) => {
        const row = assessment(`rec-${index + 1}`, { testId: `real-flag-${index + 1}`, time: NOW, answer: '', questionText: `Rejected flag stem ${index + 1} ____.` });
        row.fields.is_real_assessment = flag;
        row.fields.is_correct = null;
        return row;
    });

    const queue = buildQuizWordQueue({
        wordRecords, cacheRows: flags.map((_, index) => cache(index + 1)), assessmentRecords: rows,
        userId: 'student', level: LEVEL, limit: flags.length, now: NOW, minAgeMs: 18 * 60 * 60 * 1000,
    });
    const history = buildRecentQuestionTextsByWord(rows, { userId: 'student', now: NOW });

    assert.deepEqual(queue, wordRecords.map(record => record.record_id));
    assert.deepEqual(history, new Map());
});

test('true-like and legacy absent real flags cool and enter history', () => {
    const flags = [true, 1, '1', 'true', 'yes', undefined, ''];
    const wordRecords = flags.map((_, index) => word(index + 1));
    wordRecords.forEach(record => {
        record.fields.record_time = NOW - 3 * DAY;
        record.created_time = record.fields.record_time;
    });
    const rows = flags.map((flag, index) => {
        const row = assessment(`rec-${index + 1}`, { testId: `real-flag-${index + 1}`, time: NOW, answer: '', questionText: `Accepted flag stem ${index + 1} ____.` });
        if (flag !== undefined) row.fields.is_real_assessment = flag;
        row.fields.is_correct = null;
        return row;
    });

    const queue = buildQuizWordQueue({
        wordRecords, cacheRows: flags.map((_, index) => cache(index + 1)), assessmentRecords: rows,
        userId: 'student', level: LEVEL, limit: flags.length, now: NOW, minAgeMs: 18 * 60 * 60 * 1000,
    });
    const history = buildRecentQuestionTextsByWord(rows, { userId: 'student', now: NOW });

    assert.deepEqual(queue, []);
    assert.deepEqual([...history.keys()], wordRecords.map(record => record.record_id));
});

test('cached questions preserve canonical meaning IDs separately from Feishu record IDs', () => {
    const selected = selectCachedQuestionsForWordQueue({
        cacheRows: [cache('bank-finance', {
            fields: {
                word_record_id: 'rec-bank-finance',
                meaning_id: 'word-finance-uuid',
                word: 'bank',
                question_text: 'The _____ approved the loan.',
            },
        })],
        queue: ['rec-bank-finance'],
        userId: 'student',
        level: LEVEL,
        limit: 1,
    });
    assert.deepEqual(selected.map(question => ({ recordId: question.record_id, meaningId: question.meaningId })), [{ recordId: 'rec-bank-finance', meaningId: 'word-finance-uuid' }]);
});
