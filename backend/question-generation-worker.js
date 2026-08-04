'use strict';

function requireFunction(value, code) {
    if (typeof value !== 'function') throw new Error(code);
    return value;
}

function requireWorkerId(value) {
    const workerId = String(value || '').trim();
    if (!workerId) throw new Error('WORKER_ID_REQUIRED');
    return workerId;
}

function boundedLimit(value, fallback = 5) {
    return Math.max(1, Math.floor(Number(value) || fallback));
}

async function runQuestionGenerationBatch({
    jobStore,
    generationService,
    workerId,
    limit = 5,
} = {}) {
    const claim = requireFunction(jobStore?.claim, 'QUESTION_GENERATION_JOB_CLAIM_REQUIRED').bind(jobStore);
    const complete = requireFunction(jobStore?.complete, 'QUESTION_GENERATION_JOB_COMPLETE_REQUIRED').bind(jobStore);
    const fail = requireFunction(jobStore?.fail, 'QUESTION_GENERATION_JOB_FAIL_REQUIRED').bind(jobStore);
    const process = requireFunction(generationService?.process, 'QUESTION_GENERATION_SERVICE_REQUIRED').bind(generationService);
    const owner = requireWorkerId(workerId);
    const batchLimit = boundedLimit(limit);
    const claimed = await claim({ workerId: owner, limit: batchLimit });
    const jobs = (Array.isArray(claimed) ? claimed : []).slice(0, batchLimit);
    let completedCount = 0;
    let failedCount = 0;
    let abandonedCount = 0;
    let lostLeaseCount = 0;

    for (const job of jobs) {
        try {
            const result = await process(job);
            await complete(job, { workerId: owner, result });
            completedCount += 1;
        } catch (error) {
            try {
                await fail(job, error, { workerId: owner });
                failedCount += 1;
            } catch (transitionError) {
                if (transitionError?.code !== 'JOB_LEASE_NOT_OWNED_OR_STALE') {
                    throw transitionError;
                }
                abandonedCount += 1;
                lostLeaseCount += 1;
            }
        }
    }

    return {
        claimed: jobs.length,
        completed: completedCount,
        failed: failedCount,
        abandoned: abandonedCount,
        lostLease: lostLeaseCount,
    };
}

function createQuestionGenerationWorker({
    jobStore,
    generationService,
    workerId,
    batchSize = 5,
    pollIntervalMs = 5_000,
    runImmediately = true,
    onError = () => {},
    onSuccess = () => {},
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
} = {}) {
    requireFunction(jobStore?.claim, 'QUESTION_GENERATION_JOB_CLAIM_REQUIRED');
    requireFunction(jobStore?.complete, 'QUESTION_GENERATION_JOB_COMPLETE_REQUIRED');
    requireFunction(jobStore?.fail, 'QUESTION_GENERATION_JOB_FAIL_REQUIRED');
    requireFunction(generationService?.process, 'QUESTION_GENERATION_SERVICE_REQUIRED');
    const owner = requireWorkerId(workerId);
    const limit = boundedLimit(batchSize);
    const intervalMs = Math.max(1, Number(pollIntervalMs) || 5_000);
    const reportError = requireFunction(onError, 'QUESTION_GENERATION_WORKER_ERROR_HANDLER_REQUIRED');
    const reportSuccess = requireFunction(onSuccess, 'QUESTION_GENERATION_WORKER_SUCCESS_HANDLER_REQUIRED');
    const schedule = requireFunction(setIntervalFn, 'QUESTION_GENERATION_WORKER_TIMER_REQUIRED');
    const cancel = requireFunction(clearIntervalFn, 'QUESTION_GENERATION_WORKER_TIMER_CANCEL_REQUIRED');
    let timer = null;
    let inFlight = null;

    function trigger() {
        if (inFlight) return inFlight;
        inFlight = Promise.resolve()
            .then(() => runQuestionGenerationBatch({
                jobStore,
                generationService,
                workerId: owner,
                limit,
            }))
            .then(result => {
                try {
                    reportSuccess(result);
                } catch (_) {
                    // Health reporting must not turn a successful batch into a polling failure.
                }
                return result;
            })
            .catch(error => {
                try {
                    reportError(error);
                } catch (_) {
                    // Error reporting must not create an unhandled polling rejection.
                }
                return null;
            })
            .finally(() => {
                inFlight = null;
            });
        return inFlight;
    }

    return {
        start() {
            if (timer !== null) return false;
            timer = schedule(() => { trigger(); }, intervalMs);
            if (runImmediately) trigger();
            return true;
        },

        async stop() {
            if (timer !== null) {
                cancel(timer);
                timer = null;
            }
            if (inFlight) await inFlight;
        },

        runOnce: trigger,

        isRunning() {
            return timer !== null;
        },
    };
}

module.exports = {
    runQuestionGenerationBatch,
    createQuestionGenerationWorker,
};
