const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateMeaningMastery, isSubmittedFormalQuiz } = require('../mastery-evidence');
const { submitQuizWithDataSource } = require('../quiz-adapter');

const initial = (overrides = {}) => ({ record_id: 'attempt-initial', fields: {
    record_id: 'meaning-1', test_id: 'real-initial', assessment_kind: 'initial_context',
    is_real_assessment: true, is_correct: 'correct', test_time: Date.UTC(2026, 9, 11, 6, 35),
    context: 'A bowl of ____ warms me up.', ...overrides,
} });
const evaluate = rows => evaluateMeaningMastery(rows, value => value === 'correct');

for (const correctness of ['correct', 'wrong']) {
    test('submitted initial context is recognized without mastery evidence: ' + correctness, () => {
        const row = initial({ is_correct: correctness });
        const result = evaluate([row]);
        assert.equal(result.stage, 'recognized');
        assert.equal(result.evidenceCount, 0);
        assert.equal(result.correctAfterLastWrongCount, 0);
        assert.equal(result.mastered, false);
        assert.equal(isSubmittedFormalQuiz(row), false);
    });
}

test('unsubmitted, test, preview, review and explicitly non-real initial contexts remain unseen', () => {
    for (const patch of [
        { is_correct: null }, { is_correct: '' }, { test_id: 'test-initial' },
        { test_id: 'real-preview-initial' }, { test_id: 'real-test-initial' },
        { test_id: 'real-review-initial' }, { test_id: '' },
        { is_real_assessment: false }, { is_real_assessment: 'false' },
        { assessment_kind: 'review' }, { assessment_kind: 'preview' },
    ]) assert.equal(evaluate([initial(patch)]).stage, 'unseen', JSON.stringify(patch));
});

test('initial learning never supplies or resets a formal mastery success', () => {
    const first = initial({ test_id: 'real-formal-1', assessment_kind: 'context_evidence',
        test_time: Date.UTC(2026, 9, 12), context: 'The first ____ sentence.' });
    first.record_id = 'attempt-formal-1';
    const second = initial({ test_id: 'real-formal-2', assessment_kind: 'context_evidence',
        test_time: Date.UTC(2026, 9, 13), context: 'A different ____ sentence.' });
    second.record_id = 'attempt-formal-2';
    const one = evaluate([initial(), first]);
    assert.equal(one.stage, 'consolidating');
    assert.equal(one.evidenceCount, 1);
    assert.equal(one.mastered, false);
    const two = evaluate([initial({ is_correct: 'wrong', test_time: Date.UTC(2026, 9, 12, 12) }), first, second]);
    assert.equal(two.mastered, true);
    assert.equal(two.evidenceCount, 2);
});

test('initial submission persists recognized for each meaning and retry preserves it', async () => {
    const words = Array.from({ length: 10 }, (_, index) => ({ id: 'meaning-' + index,
        word: 'porridge', username: 'synthetic', entered_at: '2026-09-01T00:00:00Z',
        mastery_status: 'pending', quality_flags: ['selected_sense_flow_v1'] }));
    const rows = [];
    const writes = [];
    const dataSource = {
        getWordsForUser: async () => words,
        getMasteryAssessmentsForWords: async () => rows.slice(),
        submitAssessments: async inputs => {
            const inserted = inputs.map(input => ({ id: 'answer-' + input.sourceWordRecordId,
                word_id: input.sourceWordRecordId, source_word_record_id: input.sourceWordRecordId,
                test_id: input.testId, assessment_kind: input.assessmentKind,
                is_correct: input.correctness, assessed_at: new Date(input.recordTime).toISOString(),
                question_text: input.questionText, submitted_answer: input.yourAnswer }));
            rows.push(...inserted);
            return inserted;
        },
        updateWordMastery: async (username, spelling, status, options) => {
            words.find(word => word.id === options.sourceWordRecordId).mastery_status = status;
            writes.push(status);
        },
    };
    const input = { username: 'synthetic', testId: 'real-initial-submission',
        answers: words.map(() => ({ option: 0 })), dataSource,
        now: () => Date.UTC(2026, 9, 11), questions: words.map(word => ({
            record_id: word.id, word: word.word, type: 1, source: 'question_cache',
            cacheRecordId: 'cache-' + word.id, assessmentKind: 'initial_context',
            context: 'A bowl of ____ warms me up.',
            options: ['A. porridge', 'B. desk', 'C. road', 'D. school'], answer: 'A', correctAnswer: 'A',
        })) };
    await submitQuizWithDataSource(input);
    assert.equal(rows.length, 10);
    assert.ok(rows.every(row => row.assessment_kind === 'initial_context'));
    assert.deepEqual(writes, Array(10).fill('recognized'));
    await submitQuizWithDataSource({ ...input, existingAssessments: rows.slice() });
    assert.equal(rows.length, 10);
    assert.equal(writes.length, 10);
    assert.ok(words.every(word => word.mastery_status === 'recognized'));
});
