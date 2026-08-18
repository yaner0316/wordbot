'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { translateSupabaseContext, translateSupabaseWords } = require('../supabase-translations');

async function withoutMiniMaxKey(run) {
    const previous = process.env.MINIMAX_API_KEY;
    delete process.env.MINIMAX_API_KEY;
    try {
        return await run();
    } finally {
        if (previous === undefined) delete process.env.MINIMAX_API_KEY;
        else process.env.MINIMAX_API_KEY = previous;
    }
}

test('word translation rejects malformed provider output with a stable error code', async () => {
    await withoutMiniMaxKey(() => assert.rejects(
        translateSupabaseWords(['apple'], { request: async () => 'not json' }),
        error => error.code === 'TRANSLATION_RESPONSE_INVALID'
    ));
});

test('word translation rejects incomplete Chinese mappings instead of returning partial success', async () => {
    await withoutMiniMaxKey(() => assert.rejects(
        translateSupabaseWords(['apple', 'pear'], {
            request: async () => JSON.stringify({ apple: '苹果', pear: 'pear' }),
        }),
        error => error.code === 'TRANSLATION_QUALITY_INVALID'
    ));
});

test('sentence translation rejects a word meaning masquerading as a complete sentence', async () => {
    await withoutMiniMaxKey(() => assert.rejects(
        translateSupabaseContext('I ate an apple after lunch.', { request: async () => '苹果' }),
        error => error.code === 'TRANSLATION_QUALITY_INVALID'
    ));
});

test('translation preserves the provider error code for job retry diagnostics', async () => {
    const providerError = Object.assign(new Error('provider unavailable'), {
        code: 'TRANSLATION_PROVIDER_UNAVAILABLE',
    });
    await withoutMiniMaxKey(() => assert.rejects(
        translateSupabaseWords(['apple'], {
            request: async () => { throw providerError; },
        }),
        error => error === providerError
    ));
});
