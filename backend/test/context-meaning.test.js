const test = require('node:test');
const assert = require('node:assert/strict');

const {
    cleanContextualMeaning,
    enrichContextualCorrectMeanings,
} = require('../context-meaning');

test('cleans concise Chinese context meanings and rejects unusable output', () => {
    assert.equal(cleanContextualMeaning(' 中文释义：促销活动 '), '促销活动');
    assert.equal(cleanContextualMeaning('promotion campaign'), '');
    assert.equal(cleanContextualMeaning('促销活动推广品牌意识超过十个字'), '');
    assert.equal(cleanContextualMeaning('Could you let me know what you would like me to do?'), '');
});

test('type-one questions use contextual meaning when generation succeeds', async () => {
    const calls = [];
    const questions = [{
        type: 1,
        word: 'promotion',
        context: "The company's latest _____ included free samples to boost brand awareness.",
        correctMeaning: '晋升；提升',
    }];

    await enrichContextualCorrectMeanings(questions, {
        generateContextMeaning: async (word, context) => {
            calls.push({ word, context });
            return '促销活动';
        },
    });

    assert.deepEqual(calls, [{
        word: 'promotion',
        context: "The company's latest _____ included free samples to boost brand awareness.",
    }]);
    assert.equal(questions[0].correctMeaning, '促销活动');
});

test('non-type-one questions and failed generations keep existing meanings', async () => {
    const questions = [
        { type: 2, word: 'promotion', context: 'a move to a higher position', correctMeaning: '晋升；提升' },
        { type: 1, word: 'transfer', context: 'The employee requested a _____.', correctMeaning: '调动' },
    ];

    await enrichContextualCorrectMeanings(questions, {
        generateContextMeaning: async () => '',
    });

    assert.equal(questions[0].correctMeaning, '晋升；提升');
    assert.equal(questions[1].correctMeaning, '调动');
});

test('reuses contextual meaning calls for identical word and context pairs', async () => {
    let calls = 0;
    const questions = [
        { type: 1, word: 'promotion', context: 'The latest _____ included free samples.', correctMeaning: '晋升；提升' },
        { type: 1, word: 'promotion', context: 'The latest _____ included free samples.', correctMeaning: '晋升；提升' },
    ];

    await enrichContextualCorrectMeanings(questions, {
        generateContextMeaning: async () => {
            calls++;
            return '促销活动';
        },
    });

    assert.equal(calls, 1);
    assert.deepEqual(questions.map(q => q.correctMeaning), ['促销活动', '促销活动']);
});
