const test = require('node:test');
const assert = require('node:assert/strict');

const {
    shouldAllowLiveQuizFallback,
    shouldRunAiQuizAudit,
} = require('../quiz-performance-policy');

test('does not run AI quiz audit just because a MiniMax key exists', () => {
    assert.equal(shouldRunAiQuizAudit({ enabled: false, hasApiKey: true, questionCount: 10 }), false);
});

test('runs AI quiz audit only when explicitly enabled with questions and an API key', () => {
    assert.equal(shouldRunAiQuizAudit({ enabled: true, hasApiKey: true, questionCount: 10 }), true);
    assert.equal(shouldRunAiQuizAudit({ enabled: true, hasApiKey: false, questionCount: 10 }), false);
    assert.equal(shouldRunAiQuizAudit({ enabled: true, hasApiKey: true, questionCount: 0 }), false);
});

test('formal quiz live fallback is disabled regardless of cache configuration or flag', () => {
    assert.equal(shouldAllowLiveQuizFallback({ cacheConfigured: true, flag: undefined, mode: 'real' }), false);
    assert.equal(shouldAllowLiveQuizFallback({ cacheConfigured: false, flag: '1', mode: 'real' }), false);
});

test('non-formal quiz fallback keeps its explicit operational policy', () => {
    assert.equal(shouldAllowLiveQuizFallback({ cacheConfigured: true, flag: undefined, mode: 'test' }), true);
    assert.equal(shouldAllowLiveQuizFallback({ cacheConfigured: true, flag: '0', mode: 'test' }), false);
    assert.equal(shouldAllowLiveQuizFallback({ cacheConfigured: false, flag: undefined, mode: 'test' }), true);
});
