'use strict';

const DEFAULT_MINIMAX_MODEL = 'MiniMax-M2.7';
const DEFAULT_MINIMAX_MAX_TOKENS = 2048;
const DEFAULT_MINIMAX_TIMEOUT_MS = 45000;
const DEFAULT_MINIMAX_TEMPERATURE = 0.1;

function boundedInteger(value, fallback, minimum, maximum) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

function getMiniMaxSettings(env = process.env) {
    return {
        model: String(env.MINIMAX_MODEL || DEFAULT_MINIMAX_MODEL).trim() || DEFAULT_MINIMAX_MODEL,
        maxTokens: boundedInteger(env.MINIMAX_MAX_TOKENS, DEFAULT_MINIMAX_MAX_TOKENS, 512, 8192),
        timeoutMs: boundedInteger(env.MINIMAX_TIMEOUT_MS, DEFAULT_MINIMAX_TIMEOUT_MS, 5000, 120000),
        temperature: DEFAULT_MINIMAX_TEMPERATURE,
    };
}

function buildMiniMaxRequestBody(prompt, env = process.env) {
    const settings = getMiniMaxSettings(env);
    return {
        model: settings.model,
        messages: [{ role: 'user', content: String(prompt || '') }],
        max_tokens: settings.maxTokens,
        temperature: settings.temperature,
    };
}

module.exports = {
    DEFAULT_MINIMAX_MODEL,
    DEFAULT_MINIMAX_MAX_TOKENS,
    DEFAULT_MINIMAX_TIMEOUT_MS,
    DEFAULT_MINIMAX_TEMPERATURE,
    getMiniMaxSettings,
    buildMiniMaxRequestBody,
};
