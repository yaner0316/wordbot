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
                { question_text: 'The bank approved the family loan.', options: ['bank', 'branch', 'coin', 'road'], answer: 'A' },
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

test('service resumes an approved sibling from a durable checkpoint and saves new progress', async () => {
    const { createQuestionGenerationService, fingerprintQuestion } = require('../question-generation-service');
    const word = {
        id: 'word-bank-bank', user_id: 'user-1', word: 'bank',
        meaning_en: 'a financial institution', level: '小学', word_version: 4,
    };
    const approved = {
        question_text: 'She deposited money at the bank.',
        options: ['bank', 'shore', 'desk', 'road'], answer: 'A',
    };
    const saves = [];
    let generatedRequest;
    let published;
    const service = createQuestionGenerationService({
        loadWord: async () => word,
        loadCheckpoint: async () => ({
            schemaVersion: 1,
            wordVersion: 4,
            level: '小学',
            word: 'bank',
            meaning: '["a financial institution",""]',
            variants: [{
                ...approved,
                user_id: 'user-1', word_id: 'word-bank-bank',
                round_type: 'primary', quality_status: 'ready',
                question_fingerprint: fingerprintQuestion(approved, 'word-bank-bank'),
            }],
        }),
        saveCheckpoint: async payload => saves.push(payload),
        generateCandidates: async request => {
            generatedRequest = request;
            return [{
                question_text: 'The bank approved the family loan.',
                options: ['bank', 'branch', 'coin', 'road'], answer: 'A',
            }];
        },
        validateCandidate: () => [],
        publishReadyVariants: async payload => { published = payload; },
    });

    const result = await service.process({ id: 'job-checkpoint', user_id: 'user-1', word_id: word.id });

    assert.equal(generatedRequest.requiredCount, 1);
    assert.equal(generatedRequest.approvedVariants.length, 1);
    assert.equal(saves.length, 1);
    assert.equal(saves[0].checkpoint.variants.length, 2);
    assert.equal(result.variants.length, 2);
    assert.equal(published.variants.length, 2);
});

test('service discards checkpoint variants when only the Chinese meaning changed', async () => {
    const { createQuestionGenerationService, fingerprintQuestion } = require('../question-generation-service');
    const oldVariant = {
        question_text: 'She deposited money at the bank.',
        options: ['bank', 'shore', 'desk', 'road'],
        answer: 'A',
    };
    let generatedRequest;
    const service = createQuestionGenerationService({
        loadWord: async () => ({
            id: 'word-bank', user_id: 'user-1', word: 'bank', level: '小学', word_version: 5,
            meaning_en: 'a financial institution', meaning_zh: '河岸',
        }),
        loadCheckpoint: async () => ({
            schemaVersion: 1,
            wordVersion: 4,
            level: '小学',
            word: 'bank',
            meaning: 'a financial institution',
            variants: [{
                ...oldVariant,
                question_fingerprint: fingerprintQuestion(oldVariant, 'word-bank'),
            }],
        }),
        generateCandidates: async request => {
            generatedRequest = request;
            return [
                { question_text: 'They rested on the bank.', options: ['bank', 'tree', 'grass', 'path'], answer: 'A' },
                { question_text: 'The river flooded its bank.', options: ['bank', 'water', 'sand', 'boat'], answer: 'A' },
            ];
        },
        validateCandidate: () => [],
        publishReadyVariants: async () => {},
    });

    await service.process({ id: 'job-meaning-change', user_id: 'user-1', word_id: 'word-bank', word_version: 5 });

    assert.equal(generatedRequest.requiredCount, 2);
    assert.equal(generatedRequest.approvedVariants.length, 0);
    assert.match(generatedRequest.generationCheckpoint.meaning, /河岸/);
});

test('service renews the claimed lease immediately before publishing cache rows', async () => {
    const { createQuestionGenerationService } = require('../question-generation-service');
    const events = [];
    const service = createQuestionGenerationService({
        loadWord: async wordId => ({ id: wordId, word: 'bank', meaning_en: 'a financial institution' }),
        generateCandidates: async () => [
            { question_text: 'She deposited money at the bank.', options: ['bank', 'shore', 'desk', 'road'], answer: 'A' },
            { question_text: 'The bank approved the family loan.', options: ['bank', 'branch', 'coin', 'road'], answer: 'A' },
        ],
        validateCandidate: () => [],
        beforePublish: async () => { events.push('renew'); },
        publishReadyVariants: async () => { events.push('publish'); },
    });

    await service.process({ id: 'job-lease', user_id: 'user-1', word_id: 'word-bank-bank' });
    assert.deepEqual(events, ['renew', 'publish']);
});


test('service rejects two variants whose distractors overlap by more than one', async () => {
    const { createQuestionGenerationService } = require('../question-generation-service');
    let published = false;
    const service = createQuestionGenerationService({
        loadWord: async wordId => ({ id: wordId, word: 'bank', meaning_en: 'a financial institution' }),
        generateCandidates: async () => [
            { question_text: 'She deposited money at the bank.', options: ['bank', 'shore', 'desk', 'road'], answer: 'A' },
            { question_text: 'The bank approved the family loan.', options: ['bank', 'shore', 'desk', 'coin'], answer: 'A' },
        ],
        validateCandidate: () => [],
        publishReadyVariants: async () => { published = true; },
        maxAttempts: 2,
    });

    await assert.rejects(
        service.process({ id: 'job-overlap', user_id: 'user-1', word_id: 'word-bank-bank' }),
        error => error.code === 'INSUFFICIENT_DISTINCT_READY_VARIANTS'
            && error.rejectionReasons.distractor_overlap === 2
    );
    assert.equal(published, false);
});
