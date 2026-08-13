const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createSubmissionCoordinator,
    validateAnswers,
    rebuildSubmittedResult,
} = require('../submission-coordinator');

test('validateAnswers rejects a non-array answer payload', () => {
    assert.throws(
        () => validateAnswers(null, 2),
        /答案必须是数组/
    );
});

test('validateAnswers rejects an answer count that does not match the quiz', () => {
    assert.throws(
        () => validateAnswers([0], 2),
        /答案数量必须与题目数量一致/
    );
});

test('validateAnswers rejects option indexes outside A-D', () => {
    assert.throws(
        () => validateAnswers([0, 4], 2),
        /答案只能是 0 到 3/
    );
});

test('validateAnswers defaults missing confidence to sure', () => {
    assert.doesNotThrow(
        () => validateAnswers([{ option: 0, confidence: null }], 1)
    );
    assert.doesNotThrow(
        () => validateAnswers([{ option: 0 }], 1)
    );
});

test('validateAnswers accepts structured answers with confidence', () => {
    assert.doesNotThrow(
        () => validateAnswers([{ option: 0, confidence: 'sure' }], 1)
    );
});

test('rebuildSubmittedResult returns the original score without writes', () => {
    const records = [
        {
            fields: {
                word: 'apple',
                your_answer: 'A',
                correct_answer: 'A',
                is_correct: 'correct-option',
            },
        },
        {
            fields: {
                word: 'banana',
                your_answer: 'B',
                correct_answer: 'C',
                is_correct: 'wrong-option',
            },
        },
    ];

    assert.deepEqual(
        rebuildSubmittedResult(records, value => value === 'correct-option'),
        {
            alreadySubmitted: true,
            mode: 'real',
            results: [
                { q: 1, meaningId: '', word: 'apple', recordId: '', type: 1, question: '', options: [], your: 'A', answer: 'A', translation: '', optionMeanings: [], correct: true, confidence: 'sure' },
                { q: 2, meaningId: '', word: 'banana', recordId: '', type: 1, question: '', options: [], your: 'B', answer: 'C', translation: '', optionMeanings: [], correct: false, confidence: 'sure' },
            ],
            correct: 1,
            total: 2,
            accuracy: '50.0%',
            masteredWords: [],
            gameReward: {
                eligible: false,
                minutes: 0,
                tier: 'none',
                reason: 'score_below_threshold',
            },
        }
    );
});

test('rebuildSubmittedResult preserves the stored answer-analysis snapshot for idempotent replay', () => {
    const records = [{ fields: {
        test_id: 'real-replay-1', word: 'bank', record_id: 'meaning-bank-finance',
        question_type: '1', context: 'She deposited money in the _____.',
        options: '["A. bank","B. river","C. desk","D. road"]',
        correct_answer: 'A', your_answer: 'B|sure', is_correct: 'wrong-option',
        context_cn: '她把钱存进了银行。',
        option_meanings: '["银行","河流","桌子","道路"]',
    }}];

    const [result] = rebuildSubmittedResult(records, value => value === 'correct-option').results;

    assert.deepEqual(result, {
        q: 1, meaningId: 'meaning-bank-finance', word: 'bank', recordId: 'meaning-bank-finance',
        type: 1, question: 'She deposited money in the _____.',
        options: ['A. bank', 'B. river', 'C. desk', 'D. road'], answer: 'A',
        translation: '她把钱存进了银行。', optionMeanings: ['银行', '河流', '桌子', '道路'],
        your: 'B', correct: false, confidence: 'sure',
    });
});

test('rebuildSubmittedResult accepts native arrays and safely degrades malformed snapshot JSON', () => {
    const native = rebuildSubmittedResult([{ fields: {
        test_id: 'real-native', word: 'calm', record_id: 'meaning-calm', question_type: 1,
        context: 'The lake was _____.', options: ['A. calm', 'B. noisy', 'C. busy', 'D. rough'],
        option_meanings: ['平静', '吵闹', '忙碌', '粗糙'], correct_answer: 'A', your_answer: 'A', is_correct: 'correct-option',
    }}], value => value === 'correct-option').results[0];
    const malformed = rebuildSubmittedResult([{ fields: {
        test_id: 'real-bad-json', word: 'calm', record_id: 'meaning-calm',
        options: '[broken', option_meanings: '{broken', correct_answer: 'A', your_answer: 'A', is_correct: 'correct-option',
    }}], value => value === 'correct-option').results[0];

    assert.equal(native.options.length, 4);
    assert.equal(native.optionMeanings.length, 4);
    assert.deepEqual(malformed.options, []);
    assert.deepEqual(malformed.optionMeanings, []);
    assert.equal(malformed.correct, true);
});

test('coordinator serializes concurrent submissions for the same quiz', async () => {
    let submitted = false;
    let settlements = 0;
    let releaseFirst;
    const firstSettlementStarted = new Promise(resolve => {
        releaseFirst = resolve;
    });

    const coordinator = createSubmissionCoordinator({
        loadRecords: async () => [{
            fields: {
                user: 'student',
                test_id: 'quiz-1',
                is_correct: submitted ? 'correct-option' : undefined,
                word: 'apple',
                your_answer: submitted ? 'A' : '',
                correct_answer: 'A',
            },
        }],
        isSubmitted: record => record.fields.is_correct !== undefined,
        rebuildResult: records => rebuildSubmittedResult(
            records,
            value => value === 'correct-option'
        ),
        settle: async () => {
            settlements++;
            await firstSettlementStarted;
            submitted = true;
            return { alreadySubmitted: false, correct: 1, total: 1 };
        },
    });

    const first = coordinator.submit('student', 'quiz-1', [0]);
    const second = coordinator.submit('student', 'quiz-1', [0]);
    await new Promise(resolve => setImmediate(resolve));
    releaseFirst();

    const [firstResult, secondResult] = await Promise.all([first, second]);

    assert.equal(settlements, 1);
    assert.equal(firstResult.alreadySubmitted, false);
    assert.equal(secondResult.alreadySubmitted, true);
});


test('coordinator waits for quiz records that are briefly invisible', async () => {
    let loads = 0;
    let settled = false;
    const records = [{
        fields: {
            user: 'student',
            test_id: 'quiz-1',
            word: 'apple',
            correct_answer: 'A',
        },
    }];
    const coordinator = createSubmissionCoordinator({
        loadRecords: async () => {
            loads++;
            return loads === 1 ? [] : records;
        },
        recordLoadRetryDelaysMs: [0],
        isSubmitted: () => false,
        rebuildResult: () => {
            throw new Error('should not rebuild');
        },
        settle: async () => {
            settled = true;
            return { correct: 1, total: 1 };
        },
    });

    const result = await coordinator.submit('student', 'quiz-1', [{ option: 0, confidence: 'sure' }]);

    assert.equal(loads, 2);
    assert.equal(settled, true);
    assert.deepEqual(result, { correct: 1, total: 1 });
});

test('coordinator rejects a quiz that belongs to another user', async () => {
    const coordinator = createSubmissionCoordinator({
        loadRecords: async () => [{
            fields: { user: 'another-student', test_id: 'quiz-1' },
        }],
        isSubmitted: () => false,
        rebuildResult: () => {
            throw new Error('should not rebuild');
        },
        settle: () => {
            throw new Error('should not settle');
        },
    });

    await assert.rejects(
        coordinator.submit('student', 'quiz-1', [0]),
        /考试不属于当前用户/
    );
});

test('coordinator passes quiz context to the settlement function', async () => {
    let received;
    const records = [{
        fields: { user: 'student', test_id: 'quiz-1' },
    }];
    const coordinator = createSubmissionCoordinator({
        loadRecords: async () => records,
        isSubmitted: () => false,
        rebuildResult: () => {
            throw new Error('should not rebuild');
        },
        settle: async (...args) => {
            received = args;
            return { correct: 0, total: 1 };
        },
    });

    await coordinator.submit('student', 'quiz-1', [2]);

    assert.deepEqual(received, [records, [{ option: 2, confidence: 'sure' }], 'student', 'quiz-1']);
});

test('coordinator refuses to settle a partially submitted quiz', async () => {
    const coordinator = createSubmissionCoordinator({
        loadRecords: async () => [
            { fields: { user: 'student', is_correct: 'correct-option' } },
            { fields: { user: 'student' } },
        ],
        isSubmitted: record => record.fields.is_correct !== undefined,
        rebuildResult: () => {
            throw new Error('should not rebuild');
        },
        settle: () => {
            throw new Error('should not settle');
        },
    });

    await assert.rejects(
        coordinator.submit('student', 'quiz-1', [0, 1]),
        /考试提交状态不完整/
    );
});

test('rebuilt results expose whether the assessment was test data', () => {
    const result = rebuildSubmittedResult([
        {
            fields: {
                test_id: 'test-quiz-1',
                word: 'apple',
                your_answer: 'A',
                correct_answer: 'A',
                is_correct: 'correct-option',
            },
        },
    ], value => value === 'correct-option');

    assert.equal(result.mode, 'test');
});

test('rebuilt quiz results include the game reward for the first score', () => {
    const records = Array.from({ length: 10 }, (_, index) => ({
        fields: {
            test_id: 'real-quiz-1',
            word: `word-${index}`,
            your_answer: 'A|sure',
            correct_answer: index < 9 ? 'A' : 'B',
            is_correct: index < 9 ? 'correct-option' : 'wrong-option',
        },
    }));

    const result = rebuildSubmittedResult(
        records,
        value => value === 'correct-option'
    );

    assert.deepEqual(result.gameReward, {
        eligible: true,
        minutes: 5,
        tier: 'excellent',
        reason: 'excellent_score',
    });
});
