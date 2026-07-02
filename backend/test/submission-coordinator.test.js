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

test('validateAnswers requires a confidence choice for every answer', () => {
    assert.throws(
        () => validateAnswers([{ option: 0, confidence: null }], 1),
        /请选择“确定认识”或“猜的\/不确定”/
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
                { q: 1, word: 'apple', recordId: '', your: 'A', answer: 'A', correct: true, confidence: 'sure' },
                { q: 2, word: 'banana', recordId: '', your: 'B', answer: 'C', correct: false, confidence: 'sure' },
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

    assert.deepEqual(received, [records, [2], 'student', 'quiz-1']);
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
