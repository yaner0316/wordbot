const test = require('node:test');
const assert = require('node:assert/strict');

test('word entry creates a durable generation job for the inserted meaning', async () => {
    const { createQuestionGenerationJobStore } = require('../question-generation-job');
    const rows = [];
    const store = createQuestionGenerationJobStore({
        insert: async row => rows.push(row),
    });

    await store.enqueue({ userId: 'user-1', wordId: 'word-bank-bank', reason: 'word_entry' });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].word_id, 'word-bank-bank');
    assert.equal(rows[0].status, 'pending');
});

test('one meaning requires two distinct ready primary variants', async () => {
    const { hasRequiredReadyVariants } = require('../question-generation-job');
    assert.equal(hasRequiredReadyVariants([
        {
            word_id: 'word-bank-bank',
            round_type: 'primary',
            quality_status: 'ready',
            question_text: 'She deposited money at the bank.',
            question_fingerprint: 'fingerprint-a',
        },
        {
            word_id: 'word-bank-bank',
            round_type: 'primary',
            quality_status: 'ready',
            question_text: 'The bank approved the loan.',
            question_fingerprint: 'fingerprint-b',
        },
    ], 'word-bank-bank', 2), true);
});
