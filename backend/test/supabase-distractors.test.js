const test = require('node:test');
const assert = require('node:assert/strict');

const { generateSupabaseDistractors } = require('../supabase-distractors');

test('Supabase distractor wrapper fails closed when the real stem is missing', async () => {
    let fetched = false;
    const previousFetch = global.fetch;
    global.fetch = async () => {
        fetched = true;
        throw new Error('must not fetch');
    };
    try {
        assert.equal(await generateSupabaseDistractors({ word: 'apple', meaning: 'a fruit', context: '' }), null);
        assert.equal(fetched, false);
    } finally {
        global.fetch = previousFetch;
    }
});

test('Supabase distractor wrapper sends the real stem and prior distractors to MiniMax', async () => {
    const previousKey = process.env.MINIMAX_API_KEY;
    const previousModel = process.env.MINIMAX_MODEL;
    const previousFetch = global.fetch;
    let request = null;
    process.env.MINIMAX_API_KEY = 'test-key';
    process.env.MINIMAX_MODEL = 'MiniMax-M2.5';
    global.fetch = async (url, options) => {
        request = { url, options };
        return {
            ok: true,
            json: async () => ({
                choices: [{ message: { content: '{"distractors":["snack","sandwich","biscuit"]}' } }],
            }),
        };
    };
    try {
        const result = await generateSupabaseDistractors({
            word: 'apple',
            meaning: 'a fruit',
            context: 'The child packed an _____ for the long trip.',
            candidates: ['pear', 'banana'],
            excludedDistractors: ['orange', 'peach', 'plum'],
        });
        assert.deepEqual(result, ['snack', 'sandwich', 'biscuit']);
        const body = JSON.parse(request.options.body);
        assert.equal(body.model, 'MiniMax-M2.5');
        assert.equal(body.max_tokens, 2048);
        assert.equal(body.temperature, 0.1);
        assert.match(body.messages[0].content, /The child packed an ___ for the long trip\./);
        assert.match(body.messages[0].content, /orange, peach, plum/);
    } finally {
        if (previousKey === undefined) delete process.env.MINIMAX_API_KEY;
        else process.env.MINIMAX_API_KEY = previousKey;
        if (previousModel === undefined) delete process.env.MINIMAX_MODEL;
        else process.env.MINIMAX_MODEL = previousModel;
        global.fetch = previousFetch;
    }
});
