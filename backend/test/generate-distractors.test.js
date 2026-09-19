const test = require('node:test');
const assert = require('node:assert/strict');

const { selectContextualDistractors } = require('../generate-distractors');

test('returns three clean single-word distractors from LLM JSON', async () => {
    const result = await selectContextualDistractors({
        word: 'apple',
        context: 'I ate an apple after lunch.',
        candidates: ['pear', 'banana'],
        callLLM: async () => '{"distractors":["pear","banana","orange"]}',
    });

    assert.deepEqual(result, ['pear', 'banana', 'orange']);
});

test('rejects phrase distractors so fill-in rebuild can fall back safely', async () => {
    const result = await selectContextualDistractors({
        word: 'apple',
        context: 'I ate an apple after lunch.',
        candidates: ['pear', 'banana'],
        callLLM: async () => '{"distractors":["agree to","banana","orange"]}',
    });

    assert.equal(result, null);
});
test('prompt uses the real stem and asks the model to avoid prior variant distractors', async () => {
    let capturedPrompt = '';
    const result = await selectContextualDistractors({
        word: 'apple',
        meaning: 'a fruit',
        context: 'The child packed an _____ for the long trip.',
        candidates: ['pear', 'banana'],
        excludedDistractors: ['orange', 'peach', 'plum'],
        callLLM: async prompt => {
            capturedPrompt = prompt;
            return '{"distractors":["snack","sandwich","biscuit"]}';
        },
    });

    assert.deepEqual(result, ['snack', 'sandwich', 'biscuit']);
    assert.match(capturedPrompt, /The child packed an ___ for the long trip\./);
    assert.match(capturedPrompt, /Required meaning: \"a fruit\"/);
    assert.match(capturedPrompt, /orange, peach, plum/);
    assert.match(capturedPrompt, /exactly one English word/i);
    assert.ok(capturedPrompt.length < 700, 'reasoning-model prompt must stay compact');
});

test('prompt forbids synonyms and requires clearly different Chinese option meanings', async () => {
    // "Prefer the same semantic category" invited the synonyms whose Chinese glosses then
    // repeated (职业/职业) or contained each other (小的 inside 极小的), which is the
    // largest single source of rejected candidates in production.
    let capturedPrompt = '';
    const result = await selectContextualDistractors({
        word: 'tiny',
        meaning: '\u6781\u5c0f\u7684',
        level: '\u5c0f\u5b66',
        context: 'The kitten was _____ compared with its mother.',
        candidates: ['small'],
        callLLM: async prompt => {
            capturedPrompt = prompt;
            return '{"distractors":["chair","river","apple"]}';
        },
    });

    assert.deepEqual(result, ['chair', 'river', 'apple']);
    assert.doesNotMatch(capturedPrompt, /same semantic category/i);
    assert.match(capturedPrompt, /never synonyms, antonyms or associated words/i);
    assert.match(capturedPrompt, /Chinese meaning must clearly differ from the required meaning/i);
    assert.match(capturedPrompt, /\u5c0f\u5b66/);
    assert.match(capturedPrompt, /Required meaning: \"\u6781\u5c0f\u7684\"/);
    assert.ok(capturedPrompt.length < 700, 'reasoning-model prompt must stay compact');
});
