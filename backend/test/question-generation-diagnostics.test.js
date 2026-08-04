const test = require('node:test');
const assert = require('node:assert/strict');

const { summarizeQuestionGenerationJobs } = require('../question-generation-job');

test('generation diagnostics expose pending, retrying, manual-review and ready meanings', () => {
    const summary = summarizeQuestionGenerationJobs([
        { word_id: 'w1', status: 'pending' },
        { word_id: 'w2', status: 'generating' },
        { word_id: 'w3', status: 'retry_wait', attempt_count: 2, last_error_code: 'QUALITY_REJECTED' },
        { word_id: 'w4', status: 'needs_manual_review', attempt_count: 5, last_error_code: 'MEANING_MISSING' },
        { word_id: 'w5', status: 'ready' },
    ]);
    assert.deepEqual(summary.counts, {
        pending: 2,
        retrying: 1,
        manualReview: 1,
        ready: 1,
    });
    assert.deepEqual(summary.failures, [{
        wordId: 'w4', status: 'needs_manual_review', attemptCount: 5, lastErrorCode: 'MEANING_MISSING', nextAttemptAt: null,
    }]);
});
