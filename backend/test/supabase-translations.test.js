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

test('word translation retries one malformed response before succeeding', async () => {
    let calls = 0;
    const translated = await translateSupabaseWords(['apple'], {
        request: async () => {
            calls += 1;
            return calls === 1 ? 'not json' : JSON.stringify({ apple: '苹果' });
        },
    });

    assert.deepEqual(translated, { apple: '苹果' });
    assert.equal(calls, 2);
});

test('word translation stops after two malformed responses with the typed error', async () => {
    let calls = 0;
    await assert.rejects(
        translateSupabaseWords(['apple'], {
            request: async () => {
                calls += 1;
                return 'not json';
            },
        }),
        error => error.code === 'TRANSLATION_RESPONSE_INVALID'
    );

    assert.equal(calls, 2);
});

test('sentence translation retries one invalid provider envelope before succeeding', async () => {
    let calls = 0;
    const translated = await translateSupabaseContext('I ate an apple after lunch.', {
        request: async () => {
            calls += 1;
            if (calls === 1) {
                const error = new Error('missing response content');
                error.code = 'TRANSLATION_RESPONSE_INVALID';
                throw error;
            }
            return '我午饭后吃了一个苹果。';
        },
    });

    assert.equal(translated, '我午饭后吃了一个苹果。');
    assert.equal(calls, 2);
});


test('word translation rejects a long definition instead of saving or truncating it', async () => {
    await assert.rejects(translateSupabaseWords(['citizen'], {
        request: async () => JSON.stringify({ citizen: '城市或城镇的居民，尤指拥有法律承认的权利或义务的居民' }),
    }), error => error.code === 'TRANSLATION_QUALITY_INVALID');
});

test('word translation keeps concise multi-sense labels and gives the provider a short-phrase limit', async () => {
    const label = '首领；（纹章）上部；主要部分、顶部';
    const result = await translateSupabaseWords(['chief'], { request: async prompt => {
        assert.match(prompt, /2.{0,3}8/);
        assert.match(prompt, /20/);
        return JSON.stringify({ chief: label });
    } });
    assert.deepEqual(result, { chief: label });
});
