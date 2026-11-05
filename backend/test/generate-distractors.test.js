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

test('high-school prompt keeps distractors accessible and in the same category while forbidding gloss collisions', async () => {
    // Two production failures shaped this contract:
    //  - Asking for the same category with no Chinese-meaning constraint produced synonym
    //    glosses that repeated (职业/职业), which rejected candidates at 50%+ of attempts.
    //  - Then asking for words that are "not associated" produced unrelated and harder
    //    distractors (saucer -> sprocket/lagoon/buttress), so difficulty and plausibility
    //    must be required explicitly, and the collision limit must be stated about the
    //    Chinese meaning rather than by banning associated words.
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
    assert.match(capturedPrompt, /same part of speech/i);
    assert.match(capturedPrompt, /distractors must not add unsupported vocabulary barriers/i);
    assert.doesNotMatch(capturedPrompt, /similar difficulty as the answer/i);
    assert.match(capturedPrompt, /plausible same-category words/i);
    assert.doesNotMatch(capturedPrompt, /never synonyms, antonyms or associated words/i);
    assert.match(capturedPrompt, /Chinese meaning must not repeat or contain another option/i);
    assert.match(capturedPrompt, /\u9ad8\u4e2d/);
    // The local rubric is included; the full curriculum vocabulary must not be.
    assert.ok(capturedPrompt.length < 5000, 'include a bounded rubric, not the complete reference corpus');
});
