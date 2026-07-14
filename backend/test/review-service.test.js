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
    assert.equal(round.questions[0].correctMeaning, 'definition clue');
    assert.equal(added[0][0].question_type, 4);
    assert.equal(added[0][0].correct_answer, 'definition clue');
    assert.equal(added[0][0].options, '[]');
});

test('repairs old meaning recall rows from the original type-one source context', async () => {
    const { assessments, updates } = createFixture();
    assessments.set('real-q1', [record('q-row-dirt', {
        user: 'student',
        test_id: 'real-q1',
        record_id: 'word-dirt',
        word: 'dirt',
        question_type: 1,
        context: 'The reporter uncovered _____ about the mayor.',
        options: '["A. dirt","B. soil","C. dust","D. mud"]',
        is_correct: 'wrong',
    })]);
    assessments.set('real-review-old', [record('review-row-old', {
        user: 'student',
        test_id: 'real-review-old',
        source_test_id: 'real-q1',
        parent_review_id: '',
        review_round: 1,
        review_status: 'active',
        source_question_id: 'q-row-dirt',
        record_id: 'word-dirt',
        word: 'dirt',
        question_type: 4,
        context: '',
        options: '[]',
        correct_answer: '土',
    })]);
    const service = createReviewService({
        createId: () => 'unused',
        loadAssessmentRecords: async assessmentId => assessments.get(assessmentId) || [],
        loadReviewChainRecords: async () => [...assessments.values()].flat(),
        loadWordInfo: async () => ({ word: 'dirt', CN_Meaning: '土' }),
        resolveMeaningRecallAnswer: async ({ source, fallback }) => source.type === 1 ? '丑闻' : fallback,
        addReviewRecords: async () => {},
        updateReviewRecord: async (rowId, fields) => updates.push({ rowId, fields }),
        submitAssessment: async () => ({}),
        isSubmitted: item => item.fields.is_correct !== undefined,
        correctValue: 'correct',
        wrongValue: 'wrong',
        isCorrect: value => value === 'correct',
        fieldValue: value => String(value ?? ''),
        recordReadRetryAttempts: 1,
        recordReadRetryDelayMs: 0,
    });

    const active = await service.getActiveRound({ userId: 'student', sourceTestId: 'real-q1' });
    assert.equal(active.questions[0].correctMeaning, '丑闻');

    const result = await service.submitRound({
        userId: 'student',
        reviewId: 'real-review-old',
        answers: [{ text: '丑闻' }],
    });

    assert.equal(result.correct, 1);
    assert.equal(result.results[0].answer, '丑闻');
    assert.equal(updates.some(update => update.rowId === 'review-row-old' && update.fields.correct_answer === '丑闻'), true);
});

test('keeps a short meaning recall fallback when resolver returns a long definition', async () => {
    const { assessments, added } = createFixture();
    assessments.set('real-q1', [record('q-row-soulmate', {
        user: 'student',
        test_id: 'real-q1',
        record_id: 'word-soulmate',
        word: 'soulmate',
        question_type: 4,
        context: '',
        options: '[]',
        correct_answer: '灵魂伴侣',
        is_correct: 'wrong',
    })]);
    const service = createReviewService({
        createId: () => 'r-short',
        loadAssessmentRecords: async assessmentId => assessments.get(assessmentId) || [],
        loadReviewChainRecords: async () => [...assessments.values()].flat(),
        loadWordInfo: async () => ({ word: 'soulmate', CN_Meaning: '灵魂伴侣' }),
        resolveMeaningRecallAnswer: async () => '一个人，尤其是浪漫伴侣，被认为与另一个人非常契合',
        buildReviewQuestion: async ({ source, info, reviewId }) => ({
            type: 4,
            answerMode: 'cn_meaning',
            word: info.word,
            context: '',
            options: [],
            correctMeaning: source.correctMeaning || info.CN_Meaning,
            answer: undefined,
            record_id: source.recordId,
            testId: reviewId,
        }),
        addReviewRecords: async rows => {
            added.push(rows);
        },
        updateReviewRecord: async () => {},
        submitAssessment: async () => ({}),
        isSubmitted: item => item.fields.is_correct !== undefined,
        correctValue: 'correct',
        wrongValue: 'wrong',
        isCorrect: value => value === 'correct',
        fieldValue: value => String(value ?? ''),
        recordReadRetryAttempts: 1,
        recordReadRetryDelayMs: 0,
    });

    const round = await service.createRound({ userId: 'student', sourceTestId: 'real-q1' });

    assert.equal(round.questions[0].correctMeaning, '灵魂伴侣');
    assert.equal(added[0][0].correct_answer, '灵魂伴侣');
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
    assert.equal(second.questions[0].correctMeaning, 'definition clue');
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
test('waits for previous review submission fields before creating the next review round', async () => {
    const { service, assessments } = createFixture();
    const first = await service.createRound({ userId: 'student', sourceTestId: 'real-q1' });
    const staleRows = assessments.get(first.reviewId).map(item => ({
        ...item,
        fields: { ...item.fields },
    }));

    await service.submitRound({
        userId: 'student',
        reviewId: first.reviewId,
        answers: [{ text: 'not yet' }],
    });
    const submittedRows = assessments.get(first.reviewId).map(item => ({
        ...item,
        fields: {
            ...item.fields,
            your_answer: 'not yet',
            is_correct: 'wrong',
            review_status: 'active',
        },
    }));

    let reads = 0;
    const eventualService = createReviewService({
        createId: () => 'r-next',
        loadAssessmentRecords: async assessmentId => {
            if (assessmentId === first.reviewId && reads++ === 0) return staleRows;
            if (assessmentId === first.reviewId) return submittedRows;
            return assessments.get(assessmentId) || [];
        },
        loadReviewChainRecords: async () => [...assessments.values()].flat(),
        loadWordRecords: async () => [],
        loadWordInfo: async recordId => ({
            word: recordId === 'word-2' ? 'beta' : 'alpha',
            CN_Meaning: 'definition clue',
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
            assessments.set(
                rows[0].test_id,
                rows.map((fields, index) => record(`review-next-row-${index}`, fields))
            );
        },
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

    const second = await eventualService.createRound({
        userId: 'student',
        sourceTestId: 'real-q1',
        parentReviewId: first.reviewId,
    });

    assert.equal(reads, 2);
    assert.equal(second.round, 2);
    assert.deepEqual(second.questions.map(q => q.recordId), ['word-2']);
});


test('uses the submitted result when the next round reads stale review rows', async () => {
    const { service, assessments } = createFixture();
    const first = await service.createRound({ userId: 'student', sourceTestId: 'real-q1' });

    await service.submitRound({
        userId: 'student',
        reviewId: first.reviewId,
        answers: [{ text: 'not yet' }],
    });

    const second = await service.createRound({
        userId: 'student',
        sourceTestId: 'real-q1',
        parentReviewId: first.reviewId,
    });

    assert.equal(second.round, 2);
    assert.deepEqual(second.questions.map(q => q.recordId), ['word-2']);
    assert.equal(assessments.get(first.reviewId)[0].fields.is_correct, undefined);
});
test('default retry window waits long enough for slow Feishu review submission visibility', async () => {
    const { service, assessments } = createFixture();
    const first = await service.createRound({ userId: 'student', sourceTestId: 'real-q1' });
    const staleRows = assessments.get(first.reviewId).map(item => ({ ...item, fields: { ...item.fields } }));
    await service.submitRound({ userId: 'student', reviewId: first.reviewId, answers: [{ text: 'still wrong' }] });
    const submittedRows = assessments.get(first.reviewId).map(item => ({ ...item, fields: { ...item.fields, your_answer: 'still wrong', is_correct: 'wrong', review_status: 'active' } }));
    let reads = 0;
    const eventualService = createReviewService({
        createId: () => 'r-slow-next',
        loadAssessmentRecords: async assessmentId => {
            if (assessmentId === first.reviewId && reads++ < 6) return staleRows;
            if (assessmentId === first.reviewId) return submittedRows;
            return assessments.get(assessmentId) || [];
        },
        loadReviewChainRecords: async () => [...assessments.values()].flat(),
        loadWordRecords: async () => [],
        loadWordInfo: async recordId => ({ word: recordId === 'word-2' ? 'beta' : 'alpha', CN_Meaning: 'definition clue' }),
        buildReviewQuestion: async ({ source, info, reviewId }) => ({ type: 4, answerMode: 'cn_meaning', word: info.word, context: '', options: [], correctMeaning: info.CN_Meaning, answer: undefined, record_id: source.recordId, testId: reviewId }),
        addReviewRecords: async rows => assessments.set(rows[0].test_id, rows.map((fields, index) => record(`review-slow-next-row-${index}`, fields))),
        updateReviewRecord: async () => {},
        submitAssessment: async () => ({}),
        isSubmitted: item => item.fields.is_correct !== undefined,
        correctValue: 'correct',
        wrongValue: 'wrong',
        isCorrect: value => value === 'correct',
        fieldValue: value => String(value ?? ''),
        recordReadRetryDelayMs: 0,
    });
    const second = await eventualService.createRound({ userId: 'student', sourceTestId: 'real-q1', parentReviewId: first.reviewId });
    assert.equal(reads, 7);
    assert.equal(second.round, 2);
    assert.deepEqual(second.questions.map(q => q.recordId), ['word-2']);
});


test('starts review question builds for wrong words concurrently', async () => {
    let releaseFirstBuild;
    const firstBuildCanFinish = new Promise(resolve => { releaseFirstBuild = resolve; });
    let firstBuildStarted;
    const firstBuildStartedPromise = new Promise(resolve => { firstBuildStarted = resolve; });
    const buildCalls = [];
    const assessments = new Map([['real-many', [
        record('q-row-1', { user: 'student', test_id: 'real-many', record_id: 'word-1', word: 'alpha', question_type: 1, context: 'alpha here', options: '[]', is_correct: 'wrong' }),
        record('q-row-2', { user: 'student', test_id: 'real-many', record_id: 'word-2', word: 'beta', question_type: 1, context: 'beta here', options: '[]', is_correct: 'wrong' }),
    ]]]);
    const service = createReviewService({
        createId: () => 'r-many',
        loadAssessmentRecords: async assessmentId => assessments.get(assessmentId) || [],
        loadReviewChainRecords: async () => [...assessments.values()].flat(),
        loadWordRecords: async () => [],
        loadWordInfo: async recordId => ({ word: recordId === 'word-1' ? 'alpha' : 'beta', CN_Meaning: 'meaning' }),
        buildReviewQuestion: async ({ source, info, reviewId }) => {
            buildCalls.push(source.recordId);
            if (source.recordId === 'word-1') {
                firstBuildStarted();
                await firstBuildCanFinish;
            }
            return { type: 4, answerMode: 'cn_meaning', word: info.word, context: '', options: [], correctMeaning: info.CN_Meaning, answer: undefined, record_id: source.recordId, testId: reviewId };
        },
        addReviewRecords: async rows => assessments.set(rows[0].test_id, rows.map((fields, index) => record('review-many-row-' + index, fields))),
        updateReviewRecord: async () => {},
        submitAssessment: async () => ({}),
        isSubmitted: item => item.fields.is_correct !== undefined,
        correctValue: 'correct',
        wrongValue: 'wrong',
        isCorrect: value => value === 'correct',
        fieldValue: value => String(value ?? ''),
    });

    const roundPromise = service.createRound({ userId: 'student', sourceTestId: 'real-many' });
    await firstBuildStartedPromise;
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(buildCalls.sort(), ['word-1', 'word-2']);
    releaseFirstBuild();
    const round = await roundPromise;
    assert.equal(round.questions.length, 2);
});

test('starts type-four review answer writes concurrently', async () => {
    let releaseFirstWrite;
    const firstWriteCanFinish = new Promise(resolve => { releaseFirstWrite = resolve; });
    let firstWriteStarted;
    const firstWriteStartedPromise = new Promise(resolve => { firstWriteStarted = resolve; });
    const updates = [];
    const assessments = new Map([['real-review-many', [
        record('review-row-1', { user: 'student', test_id: 'real-review-many', source_test_id: 'real-q1', review_round: 1, review_status: 'active', record_id: 'word-1', word: 'alpha', question_type: 4, correct_answer: 'meaning one', test_time: 1 }),
        record('review-row-2', { user: 'student', test_id: 'real-review-many', source_test_id: 'real-q1', review_round: 1, review_status: 'active', record_id: 'word-2', word: 'beta', question_type: 4, correct_answer: 'meaning two', test_time: 2 }),
    ]]]);
    const service = createReviewService({
        createId: () => 'unused',
        loadAssessmentRecords: async assessmentId => assessments.get(assessmentId) || [],
        loadReviewChainRecords: async () => [...assessments.values()].flat(),
        loadWordInfo: async recordId => ({ word: recordId === 'word-1' ? 'alpha' : 'beta', CN_Meaning: recordId }),
        addReviewRecords: async () => {},
        updateReviewRecord: async (rowId, fields) => {
            updates.push({ rowId, fields });
            if (fields.your_answer && rowId === 'review-row-1') {
                firstWriteStarted();
                await firstWriteCanFinish;
            }
        },
        submitAssessment: async () => ({}),
        isSubmitted: item => item.fields.is_correct !== undefined,
        correctValue: 'correct',
        wrongValue: 'wrong',
        isCorrect: value => value === 'correct',
        fieldValue: value => String(value ?? ''),
        recordReadRetryAttempts: 1,
        recordReadRetryDelayMs: 0,
    });

    const submitPromise = service.submitRound({
        userId: 'student',
        reviewId: 'real-review-many',
        answers: [{ text: 'wrong one' }, { text: 'wrong two' }],
    });
    await firstWriteStartedPromise;
    await new Promise(resolve => setImmediate(resolve));

    assert.ok(updates.some(update => update.rowId === 'review-row-2' && update.fields.your_answer === 'wrong two'));
    releaseFirstWrite();
    const result = await submitPromise;
    assert.equal(result.total, 2);
});
test('deduplicates concurrent review creation for the same source while the first write is pending', async () => {
    const assessments = new Map([['real-q1', [record('q-row-1', {
        user: 'student',
        test_id: 'real-q1',
        record_id: 'word-1',
        word: 'alpha',
        question_type: 1,
        options: '[]',
        is_correct: 'wrong',
    })]]]);
    let addCalls = 0;
    let releaseAdd;
    const addCanFinish = new Promise(resolve => { releaseAdd = resolve; });
    let firstAddStarted;
    const firstAddPromise = new Promise(resolve => { firstAddStarted = resolve; });
    let id = 0;
    const service = createReviewService({
        createId: () => `r${++id}`,
        loadAssessmentRecords: async assessmentId => assessments.get(assessmentId) || [],
        loadReviewChainRecords: async () => [...assessments.values()].flat(),
        loadWordInfo: async () => ({ word: 'alpha', CN_Meaning: 'definition clue' }),
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
            addCalls += 1;
            if (addCalls === 1) firstAddStarted();
            await addCanFinish;
            assessments.set(rows[0].test_id, rows.map((fields, index) => record(`review-row-${index}`, fields)));
        },
        updateReviewRecord: async () => {},
        submitAssessment: async () => ({ results: [], masteredWords: [] }),
        isSubmitted: item => item.fields.is_correct !== undefined,
        correctValue: 'correct',
        wrongValue: 'wrong',
        isCorrect: value => value === 'correct',
        fieldValue: value => String(value ?? ''),
    });

    const first = service.createRound({ userId: 'student', sourceTestId: 'real-q1' });
    await firstAddPromise;
    const second = service.createRound({ userId: 'student', sourceTestId: 'real-q1' });
    await new Promise(resolve => setTimeout(resolve, 20));

    assert.equal(addCalls, 1);
    releaseAdd();
    const [firstRound, secondRound] = await Promise.all([first, second]);
    assert.equal(secondRound.reviewId, firstRound.reviewId);
});
