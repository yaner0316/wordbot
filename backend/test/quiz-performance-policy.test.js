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

test('live quiz fallback stays on by default while cache warms up', () => {
    assert.equal(shouldAllowLiveQuizFallback({ cacheConfigured: true, flag: undefined }), true);
    assert.equal(shouldAllowLiveQuizFallback({ cacheConfigured: true, flag: '0' }), false);
    assert.equal(shouldAllowLiveQuizFallback({ cacheConfigured: true, flag: '1' }), true);
});

test('live quiz fallback remains available when cache is not configured', () => {
    assert.equal(shouldAllowLiveQuizFallback({ cacheConfigured: false, flag: undefined }), true);
});
