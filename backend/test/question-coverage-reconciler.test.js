'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createQuestionCoverageReconciler } = require('../question-coverage-controller');

test('coverage reconciler enqueues only missing or legacy-terminal targets', async () => {
    const enqueued = [];
    const reconcile = createQuestionCoverageReconciler({
        loadSnapshot: async () => ({
            users: [{ id: 'user-1', learning_level: '小学' }],
            words: [
                { id: 'pending', user_id: 'user-1', word: 'bank', mastery_status: 'pending', question_generation_version: 1 },
                { id: 'legacy', user_id: 'user-1', word: 'book', mastery_status: 'recognized', question_generation_version: 1 },
                { id: 'missing', user_id: 'user-1', word: 'cat', mastery_status: 'unseen', question_generation_version: 1 },
            ],
            cacheRows: [],
            jobs: [
                { word_id: 'pending', user_id: 'user-1', word_version: 1, status: 'retry_wait' },
                { word_id: 'legacy', user_id: 'user-1', word_version: 1, status: 'needs_manual_review' },
            ],
        }),
        enqueue: async target => { enqueued.push(target); return true; },
    });

    const result = await reconcile();

    assert.deepEqual(enqueued.map(target => target.wordId), ['legacy', 'missing']);
    assert.equal(result.enqueued, 2);
    assert.equal(result.summary.executable, 1);
});

test('coverage reconciler treats a refused enqueue as already handled and keeps processing the rest', async () => {
    // The enqueue RPC returns false for legitimate no-op cases: the meaning became
    // mastered or deleted, the word version already has an executable job, or the
    // user has no current learning level. A false answer must not abort the pass,
    // otherwise one un-actionable meaning permanently blocks coverage for everyone.
    const attempted = [];
    const reconcile = createQuestionCoverageReconciler({
        loadSnapshot: async () => ({
            users: [{ id: 'user-1', learning_level: '小学' }],
            words: [
                { id: 'word-a', user_id: 'user-1', word: 'cat', mastery_status: 'unseen', question_generation_version: 1 },
                { id: 'word-b', user_id: 'user-1', word: 'dog', mastery_status: 'unseen', question_generation_version: 1 },
                { id: 'word-c', user_id: 'user-1', word: 'pig', mastery_status: 'unseen', question_generation_version: 1 },
            ],
            cacheRows: [],
            jobs: [],
        }),
        enqueue: async target => {
            attempted.push(target.wordId);
            return target.wordId !== 'word-b';
        },
    });

    const result = await reconcile();

    assert.deepEqual(attempted, ['word-a', 'word-b', 'word-c']);
    assert.equal(result.enqueued, 2);
    assert.equal(result.skipped, 1);
});

test('coverage reconciler still fails closed when the enqueue answer is missing', async () => {
    const reconcile = createQuestionCoverageReconciler({
        loadSnapshot: async () => ({
            users: [{ id: 'user-1', learning_level: '小学' }],
            words: [{ id: 'missing', user_id: 'user-1', word: 'cat', mastery_status: 'unseen', question_generation_version: 1 }],
            cacheRows: [],
            jobs: [],
        }),
        enqueue: async () => undefined,
    });

    await assert.rejects(reconcile(), /QUESTION_COVERAGE_ENQUEUE_NOT_CONFIRMED/);
});

test('coverage reconciler never plans targets for a user without a usable current learning level', async () => {
    const attempted = [];
    const reconcile = createQuestionCoverageReconciler({
        loadSnapshot: async () => ({
            users: [
                { id: 'user-1', learning_level: '小学' },
                { id: 'user-2', learning_level: null },
            ],
            words: [
                { id: 'word-blocked', user_id: 'user-2', word: 'cat', mastery_status: 'unseen', question_generation_version: 1 },
                { id: 'word-actionable', user_id: 'user-1', word: 'dog', mastery_status: 'unseen', question_generation_version: 1 },
            ],
            cacheRows: [],
            jobs: [],
        }),
        enqueue: async target => { attempted.push(target.wordId); return true; },
    });

    const result = await reconcile();

    assert.deepEqual(attempted, ['word-actionable']);
    assert.equal(result.enqueued, 1);
    assert.equal(result.skipped, 0);
    assert.equal(result.summary.skippedMissingLevel, 1);
});
