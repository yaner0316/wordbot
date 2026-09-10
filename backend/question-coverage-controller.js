'use strict';

const { planQuestionCoverage } = require('./question-coverage-policy');

function createQuestionCoverageReconciler({ loadSnapshot, enqueue, limit = 250 } = {}) {
    const read = requireFunction(loadSnapshot, 'QUESTION_COVERAGE_SNAPSHOT_READER_REQUIRED');
    const persist = requireFunction(enqueue, 'QUESTION_COVERAGE_ENQUEUE_REQUIRED');
    return async function reconcileQuestionCoverage() {
        const snapshot = await read();
        const plan = planQuestionCoverage({ ...(snapshot || {}), limit });
        let enqueued = 0;
        for (const target of plan.targets) {
            if (await persist(target) !== true) {
                const error = new Error('QUESTION_COVERAGE_ENQUEUE_NOT_CONFIRMED');
                error.code = 'QUESTION_COVERAGE_ENQUEUE_NOT_CONFIRMED';
                throw error;
            }
            enqueued += 1;
        }
        return { ...plan, enqueued };
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
            .catch(() => {
                const safeError = new Error('question_coverage_reconciliation_failed');
                observability.lastError = safeError.message;
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

module.exports = { createQuestionCoverageController, createQuestionCoverageReconciler };
