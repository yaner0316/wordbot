'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    invalidateVariantFromStage,
    normalizeGenerationCheckpoint,
} = require('../question-generation-checkpoint');

function completeVariant(slot) {
    return {
        slot,
        context: `Context ${slot}`,
        distractors: [`d${slot}a`, `d${slot}b`, `d${slot}c`],
        optionWords: ['bank', `d${slot}a`, `d${slot}b`, `d${slot}c`],
        options: ['A. bank', `B. d${slot}a`, `C. d${slot}b`, `D. d${slot}c`],
        answer: 'A',
        optionMeanings: ['银行', '一', '二', '三'],
        contextTranslation: `语境${slot}`,
        localValidated: true,
        audit: { status: 'approved', validLetters: ['A'] },
        row: { question_fingerprint: `fp-${slot}` },
    };
}

test('distractor invalidation preserves context and its translation but removes option-dependent stages', () => {
    const result = invalidateVariantFromStage(completeVariant(1), 'distractors');

    assert.equal(result.context, 'Context 1');
    assert.equal(result.contextTranslation, '语境1');
    assert.equal('distractors' in result, false);
    assert.equal('optionMeanings' in result, false);
    assert.equal('audit' in result, false);
    assert.equal('row' in result, false);
});

test('semantic audit invalidation preserves every preceding stage', () => {
    const result = invalidateVariantFromStage(completeVariant(1), 'semantic_audit');

    assert.deepEqual(result.distractors, ['d1a', 'd1b', 'd1c']);
    assert.deepEqual(result.optionMeanings, ['银行', '一', '二', '三']);
    assert.equal(result.contextTranslation, '语境1');
    assert.equal('audit' in result, false);
    assert.equal('row' in result, false);
});

test('checkpoint normalization preserves an approved sibling and handles casing as a downstream-only change', () => {
    const checkpoint = {
        schemaVersion: 1,
        wordVersion: 1,
        level: '小学',
        word: 'Bank',
        meaning: '银行',
        variants: [completeVariant(1), completeVariant(2)],
    };

    const normalized = normalizeGenerationCheckpoint(checkpoint, {
        wordVersion: 2,
        level: '小学',
        word: 'bank',
        meaning: '银行',
    });

    assert.equal(normalized.wordVersion, 2);
    assert.equal(normalized.variants[0].context, 'Context 1');
    assert.deepEqual(normalized.variants[1].distractors, ['d2a', 'd2b', 'd2c']);
    assert.equal('optionWords' in normalized.variants[0], false);
    assert.equal('row' in normalized.variants[1], false);
});

test('checkpoint normalization resets variants when level, spelling, or meaning changes materially', () => {
    const checkpoint = {
        schemaVersion: 1,
        wordVersion: 1,
        level: '小学',
        word: 'bank',
        meaning: '银行',
        variants: [completeVariant(1)],
    };

    for (const input of [
        { wordVersion: 2, level: '初中', word: 'bank', meaning: '银行' },
        { wordVersion: 2, level: '小学', word: 'banks', meaning: '银行' },
        { wordVersion: 2, level: '小学', word: 'bank', meaning: '河岸' },
    ]) {
        assert.deepEqual(normalizeGenerationCheckpoint(checkpoint, input).variants, []);
    }
});
