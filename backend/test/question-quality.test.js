const { strict: assert } = require('assert');
const { test } = require('node:test');
const {
    hasAiMetaResponse,
    hasMeaningfulChineseMeaning,
    isQuestionQualityAcceptable,
} = require('../question-quality');

const META = "The text you've shared looks like garbled text. Could you let me know what you would like me to do?";
const META_CN = '您好，您提供的内容无法理解，请告诉我您的具体需求';

test('hasAiMetaResponse detects English meta-response', () => {
    assert.equal(hasAiMetaResponse(META), true);
});

test('hasAiMetaResponse detects Chinese meta-response', () => {
    assert.equal(hasAiMetaResponse(META_CN), true);
});

test('hasAiMetaResponse passes clean Chinese', () => {
    assert.equal(hasAiMetaResponse('固执的'), false);
});

test('hasMeaningfulChineseMeaning accepts valid Chinese', () => {
    assert.equal(hasMeaningfulChineseMeaning('固执的'), true);
});

test('hasMeaningfulChineseMeaning rejects empty', () => {
    assert.equal(hasMeaningfulChineseMeaning(''), false);
    assert.equal(hasMeaningfulChineseMeaning(null), false);
});

test('hasMeaningfulChineseMeaning rejects AI meta-response', () => {
    assert.equal(hasMeaningfulChineseMeaning(META_CN), false);
});

test('hasMeaningfulChineseMeaning rejects text with no Chinese characters', () => {
    assert.equal(hasMeaningfulChineseMeaning('stubborn'), false);
});

test('hasMeaningfulChineseMeaning rejects text over 50 chars', () => {
    assert.equal(hasMeaningfulChineseMeaning('固执的'.repeat(20)), false);
});

test('isQuestionQualityAcceptable: type 1 with dirty context is rejected', () => {
    const q = { type: 1, context: META, correctMeaning: '固执的', options: ['A. a', 'B. b', 'C. c', 'D. d'], answer: 'A', word: 'a' };
    assert.equal(isQuestionQualityAcceptable(q), false);
});

test('isQuestionQualityAcceptable: type 1 with dirty correctMeaning clears it but keeps question', () => {
    const q = { type: 1, context: 'She was _____ about her decision.', correctMeaning: META_CN, options: ['A. stubborn', 'B. happy', 'C. calm', 'D. sad'], answer: 'A', word: 'stubborn' };
    const result = isQuestionQualityAcceptable(q);
    assert.equal(result, true);
    assert.equal(q.correctMeaning, '');
});

test('isQuestionQualityAcceptable: type 2 with dirty correctMeaning clears it but keeps question', () => {
    const q = { type: 2, context: 'refusing to change; unyielding', correctMeaning: META_CN, options: ['A. stubborn', 'B. happy', 'C. calm', 'D. sad'], answer: 'A', word: 'stubborn' };
    const result = isQuestionQualityAcceptable(q);
    assert.equal(result, true);
    assert.equal(q.correctMeaning, '');
});

test('isQuestionQualityAcceptable: type 3 with dirty context (CN_Meaning) is rejected', () => {
    const q = { type: 3, context: META_CN, correctMeaning: META_CN, options: ['A. stubborn', 'B. happy', 'C. calm', 'D. sad'], answer: 'A', word: 'stubborn' };
    assert.equal(isQuestionQualityAcceptable(q), false);
});

test('isQuestionQualityAcceptable: type 3 with English-only context is rejected', () => {
    const q = { type: 3, context: 'stubborn', correctMeaning: '固执的', options: ['A. stubborn', 'B. happy', 'C. calm', 'D. sad'], answer: 'A', word: 'stubborn' };
    assert.equal(isQuestionQualityAcceptable(q), false);
});

test('isQuestionQualityAcceptable: type 3 with clean CN_Meaning is accepted', () => {
    const q = { type: 3, context: '固执的', correctMeaning: '固执的', options: ['A. stubborn', 'B. happy', 'C. calm', 'D. sad'], answer: 'A', word: 'stubborn' };
    assert.equal(isQuestionQualityAcceptable(q), true);
});
