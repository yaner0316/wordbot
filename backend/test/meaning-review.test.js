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

test('accepts a concise canonical Chinese translation for a long explanatory meaning', () => {
    assert.equal(
        isMeaningAnswerCorrect(
            '灵魂伴侣',
            '一个人，尤其是浪漫伴侣，与之有着异常或独特的契合度，或有着特殊的、几乎是精神层面的联系。'
        ),
        true
    );
});
