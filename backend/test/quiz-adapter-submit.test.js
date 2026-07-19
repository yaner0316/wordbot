const test = require('node:test');
const assert = require('node:assert/strict');

const { submitQuizWithDataSource } = require('../quiz-adapter');

test('submitQuizWithDataSource writes assessment, mastery status, and cache usage through the data source', async () => {
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
        testId: 'real-gate4',
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
    assert.equal(result.results[0].correct, true);
    assert.equal(calls[0][0], 'submitAssessment');
    assert.equal(calls[0][1].sourceWordRecordId, 'rec-word-1');
    assert.equal(calls[0][1].correctness, 'correct');
    assert.equal(calls[0][1].yourAnswer, 'B');
    assert.equal(calls[1][0], 'updateWordMastery');
    assert.equal(calls[1][1][2], 'consolidating');
    assert.equal(calls[2][0], 'incrementCacheUsedCount');
    assert.equal(calls[2][1], 'cache-1');
});
