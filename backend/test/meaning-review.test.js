const test = require('node:test');
const assert = require('node:assert/strict');

const {
    isMeaningAnswerCorrect,
    normalizeMeaningText,
} = require('../meaning-review');

test('normalizes punctuation and whitespace in Chinese meaning answers', () => {
    assert.equal(normalizeMeaningText(' 晋升； 提升。'), '晋升提升');
});

test('accepts a Chinese answer that matches one listed sense', () => {
    assert.equal(isMeaningAnswerCorrect('升职', '晋升；升职；提升'), true);
});

test('rejects an unrelated Chinese answer', () => {
    assert.equal(isMeaningAnswerCorrect('苹果', '晋升；提升'), false);
});
