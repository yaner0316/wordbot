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
        buildReviewQuestion: async ({ source, info, reviewId }) => ({
            type: 4,
            answerMode: 'cn_meaning',
            word: info.word,
            context: '',
            options: [],
            correctMeaning: info.CN_Meaning,
            answer: undefined,
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
        correctValue: 'correct',
        wrongValue: 'wrong',
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


test('creates Chinese meaning recall questions for wrong answers', async () => {
    const { service, added } = createFixture();

    const round = await service.createRound({
        userId: 'student',
        sourceTestId: 'real-q1',
    });

    assert.equal(round.questions[0].type, 4);
    assert.equal(round.questions[0].answerMode, 'cn_meaning');
    assert.equal(round.questions[0].word, 'beta');
    assert.deepEqual(round.questions[0].options, []);
    assert.equal(round.questions[0].answer, undefined);
    assert.equal(added[0][0].question_type, 4);
    assert.equal(added[0][0].correct_answer, 'definition clue');
    assert.equal(added[0][0].options, '[]');
});

test('submits Chinese meaning review answers without multiple-choice options', async () => {
    const { service, added, updates } = createFixture();
    const round = await service.createRound({
        userId: 'student',
        sourceTestId: 'real-q1',
    });

    const result = await service.submitRound({
        userId: 'student',
        reviewId: round.reviewId,
        answers: [{ text: 'definition clue' }],
    });

    assert.equal(result.correct, 1);
    assert.equal(result.total, 1);
    assert.equal(result.results[0].your, 'definition clue');
    assert.equal(result.results[0].answer, 'definition clue');
    assert.equal(result.results[0].correct, true);
    assert.deepEqual(result.remainingRecordIds, []);
    assert.equal(added[0][0].options, '[]');
    assert.equal(updates.some(update => update.fields.your_answer === 'definition clue'), true);
    assert.equal(updates.some(update => update.fields.review_status === 'complete'), true);
});

test('retries a freshly-created review round when Feishu search is briefly empty', async () => {
    const { service, assessments } = createFixture();
    const round = await service.createRound({ userId: 'student', sourceTestId: 'real-q1' });
    let reads = 0;
    const flakyService = createReviewService({
        createId: () => 'unused',
        loadAssessmentRecords: async assessmentId => {
            if (assessmentId === round.reviewId && reads++ === 0) return [];
            return assessments.get(assessmentId) || [];
        },
        loadReviewChainRecords: async () => [...assessments.values()].flat(),
        loadWordInfo: async () => ({ word: 'beta', meaning: 'a definition', CN_Meaning: 'definition clue' }),
        addReviewRecords: async () => {},
        updateReviewRecord: async () => {},
        submitAssessment: async () => ({}),
        isSubmitted: item => item.fields.is_correct !== undefined,
        correctValue: 'correct',
        wrongValue: 'wrong',
        isCorrect: value => value === 'correct',
        fieldValue: value => String(value ?? ''),
        recordReadRetryAttempts: 2,
        recordReadRetryDelayMs: 0,
    });

    const result = await flakyService.submitRound({
        userId: 'student',
        reviewId: round.reviewId,
        answers: [{ text: 'definition clue' }],
    });

    assert.equal(reads, 2);
    assert.equal(result.correct, 1);
});

test('writes Chinese meaning prompt records without options', async () => {
    const { service, added } = createFixture();

    await service.createRound({ userId: 'student', sourceTestId: 'real-q1' });

    assert.equal(added[0][0].context, '');
    assert.equal(added[0][0].options, '[]');
});

test('returns the existing active round for an idempotent retry', async () => {
    const { service, added } = createFixture();

    const first = await service.createRound({ userId: 'student', sourceTestId: 'real-q1' });
    const second = await service.createRound({ userId: 'student', sourceTestId: 'real-q1' });

    assert.equal(second.reviewId, first.reviewId);
    assert.equal(second.questions[0].context, 'definition clue');
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
        service.createRound({ userId: 'other', sourceTestId: 'real-q1' })
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

