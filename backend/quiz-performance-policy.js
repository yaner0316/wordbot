function shouldRunAiQuizAudit({ enabled, hasApiKey, questionCount }) {
    return Boolean(enabled && hasApiKey && questionCount > 0);
}

function shouldAllowLiveQuizFallback({ cacheConfigured, flag }) {
    if (!cacheConfigured) return true;
    return flag !== '0';
}

function createQuizTimingLogger({ enabled = false, now = Date.now, log = console.log } = {}) {
    const start = now();
    let last = start;
    return function mark(label) {
        if (!enabled) return;
        const current = now();
        log(`[quiz-timing] ${label}: +${current - last}ms total=${current - start}ms`);
        last = current;
    };
}

module.exports = {
    createQuizTimingLogger,
    shouldAllowLiveQuizFallback,
    shouldRunAiQuizAudit,
};
