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
