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

test('accepts natural phrase candidates for contextual review', async () => {
    const result = await selectContextualDistractors({
        word: 'apple',
        context: 'I ate an apple after lunch.',
        candidates: ['pear', 'banana'],
        callLLM: async () => '{"distractors":["agree to","banana","orange"]}',
    });

    assert.deepEqual(result, ['agree to','banana','orange']);
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
    assert.match(capturedPrompt, /natural phrases/i);

});

test('high-school prompt supports several candidate sources without hidden overlap veto', async () => {
    let capturedPrompt = '';
    const result = await selectContextualDistractors({
        word: 'saucer',
        meaning: '\u8336\u789f',
        level: '\u9ad8\u4e2d',
        context: 'After finishing her tea, Lily placed the cup on the _____.',
        candidates: ['plate'],
        callLLM: async prompt => {
            capturedPrompt = prompt;
            return '{"distractors":["cup","bowl","tray"]}';
        },
    });

    assert.deepEqual(result, ['cup', 'bowl', 'tray']);
    assert.match(capturedPrompt, /same-POS/i);
    assert.match(capturedPrompt, /Do not add unsupported vocabulary barriers/i);
    assert.doesNotMatch(capturedPrompt, /similar difficulty as the answer/i);
    assert.match(capturedPrompt, /antonyms, related concepts or natural phrases/i);
    assert.doesNotMatch(capturedPrompt, /never synonyms, antonyms or associated words/i);
    assert.doesNotMatch(capturedPrompt, /Chinese meaning must not repeat or contain another option/i);
    assert.match(capturedPrompt, /\u9ad8\u4e2d/);
    // The local rubric is included; the full curriculum vocabulary must not be.
    assert.ok(capturedPrompt.length < 5000, 'include a bounded rubric, not the complete reference corpus');
});
