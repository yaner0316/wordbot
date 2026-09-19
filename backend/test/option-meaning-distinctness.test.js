'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizeMeaningTokens,
    meaningsOverlap,
    getOverlappingOptionPairs,
    hasOverlappingOptionMeanings,
} = require('../option-meaning-distinctness');

test('option meanings repeat or contain each other and are reported as collisions', () => {
    // Real production cases: career/occupation both gloss as 职业, and a distractor glossed
    // 极小 collides with the answer 极小的. Note that 的 is stripped before comparison, so
    // 小的 reduces to a single character and is treated as noise, not as a collision.
    assert.deepEqual(getOverlappingOptionPairs(['\u804c\u4e1a', '\u804c\u4e1a', '\u5de5\u4f5c', '\u5b66\u6821']), [[0, 1]]);
    assert.deepEqual(getOverlappingOptionPairs(['\u6781\u5c0f\u7684', '\u6781\u5c0f', '\u684c\u5b50', '\u6cb3\u6d41']), [[0, 1]]);
    assert.equal(hasOverlappingOptionMeanings(['\u9ec4\u660f,\u8584\u66ae', '\u9ec4\u660f', '\u68ee\u6797', '\u8bfe\u7a0b']), true);
    assert.deepEqual(getOverlappingOptionPairs(['\u6781\u5c0f\u7684', '\u5c0f\u7684', '\u684c\u5b50', '\u6cb3\u6d41']), []);
});

test('clearly different option meanings are accepted', () => {
    assert.deepEqual(getOverlappingOptionPairs(['\u82f9\u679c', '\u68a8\u5b50', '\u684c\u5b50', '\u6cb3\u6d41']), []);
    assert.equal(hasOverlappingOptionMeanings(['\u82f9\u679c', '\u68a8\u5b50', '\u684c\u5b50', '\u6cb3\u6d41']), false);
});

test('an incomplete option list is not judged', () => {
    assert.deepEqual(getOverlappingOptionPairs(['\u82f9\u679c', '\u68a8\u5b50']), []);
    assert.deepEqual(getOverlappingOptionPairs(null), []);
    assert.equal(hasOverlappingOptionMeanings([]), false);
});

test('tokens split on Chinese punctuation and drop single-character noise', () => {
    assert.deepEqual(normalizeMeaningTokens('\u53d6\u6d88,\u505c\u6b62'), ['\u53d6\u6d88', '\u505c\u6b62']);
    assert.deepEqual(normalizeMeaningTokens('\u6bcf\uff1b\u6bcf\u4e2a\uff1b\u7528'), ['\u6bcf\u4e2a']);
});

test('overlap needs a shared token, not merely a shared character', () => {
    assert.equal(meaningsOverlap('\u6cb3\u6d41', '\u6cb3\u5cb8'), false);
    assert.equal(meaningsOverlap('\u9ec4\u660f', '\u9ec4\u660f,\u8584\u66ae'), true);
});
