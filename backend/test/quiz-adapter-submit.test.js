const test = require('node:test');
const assert = require('node:assert/strict');

const { submitQuizWithDataSource } = require('../quiz-adapter');

test('submitQuizWithDataSource writes assessment and cache usage through the data source in test mode', async () => {
    const calls = [];
    const dataSource = {
        submitAssessment: async input => {
            calls.push(['submitAssessment', input]);
            return {
                id: 'assessment-1',
                source_word_record_id: input.sourceWordRecordId,
                test_id: input.testId,
                assessed_at: new Date(input.recordTime).toISOString(),
                question_type: String(input.questionType),
                word_snapshot: input.word,
                is_correct: input.correctness,
                submitted_answer: input.yourAnswer,
                answer_confidence: input.confidence,
            };
        },
        getWordsForUser: async () => [{
            id: 'word-1',
            feishu_record_id: 'rec-word-1',
            username: 'student',
            word: 'apple',
            mastery_status: 'pending',
            entered_at: '2026-07-18T00:00:00.000Z',
        }],
        getAssessmentsForUser: async () => [],
        updateWordMastery: async (...args) => {
            calls.push(['updateWordMastery', args]);
            return [{ id: 'word-1', mastery_status: args[2] }];
        },
        incrementCacheUsedCount: async cacheId => {
            calls.push(['incrementCacheUsedCount', cacheId]);
            return { id: cacheId, used_count: 3 };
        },
    };

    const result = await submitQuizWithDataSource({
        username: 'student',
        testId: 'test-gate4',
        answers: [{ option: 1, confidence: 'sure' }],
        questions: [{
            record_id: 'rec-word-1',
            word: 'apple',
            type: 1,
            context: 'I ate an _____.',
            options: ['A. pear', 'B. apple', 'C. desk', 'D. book'],
            answer: 'B',
            correctAnswer: 'B',
            cacheRecordId: 'cache-1',
            cacheUsedCount: 2,
            level: String.fromCharCode(0x4e2d, 0x5b66),
            source: 'question_cache',
        }],
        dataSource,
        now: () => 1784455200000,
    });

    assert.equal(result.correct, 1);
    assert.equal(result.total, 1);
    assert.equal(result.gameReward.eligible, false);
    assert.equal(result.gameReward.minutes, 0);
    assert.equal(result.results[0].correct, true);
    assert.equal(calls[0][0], 'submitAssessment');
    assert.equal(calls[0][1].sourceWordRecordId, 'rec-word-1');
    assert.equal(calls[0][1].correctness, 'correct');
    assert.equal(calls[0][1].yourAnswer, 'B');
    assert.equal(calls[1][0], 'incrementCacheUsedCount');
    assert.equal(calls[1][1], 'cache-1');
});

test('submitQuizWithDataSource rejects duplicate or missing meaning IDs before assessment writes', async () => {
    const question = index => ({
        record_id: `meaning-${index + 1}`,
        word: `word-${index + 1}`,
        type: 1,
        options: ['A', 'B', 'C', 'D'],
        answer: 'A',
        correctAnswer: 'A',
        cacheRecordId: `cache-${index + 1}`,
        source: 'question_cache',
    });
    for (const { testId, questions, expected } of [
        {
            testId: 'real-duplicate-meaning',
            questions: Array.from({ length: 10 }, (_, index) => ({
                ...question(index),
                record_id: index === 9 ? 'meaning-1' : `meaning-${index + 1}`,
            })),
            expected: 'FORMAL_QUIZ_DUPLICATE_MEANING_ID',
        },
        {
            testId: 'legacy-real-missing-meaning',
            questions: Array.from({ length: 10 }, (_, index) => {
                const { record_id, ...rest } = question(index);
                return rest;
            }),
            expected: 'FORMAL_QUIZ_MEANING_ID_REQUIRED',
        },
    ]) {
        let writes = 0;
        const dataSource = {
            submitAssessments: async () => {
                writes += 1;
                return [];
            },
            submitAssessment: async () => {
                writes += 1;
                return {};
            },
        };
        await assert.rejects(
            submitQuizWithDataSource({
                username: 'student',
                testId,
                answers: questions.map(() => ({ option: 0 })),
                questions,
                dataSource,
            }),
            error => error.message === expected
        );
        assert.equal(writes, 0);
    }
});

test('submitQuizWithDataSource uses one batch assessment write when the data source supports it', async () => {
    const calls = [];
    const dataSource = {
        submitAssessments: async inputs => {
            calls.push(inputs);
            return inputs.map((input, index) => ({
                id: `assessment-${index + 1}`,
                source_word_record_id: input.sourceWordRecordId,
                test_id: input.testId,
                assessed_at: new Date(input.recordTime).toISOString(),
                question_type: String(input.questionType),
                word_snapshot: input.word,
                is_correct: input.correctness,
                submitted_answer: input.yourAnswer,
                answer_confidence: input.confidence,
            }));
        },
    };
    const result = await submitQuizWithDataSource({
        username: 'student',
        testId: 'test-batch-submit',
        answers: [{ option: 0, confidence: 'sure' }, { option: 1, confidence: 'guess' }],
        questions: [
            { record_id: 'rec-one', word: 'apple', type: 1, options: ['A. apple', 'B. pear', 'C. desk', 'D. book'], answer: 'A', correctAnswer: 'A' },
            { record_id: 'rec-two', word: 'book', type: 1, options: ['A. apple', 'B. book', 'C. desk', 'D. pear'], answer: 'B', correctAnswer: 'B' },
        ],
        dataSource,
        now: () => 1784455200000,
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].length, 2);
    assert.equal(result.correct, 2);
    assert.equal(result.total, 2);
});test('submit result carries exact Chinese sentence translation', async () => { const dataSource = { submitAssessment: async input => ({ id: 'assessment-translation', source_word_record_id: input.sourceWordRecordId, test_id: input.testId, assessed_at: new Date(input.recordTime).toISOString(), is_correct: input.correctness, submitted_answer: input.yourAnswer }), incrementCacheUsedCount: async () => ({}) }; const result = await submitQuizWithDataSource({ username: 'student', testId: 'test-translation', answers: [{ option: 0 }], questions: [{ record_id: 'rec-translation', word: 'apple', type: 1, context: 'I ate an _____.', contextCN: '????????', options: ['A. apple', 'B. pear', 'C. desk', 'D. book'], answer: 'A', correctAnswer: 'A', cacheRecordId: 'cache-translation' }], dataSource }); assert.equal(result.results[0].translation, '????????'); });
test('submit result carries the question snapshot needed by the results screen', async () => {
    const dataSource = {
        submitAssessment: async input => ({ id: 'assessment-snapshot', source_word_record_id: input.sourceWordRecordId, test_id: input.testId, assessed_at: new Date(input.recordTime).toISOString(), is_correct: input.correctness, submitted_answer: input.yourAnswer }),
        incrementCacheUsedCount: async () => ({}),
    };
    const result = await submitQuizWithDataSource({
        username: 'student',
        testId: 'test-snapshot',
        answers: [{ option: 0 }],
        questions: [{ record_id: 'rec-snapshot', meaningId: 'meaning-snapshot', word: 'apple', type: 1, context: 'I ate an _____.', contextCN: '我吃了一个苹果。', options: ['A. apple', 'B. pear', 'C. desk', 'D. book'], optionMeanings: ['苹果', '梨', '书桌', '书'], answer: 'A', correctAnswer: 'A', cacheRecordId: 'cache-snapshot' }],
        dataSource,
    });
    assert.equal(result.results[0].question, 'I ate an _____.');
    assert.deepEqual(result.results[0].options, ['A. apple', 'B. pear', 'C. desk', 'D. book']);
    assert.deepEqual(result.results[0].optionMeanings, ['苹果', '梨', '书桌', '书']);
});

test('accepts any configured valid answer for a bad question', async () => { let written; const dataSource = { submitAssessment: async input => { written = input; return {}; } }; const result = await submitQuizWithDataSource({ username: 'student', testId: 'test-multi-valid', answers: [{ option: 1 }], questions: [{ record_id: 'rec-bad', word: 'bank', type: 1, context: 'She sat by the bank.', options: ['A. bank', 'B. bank', 'C. desk', 'D. chair'], answer: 'A', acceptableAnswers: ['A', 'B'] }], dataSource }); assert.equal(result.results[0].correct, true); assert.equal(written.correctness, 'correct'); });

test('accepts tunnel for the known ambiguous underground-space fill-in and preserves the learner score', async () => {
    let written;
    const dataSource = { submitAssessment: async input => { written = input; return {}; } };
    const result = await submitQuizWithDataSource({
        username: 'student',
        testId: 'test-underground-space',
        answers: [{ option: 3 }],
        questions: [{
            record_id: 'rec-basement',
            word: 'basement',
            type: 1,
            context: 'After moving in, we discovered a hidden _____ beneath the old wooden floorboards.',
            options: ['A. subway', 'B. basement', 'C. bunker', 'D. tunnel'],
            answer: 'B',
        }],
        dataSource,
    });
    assert.equal(result.results[0].correct, true);
    assert.equal(written.correctness, 'correct');
});

test('submit result preserves the canonical meaning ID needed by the results screen', async () => {
    const dataSource = {
        submitAssessment: async input => ({
            id: 'assessment-meaning-id', source_word_record_id: input.sourceWordRecordId,
            test_id: input.testId, assessed_at: new Date(input.recordTime).toISOString(),
            is_correct: input.correctness, submitted_answer: input.yourAnswer,
        }),
    };

    const result = await submitQuizWithDataSource({
        username: 'student', testId: 'test-meaning-id',
        answers: [{ option: 0, confidence: 'sure' }],
        questions: [{
            meaningId: 'meaning-citizen', record_id: 'legacy-citizen', word: 'citizen', type: 1,
            context: 'Every good _____ obeys the law.',
            options: ['A. citizen', 'B. visitor', 'C. teacher', 'D. singer'], answer: 'A', correctAnswer: 'A',
        }],
        dataSource,
        now: () => 1786262400000,
    });

    assert.equal(result.results[0].meaningId, 'meaning-citizen');
});

test('voids a formal question with no valid answer without scoring or learning side effects', async () => {
    const calls = [];
    const questions = Array.from({ length: 10 }, (_, index) => ({
        record_id: `meaning-${index + 1}`,
        word: `word-${index + 1}`,
        type: 1,
        context: `Choose word ${index + 1}.`,
        options: ['A. one', 'B. two', 'C. three', 'D. four'],
        answer: '',
        correctAnswer: '',
        cacheRecordId: `cache-${index + 1}`,
        source: 'question_cache',
        id: `challenge-question-${index + 1}`,
    }));
    const dataSource = {
        submitAssessment: async input => {
            calls.push(['submitAssessment', input]);
            return {};
        },
        submitAssessments: async inputs => {
            calls.push(['submitAssessments', inputs]);
            return [];
        },
        getWordsForUser: async () => [],
        getAssessmentsForUser: async () => [],
        invalidateFormalQuizQuestion: async input => calls.push(['invalidateFormalQuizQuestion', input]),
        updateWordMastery: async (...args) => calls.push(['updateWordMastery', args]),
        incrementCacheUsedCount: async cacheId => calls.push(['incrementCacheUsedCount', cacheId]),
    };

    const result = await submitQuizWithDataSource({
        username: 'student',
        testId: 'real-bad-question',
        answers: questions.map(() => ({ option: 0 })),
        questions,
        dataSource,
    });

    assert.equal(result.correct, 0);
    assert.equal(result.results[0].correct, false);
    assert.equal(result.results[0].counted, false);
    assert.equal(result.results[0].invalid, true);
    assert.equal(result.results[0].replacementRequired, true);
    assert.equal(result.replacementRequired, true);
    assert.equal(calls.length, 10);
    assert.equal(calls.every(([name]) => name === 'invalidateFormalQuizQuestion'), true);
    assert.equal(calls[0][1].challengeQuestionId, 'challenge-question-1');
});

test('voids a formal question when its configured answers are absent from all four options', async () => {
    const questions = Array.from({ length: 10 }, (_, index) => ({
        record_id: `meaning-missing-option-${index + 1}`,
        word: `word-${index + 1}`,
        type: 1,
        context: `Choose word ${index + 1}.`,
        options: ['B. one', 'C. two', 'D. three', 'B. four'],
        answer: 'A',
        correctAnswer: 'A',
        cacheRecordId: `cache-missing-option-${index + 1}`,
        source: 'question_cache',
    }));
    const writes = [];
    const result = await submitQuizWithDataSource({
        username: 'student',
        testId: 'real-missing-option',
        answers: questions.map(() => ({ option: 0 })),
        questions,
        dataSource: {
            getWordsForUser: async () => [],
            getAssessmentsForUser: async () => [],
            submitAssessments: async inputs => { writes.push(inputs); return []; },
            updateWordMastery: async () => writes.push('mastery'),
            incrementCacheUsedCount: async () => writes.push('cache'),
        },
    });

    assert.equal(result.replacementRequired, true);
    assert.equal(result.results.every(item => item.invalid && item.counted === false), true);
    assert.deepEqual(writes, []);
});
