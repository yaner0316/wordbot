const test = require('node:test');
const assert = require('node:assert/strict');

const {
    DEFAULT_MINIMAX_MODEL,
    DEFAULT_MINIMAX_MAX_TOKENS,
    DEFAULT_MINIMAX_TIMEOUT_MS,
    buildMiniMaxRequestBody,
    getMiniMaxSettings,
} = require('../minimax-settings');

test('MiniMax defaults support fast structured generation within a bounded budget', () => {
    assert.equal(DEFAULT_MINIMAX_MODEL, 'MiniMax-M3');
    assert.equal(DEFAULT_MINIMAX_MAX_TOKENS, 2048);
    assert.equal(DEFAULT_MINIMAX_TIMEOUT_MS, 30000);
    assert.deepEqual(buildMiniMaxRequestBody('prompt', {}), {
        model: 'MiniMax-M3',
        messages: [{ role: 'user', content: 'prompt' }],
        max_tokens: 2048,
        temperature: 0.1,
        thinking: { type: 'disabled' },
    });
});

test('MiniMax model and budgets are configurable within lease-safe bounds', () => {
    const settings = getMiniMaxSettings({
        MINIMAX_MODEL: 'MiniMax-M2.5',
        MINIMAX_MAX_TOKENS: '3072',
        MINIMAX_TIMEOUT_MS: '60000',
    });
    assert.deepEqual(settings, {
        model: 'MiniMax-M2.5',
        maxTokens: 3072,
        timeoutMs: 45000,
        temperature: 0.1,
    });
});

test('MiniMax M2 fallback does not claim unsupported thinking control', () => {
    assert.deepEqual(buildMiniMaxRequestBody('prompt', { MINIMAX_MODEL: 'MiniMax-M2.7' }), {
        model: 'MiniMax-M2.7',
        messages: [{ role: 'user', content: 'prompt' }],
        max_tokens: 2048,
        temperature: 0.1,
    });
});
