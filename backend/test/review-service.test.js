const test = require('node:test');
const assert = require('node:assert/strict');

const { createReviewService } = require('../review-service');

function record(rowId, fields) {
    return { record_id: rowId, fields };
}

function createFixture() {
    const assessments = new Map([
        ['real-q1', [
            record('q-row-1', {
                user: 'student',
                test_id: 'real-q1',
                record_id: 'word-1',
                word: 'alpha',
                question_type: 1,
                options: '["A. alpha","B. old-a","C. old-b","D. old-c"]',
                is_correct: 'correct',
            }),
            record('q-row-2', {
                user: 'student',
                test_id: 'real-q1',
                record_id: 'word-2',
                word: 'beta',
                question_type: 2,
                options: '["A. beta","B. old-d","C. old-e","D. old-f"]',
                is_correct: 'wrong',
            }),
        ]],
    ]);
    const added = [];
    const updates = [];
    let id = 0;
    const service = createReviewService({
        createId: () => `r${++id}`,
        loadAssessmentRecords: async assessmentId =>
            assessments.get(assessmentId) || [],
        loadReviewChainRecords: async () => [...assessments.values()].flat(),
        loadWordInfo: async recordId => ({
            word: recordId === 'word-2' ? 'beta' : 'alpha',
            meaning: 'a definition',
            CN_Meaning: 'definition clue',
            context: 'This context contains beta with several useful clue words.',
            distractors: ['new-a', 'new-b', 'new-c'],
        }),
        buildReviewQuestion: async ({ source, reviewId }) => ({
            type: source.type === 2 ? 1 : 2,
            word: source.word,
            context: 'A new _____ context.',
            options: ['A. beta', 'B. new-a', 'C. new-b', 'D. new-c'],
            answer: 'A',
            record_id: source.recordId,
            testId: reviewId,
        }),
        addReviewRecords: async rows => {
            added.push(rows);
            const reviewId = rows[0].test_id;
            assessments.set(
                reviewId,
                rows.map((fields, index) => record(`review-row-${index}`, fields))
            );
        },
        updateReviewRecord: async (rowId, fields) => updates.push({ rowId, fields }),
        submitAssessment: async (userId, reviewId) => ({
            mode: 'real',
            results: [{
                recordId: 'word-2',
                correct: false,
                word: 'beta',
                confidence: 'sure',
            }],
            masteredWords: [],
        }),
        isSubmitted: item => item.fields.is_correct !== undefined,
        isCorrect: value => value === 'correct',
        fieldValue: value => String(value ?? ''),
    });
    return { service, assessments, added, updates };
}

test('creates the first round from only wrong source-test questions', async () => {
    const { service, added } = createFixture();

    const round = await service.createRound({
        userId: 'student',
        sourceTestId: 'real-q1',
    });

    assert.equal(round.round, 1);
    assert.equal(round.sourceTestId, 'real-q1');
    assert.deepEqual(round.questions.map(q => q.recordId), ['word-2']);
    assert.equal(added[0][0].source_question_id, 'q-row-2');
});


test('writes question context to review records', async () => {
    const { service, added } = createFixture();

    const round = await service.createRound({
        userId: 'student',
        sourceTestId: 'real-q1',
    });

    assert.equal(round.questions[0].context, 'A new _____ context.');
    assert.equal(added[0][0].context, 'A new _____ context.');
});

test('returns the existing active round for an idempotent retry', async () => {
    const { service, added } = createFixture();

    const first = await service.createRound({ userId: 'student', sourceTestId: 'real-q1' });
    const second = await service.createRound({ userId: 'student', sourceTestId: 'real-q1' });

    assert.equal(second.reviewId, first.reviewId);
    assert.equal(second.questions[0].context, 'A new _____ context.');
    assert.equal(added.length, 1);
});


test('fills missing context for an existing active review round', async () => {
    const { service, assessments } = createFixture();
    assessments.set('real-review-r1', [record('review-row-legacy', {
        user: 'student',
        test_id: 'real-review-r1',
        source_test_id: 'real-q1',
        parent_review_id: '',
        review_round: 1,
        review_status: 'active',
        record_id: 'word-2',
        word: 'beta',
        question_type: 3,
        options: '["A. beta","B. new-a","C. new-b","D. new-c"]',
        correct_answer: 'A',
    })]);

    const round = await service.getActiveRound({
        userId: 'student',
        sourceTestId: 'real-q1',
    });

    assert.equal(round.questions[0].context, 'definition clue');
});
test('rejects a source test owned by another user', async () => {
    const { service } = createFixture();

    await assert.rejects(
        service.createRound({ userId: 'other', sourceTestId: 'real-q1' }),
        /不属于当前用户/
    );
});

test('submits a review round and returns remaining record ids', async () => {
    const { service } = createFixture();
    const round = await service.createRound({ userId: 'student', sourceTestId: 'real-q1' });

    const result = await service.submitRound({
        userId: 'student',
        reviewId: round.reviewId,
        answers: [{ option: 0, confidence: 'sure' }],
    });

    assert.equal(result.reviewed, 1);
    assert.deepEqual(result.remainingRecordIds, ['word-2']);
    assert.equal(result.complete, false);
});

test('defers only remaining wrong review rows', async () => {
    const { service, updates } = createFixture();
    const round = await service.createRound({ userId: 'student', sourceTestId: 'real-q1' });
    await service.submitRound({
        userId: 'student',
        reviewId: round.reviewId,
        answers: [{ option: 0, confidence: 'sure' }],
    });

    const result = await service.deferRound({
        userId: 'student',
        reviewId: round.reviewId,
    });

    assert.equal(result.deferred, true);
    assert.equal(updates.some(update => update.fields.review_status === 'deferred'), true);
});
