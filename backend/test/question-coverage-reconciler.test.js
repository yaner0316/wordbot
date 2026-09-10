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

test('coverage reconciler fails if a planned target is not durably accepted', async () => {
    const reconcile = createQuestionCoverageReconciler({
        loadSnapshot: async () => ({
            users: [{ id: 'user-1', learning_level: '小学' }],
            words: [{ id: 'missing', user_id: 'user-1', word: 'cat', mastery_status: 'unseen', question_generation_version: 1 }],
            cacheRows: [],
            jobs: [],
        }),
        enqueue: async () => false,
    });

    await assert.rejects(reconcile(), /QUESTION_COVERAGE_ENQUEUE_NOT_CONFIRMED/);
});
