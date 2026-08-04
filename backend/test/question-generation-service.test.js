const test = require('node:test');
const assert = require('node:assert/strict');

test('service publishes two distinct quality-approved variants for one meaning', async () => {
    const { createQuestionGenerationService } = require('../question-generation-service');
    const published = [];
    const attempts = [];
    const service = createQuestionGenerationService({
        loadWord: async wordId => ({ id: wordId, word: 'bank', meaning_en: 'a financial institution' }),
        generateCandidates: async ({ attempt }) => {
            attempts.push(attempt);
            if (attempt === 1) {
                return [
                    { question_text: 'She deposited money at the bank.', options: ['bank', 'shore', 'desk', 'road'], answer: 'A' },
                    { question_text: 'She deposited money at the bank.', options: ['bank', 'shore', 'desk', 'road'], answer: 'A' },
                ];
            }
            return [
                { question_text: 'The bank approved the family loan.', options: ['bank', 'shore', 'desk', 'road'], answer: 'A' },
            ];
        },
        validateCandidate: candidate => candidate.answer === 'A' ? [] : ['answer_invalid'],
        publishReadyVariants: async payload => published.push(payload),
        maxAttempts: 3,
    });

    const result = await service.process({ id: 'job-1', user_id: 'user-1', word_id: 'word-bank-bank' });

    assert.deepEqual(attempts, [1, 2]);
    assert.equal(result.readyCount, 2);
    assert.equal(new Set(result.variants.map(row => row.question_fingerprint)).size, 2);
    assert.equal(published.length, 1);
    assert.equal(published[0].wordId, 'word-bank-bank');
    assert.equal(published[0].variants.length, 2);
});

test('service keeps existing cache untouched when two valid variants cannot be built', async () => {
    const { createQuestionGenerationService } = require('../question-generation-service');
    let published = false;
    const service = createQuestionGenerationService({
        loadWord: async wordId => ({ id: wordId, word: 'bank', meaning_en: 'a river edge' }),
        generateCandidates: async () => [
            { question_text: 'They sat on the bank.', options: ['bank', 'shore', 'desk', 'road'], answer: 'A' },
        ],
        validateCandidate: () => [],
        publishReadyVariants: async () => { published = true; },
        maxAttempts: 2,
    });

    await assert.rejects(
        service.process({ id: 'job-2', user_id: 'user-1', word_id: 'word-bank-shore' }),
        error => error.code === 'INSUFFICIENT_DISTINCT_READY_VARIANTS' && error.readyCount === 1
    );
    assert.equal(published, false);
});

test('service renews the claimed lease immediately before publishing cache rows', async () => {
    const { createQuestionGenerationService } = require('../question-generation-service');
    const events = [];
    const service = createQuestionGenerationService({
        loadWord: async wordId => ({ id: wordId, word: 'bank', meaning_en: 'a financial institution' }),
        generateCandidates: async () => [
            { question_text: 'She deposited money at the bank.', options: ['bank', 'shore', 'desk', 'road'], answer: 'A' },
            { question_text: 'The bank approved the family loan.', options: ['bank', 'shore', 'desk', 'road'], answer: 'A' },
        ],
        validateCandidate: () => [],
        beforePublish: async () => { events.push('renew'); },
        publishReadyVariants: async () => { events.push('publish'); },
    });

    await service.process({ id: 'job-lease', user_id: 'user-1', word_id: 'word-bank-bank' });
    assert.deepEqual(events, ['renew', 'publish']);
});

