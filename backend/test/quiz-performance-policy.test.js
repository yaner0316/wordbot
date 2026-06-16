const test = require('node:test');
const assert = require('node:assert/strict');

const { shouldRunAiQuizAudit } = require('../quiz-performance-policy');

test('does not run AI quiz audit just because a MiniMax key exists', () => {
    assert.equal(shouldRunAiQuizAudit({ enabled: false, hasApiKey: true, questionCount: 10 }), false);
});

test('runs AI quiz audit only when explicitly enabled with questions and an API key', () => {
    assert.equal(shouldRunAiQuizAudit({ enabled: true, hasApiKey: true, questionCount: 10 }), true);
    assert.equal(shouldRunAiQuizAudit({ enabled: true, hasApiKey: false, questionCount: 10 }), false);
    assert.equal(shouldRunAiQuizAudit({ enabled: true, hasApiKey: true, questionCount: 0 }), false);
});
