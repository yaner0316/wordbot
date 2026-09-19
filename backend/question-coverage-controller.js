'use strict';

const { planQuestionCoverage } = require('./question-coverage-policy');

// Bounded, safe failure categories for operators. They never carry row values,
// provider payloads, credentials or any raw error message.
const SAFE_RECONCILIATION_FAILURE_CODES = Object.freeze({
    QUESTION_COVERAGE_SNAPSHOT_READER_REQUIRED: 'not_configured',
    QUESTION_COVERAGE_ENQUEUE_REQUIRED: 'not_configured',
    QUESTION_COVERAGE_RECONCILER_REQUIRED: 'not_configured',
    QUESTION_COVERAGE_ENQUEUE_NOT_CONFIRMED: 'enqueue_not_confirmed',
    QUESTION_COVERAGE_ENQUEUE_FAILED: 'enqueue_failed',
});
const SAFE_RECONCILIATION_FALLBACK_CODE = 'reconciliation_failed';

function reconciliationFailureCode(error) {
    const code = String(error?.code || '');
    if (SAFE_RECONCILIATION_FAILURE_CODES[code]) return SAFE_RECONCILIATION_FAILURE_CODES[code];
    const message = String(error?.message || '');
    if (SAFE_RECONCILIATION_FAILURE_CODES[message]) return SAFE_RECONCILIATION_FAILURE_CODES[message];
    if (/^QUESTION_COVERAGE_[A-Z_]+_LOAD_FAILED$/.test(code) || /^QUESTION_COVERAGE_[A-Z_]+_LOAD_FAILED$/.test(message)) {
        return 'snapshot_load_failed';
    }
    if (/^QUESTION_COVERAGE_[A-Z_]+_CURSOR_INVALID$/.test(code) || /^QUESTION_COVERAGE_[A-Z_]+_CURSOR_INVALID$/.test(message)) {
        return 'snapshot_cursor_invalid';
    }
    return SAFE_RECONCILIATION_FALLBACK_CODE;
}

function createQuestionCoverageReconciler({ loadSnapshot, enqueue, limit = 250 } = {}) {
    const read = requireFunction(loadSnapshot, 'QUESTION_COVERAGE_SNAPSHOT_READER_REQUIRED');
    const persist = requireFunction(enqueue, 'QUESTION_COVERAGE_ENQUEUE_REQUIRED');
    return async function reconcileQuestionCoverage() {
        const snapshot = await read();
        const plan = planQuestionCoverage({ ...(snapshot || {}), limit });
        let enqueued = 0;
        let skipped = 0;
        for (const target of plan.targets) {
            const accepted = await persist(target);
            if (accepted === true) {
                enqueued += 1;
                continue;
            }
            // false is the enqueue contract's "nothing to do" answer: the meaning
            // became mastered or deleted, the word version already has an executable
            // job, or the user has no current learning level. Only a missing answer
            // (undefined/null) is a durable-acceptance failure.
            if (accepted === false) {
                skipped += 1;
                continue;
            }
            const error = new Error('QUESTION_COVERAGE_ENQUEUE_NOT_CONFIRMED');
            error.code = 'QUESTION_COVERAGE_ENQUEUE_NOT_CONFIRMED';
            throw error;
        }
        return { ...plan, enqueued, skipped };
    };
}

function requireFunction(value, code) {
    if (typeof value !== 'function') throw new Error(code);
    return value;
}

function createQuestionCoverageController({
    reconcile,
    intervalMs = 5 * 60_000,
    runImmediately = true,
    onError = () => {},
    onSuccess = () => {},
    now = () => new Date().toISOString(),
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
} = {}) {
    const runReconciliation = requireFunction(reconcile, 'QUESTION_COVERAGE_RECONCILER_REQUIRED');
    const reportError = requireFunction(onError, 'QUESTION_COVERAGE_ERROR_HANDLER_REQUIRED');
    const reportSuccess = requireFunction(onSuccess, 'QUESTION_COVERAGE_SUCCESS_HANDLER_REQUIRED');
    const clock = requireFunction(now, 'QUESTION_COVERAGE_CLOCK_REQUIRED');
    const schedule = requireFunction(setIntervalFn, 'QUESTION_COVERAGE_TIMER_REQUIRED');
    const cancel = requireFunction(clearIntervalFn, 'QUESTION_COVERAGE_TIMER_CANCEL_REQUIRED');
    const delay = Math.max(1, Number(intervalMs) || 5 * 60_000);
    let timer = null;
    let inFlight = null;
    const observability = {
        startedAt: null,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastError: null,
        lastResult: null,
    };

    function timestamp() {
        const value = clock();
        const parsed = value instanceof Date ? value : new Date(value);
        return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : String(value || '');
    }

    function runOnce() {
        if (inFlight) return inFlight;
        observability.lastAttemptAt = timestamp();
        inFlight = Promise.resolve()
            .then(() => runReconciliation())
            .then(result => {
                observability.lastSuccessAt = timestamp();
                observability.lastError = null;
                observability.lastResult = result || null;
                reportSuccess(result);
                return result;
            })
            .catch(error => {
                // Classify the cause into a bounded safe code. The raw error is
                // deliberately not surfaced: it previously made every failure look
                // identical, and it may carry provider or user detail.
                const safeCode = reconciliationFailureCode(error);
                const safeError = new Error(safeCode);
                safeError.code = safeCode;
                observability.lastError = safeCode;
                try { reportError(safeError); } catch (_) {}
                return null;
            })
            .finally(() => { inFlight = null; });
        return inFlight;
    }

    return {
        start() {
            if (timer !== null) return false;
            observability.startedAt = observability.startedAt || timestamp();
            timer = schedule(() => { runOnce(); }, delay);
            if (runImmediately) runOnce();
            return true;
        },
        async stop() {
            if (timer !== null) {
                cancel(timer);
                timer = null;
            }
            if (inFlight) await inFlight;
        },
        runOnce,
        isRunning() { return timer !== null; },
        getObservability() { return { ...observability }; },
    };
}

module.exports = {
    createQuestionCoverageController,
    createQuestionCoverageReconciler,
    reconciliationFailureCode,
};
