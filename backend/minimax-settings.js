'use strict';

const DEFAULT_MINIMAX_MODEL = 'MiniMax-M3';
const DEFAULT_MINIMAX_MAX_TOKENS = 2048;
const DEFAULT_MINIMAX_TIMEOUT_MS = 30000;
const MAX_MINIMAX_TIMEOUT_MS = 45000;
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
        timeoutMs: boundedInteger(env.MINIMAX_TIMEOUT_MS, DEFAULT_MINIMAX_TIMEOUT_MS, 5000, MAX_MINIMAX_TIMEOUT_MS),
        temperature: DEFAULT_MINIMAX_TEMPERATURE,
    };
}

function buildMiniMaxRequestBody(prompt, env = process.env) {
    const settings = getMiniMaxSettings(env);
    const body = {
        model: settings.model,
        messages: [{ role: 'user', content: String(prompt || '') }],
        max_tokens: settings.maxTokens,
        temperature: settings.temperature,
    };
    if (/^MiniMax-M3(?:$|-)/i.test(settings.model)) {
        body.thinking = { type: 'disabled' };
    }
    return body;
}

function assertMiniMaxResponse(payload) {
    const status = Number(payload?.base_resp?.status_code || 0);
    if (!status) return;
    const error = new Error(status === 2062 ? 'MiniMax Token Plan rate limit' : 'MiniMax provider rejected request');
    error.code = status === 2062 ? 'MINIMAX_RATE_LIMITED' : status === 2064 ? 'MINIMAX_PROVIDER_OVERLOADED' : 'MINIMAX_PROVIDER_UNAVAILABLE';
    throw error;
}

function assertMiniMaxHttpStatus(status) {
    if (status >= 200 && status < 300) return;
    const error = new Error('MiniMax HTTP request failed');
    error.code = status === 429 ? 'MINIMAX_RATE_LIMITED' : status === 529 ? 'MINIMAX_PROVIDER_OVERLOADED' : 'MINIMAX_PROVIDER_UNAVAILABLE';
    throw error;
}

function isMiniMaxProviderError(error) {
    return ['MINIMAX_RATE_LIMITED','MINIMAX_PROVIDER_UNAVAILABLE','MINIMAX_PROVIDER_OVERLOADED'].includes(error?.code);
}

function miniMaxFallback(error, value) {
    if (isMiniMaxProviderError(error)) throw error;
    return value;
}

module.exports = {
    assertMiniMaxResponse,
    assertMiniMaxHttpStatus,
    isMiniMaxProviderError,
    miniMaxFallback,
    DEFAULT_MINIMAX_MODEL,
    DEFAULT_MINIMAX_MAX_TOKENS,
    DEFAULT_MINIMAX_TIMEOUT_MS,
    DEFAULT_MINIMAX_TEMPERATURE,
    getMiniMaxSettings,
    buildMiniMaxRequestBody,
};
