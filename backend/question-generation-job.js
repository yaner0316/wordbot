'use strict';

const { safeQuestionGenerationErrorCode } = require('./question-generation-observability');

const JOB_STATUS = Object.freeze({
    PENDING: 'pending',
    GENERATING: 'generating',
    VALIDATING: 'validating',
    REPAIRING: 'repairing',
    RETRY_WAIT: 'retry_wait',
    READY: 'ready',
    NEEDS_MANUAL_REVIEW: 'needs_manual_review',
});

function requireId(value, code) {
    const normalized = String(value || '').trim();
    if (!normalized) throw new Error(code);
    return normalized;
}

function toDate(value, code = 'INVALID_DATE') {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error(code);
    return date;
}

function toIso(value) {
    return toDate(value).toISOString();
}

function enqueueQuestionGeneration(existingJob, {
    userId,
    wordId,
    reason = 'word_entry',
    now = new Date(),
} = {}) {
    if (existingJob) return existingJob;
    const timestamp = toIso(now);
    return {
        user_id: requireId(userId, 'USER_ID_REQUIRED'),
        word_id: requireId(wordId, 'WORD_ID_REQUIRED'),
        status: JOB_STATUS.PENDING,
        reason: String(reason || 'word_entry'),
        attempt_count: 0,
        next_attempt_at: timestamp,
        lease_owner: null,
        lease_expires_at: null,
        last_error_code: null,
        last_error_detail: null,
        rejection_reasons: {},
    };
}

const DUE_STATUSES = Object.freeze([JOB_STATUS.PENDING, JOB_STATUS.RETRY_WAIT]);
const RECOVERABLE_STATUSES = Object.freeze([
    JOB_STATUS.GENERATING,
    JOB_STATUS.VALIDATING,
    JOB_STATUS.REPAIRING,
]);

function isAtOrBefore(value, boundary) {
    if (!value) return false;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) && timestamp <= boundary.getTime();
}

function isClaimable(job, now) {
    if (DUE_STATUSES.includes(job?.status)) {
        return isAtOrBefore(job.next_attempt_at, now);
    }
    if (RECOVERABLE_STATUSES.includes(job?.status)) {
        return !job.lease_expires_at || isAtOrBefore(job.lease_expires_at, now);
    }
    return false;
}

function claimQuestionGenerationJobs(jobs, {
    workerId,
    limit = 10,
    now = new Date(),
    leaseDurationMs = 60_000,
} = {}) {
    const owner = requireId(workerId, 'WORKER_ID_REQUIRED');
    const timestamp = toDate(now);
    const boundedLimit = Math.max(0, Math.floor(Number(limit) || 0));
    const leaseMs = Math.max(1, Number(leaseDurationMs) || 60_000);
    const leaseExpiresAt = new Date(timestamp.getTime() + leaseMs).toISOString();

    return (jobs || [])
        .filter(row => isClaimable(row, timestamp))
        .slice(0, boundedLimit)
        .map(row => ({
            ...row,
            status: JOB_STATUS.GENERATING,
            attempt_count: Math.max(0, Number(row.attempt_count) || 0) + 1,
            lease_owner: owner,
            lease_expires_at: leaseExpiresAt,
            updated_at: timestamp.toISOString(),
        }));
}

function requireOwnedInProgressJob(job, workerId) {
    const owner = requireId(workerId, 'WORKER_ID_REQUIRED');
    if (!RECOVERABLE_STATUSES.includes(job?.status)) throw new Error('JOB_NOT_IN_PROGRESS');
    if (String(job?.lease_owner || '') !== owner) throw new Error('JOB_LEASE_NOT_OWNED');
    return owner;
}

function completeQuestionGeneration(job, {
    workerId,
    now = new Date(),
} = {}) {
    requireOwnedInProgressJob(job, workerId);
    const timestamp = toIso(now);
    return {
        ...job,
        status: JOB_STATUS.READY,
        next_attempt_at: timestamp,
        lease_owner: null,
        lease_expires_at: null,
        last_error_code: null,
        last_error_detail: null,
        rejection_reasons: {},
        updated_at: timestamp,
    };
}

function errorDiagnostics(error) {
    const detail = String(error?.message || error || 'Question generation failed');
    return {
        code: String(error?.code || 'QUESTION_GENERATION_FAILED'),
        detail,
        rejectionReasons: error?.rejectionReasons && typeof error.rejectionReasons === 'object'
            ? { ...error.rejectionReasons }
            : {},
    };
}

function failQuestionGeneration(job, error, {
    workerId,
    now = new Date(),
    maxAttempts = 5,
    baseBackoffMs = 60_000,
    maxBackoffMs = 3_600_000,
} = {}) {
    requireOwnedInProgressJob(job, workerId);
    const timestamp = toDate(now);
    const attempts = Math.max(0, Number(job.attempt_count) || 0);
    const attemptsLimit = Math.max(1, Math.floor(Number(maxAttempts) || 5));
    const baseMs = Math.max(1, Number(baseBackoffMs) || 60_000);
    const maximumMs = Math.max(baseMs, Number(maxBackoffMs) || 3_600_000);
    const diagnostics = errorDiagnostics(error);
    const needsManualReview = attempts >= attemptsLimit;
    const backoffMs = Math.min(maximumMs, baseMs * (2 ** Math.max(0, attempts - 1)));

    return {
        ...job,
        status: needsManualReview ? JOB_STATUS.NEEDS_MANUAL_REVIEW : JOB_STATUS.RETRY_WAIT,
        next_attempt_at: needsManualReview
            ? timestamp.toISOString()
            : new Date(timestamp.getTime() + backoffMs).toISOString(),
        lease_owner: null,
        lease_expires_at: null,
        last_error_code: diagnostics.code,
        last_error_detail: diagnostics.detail,
        rejection_reasons: diagnostics.rejectionReasons,
        updated_at: timestamp.toISOString(),
    };
}

function createQuestionGenerationJobStore({
    insert,
    upsert,
    claimDue,
    updateClaimed,
    renewClaimed,
    now = () => new Date(),
    leaseDurationMs = 60_000,
    maxAttempts = 5,
    baseBackoffMs = 60_000,
    maxBackoffMs = 3_600_000,
} = {}) {
    const write = typeof upsert === 'function' ? upsert : insert;
    if (typeof write !== 'function') throw new Error('QUESTION_GENERATION_JOB_WRITER_REQUIRED');

    async function persistTransition(job, row, workerId) {
        if (typeof updateClaimed !== 'function') throw new Error('QUESTION_GENERATION_JOB_UPDATER_REQUIRED');
        const patch = { ...row };
        delete patch.id;
        delete patch.user_id;
        delete patch.word_id;
        const persisted = await updateClaimed({
            jobId: requireId(job?.id, 'JOB_ID_REQUIRED'),
            userId: requireId(job?.user_id, 'USER_ID_REQUIRED'),
            wordId: requireId(job?.word_id, 'WORD_ID_REQUIRED'),
            workerId: requireId(workerId, 'WORKER_ID_REQUIRED'),
            expectedStatuses: RECOVERABLE_STATUSES,
            expectedWordVersion: job?.word_version,
            leaseToken: job?.lease_token,
            patch,
            leaseValidAfter: row.updated_at,
            row,
        });
        return persisted && typeof persisted === 'object' ? persisted : row;
    }

    return {
        async enqueue({ userId, wordId, reason = 'word_entry' }) {
            const row = enqueueQuestionGeneration(null, { userId, wordId, reason, now: now() });
            const persisted = await write(row, { onConflict: 'word_id', ignoreDuplicates: true });
            return persisted && typeof persisted === 'object' ? persisted : row;
        },

        async claim({ workerId, limit = 10 } = {}) {
            if (typeof claimDue !== 'function') throw new Error('QUESTION_GENERATION_JOB_CLAIMER_REQUIRED');
            const owner = requireId(workerId, 'WORKER_ID_REQUIRED');
            const timestamp = toDate(now());
            const leaseMs = Math.max(1, Number(leaseDurationMs) || 60_000);
            const result = await claimDue({
                workerId: owner,
                limit: Math.max(0, Math.floor(Number(limit) || 0)),
                dueBefore: timestamp.toISOString(),
                expiredBefore: timestamp.toISOString(),
                leaseExpiresAt: new Date(timestamp.getTime() + leaseMs).toISOString(),
                claimedStatus: JOB_STATUS.GENERATING,
                incrementAttemptCount: true,
                dueStatuses: [...DUE_STATUSES],
                recoverableStatuses: [...RECOVERABLE_STATUSES],
            });
            if (Array.isArray(result)) return result;
            return Array.isArray(result?.rows) ? result.rows : [];
        },

        async renew(job, { workerId } = {}) {
            if (typeof renewClaimed !== 'function') throw new Error('QUESTION_GENERATION_JOB_RENEWER_REQUIRED');
            const owner = requireId(workerId, 'WORKER_ID_REQUIRED');
            const timestamp = toDate(now());
            const leaseMs = Math.max(1, Number(leaseDurationMs) || 60_000);
            const patch = {
                lease_expires_at: new Date(timestamp.getTime() + leaseMs).toISOString(),
                updated_at: timestamp.toISOString(),
            };
            const persisted = await renewClaimed({
                jobId: requireId(job?.id, 'JOB_ID_REQUIRED'),
                userId: requireId(job?.user_id, 'USER_ID_REQUIRED'),
                wordId: requireId(job?.word_id, 'WORD_ID_REQUIRED'),
                workerId: owner,
                expectedWordVersion: job?.word_version,
                leaseToken: job?.lease_token,
                expectedStatuses: [...RECOVERABLE_STATUSES],
                leaseValidAfter: timestamp.toISOString(),
                patch,
            });
            if (!persisted || typeof persisted !== 'object') {
                const error = new Error('Question generation job lease is no longer owned by this worker');
                error.code = 'JOB_LEASE_NOT_OWNED_OR_STALE';
                throw error;
            }
            return persisted;
        },

        async complete(job, { workerId } = {}) {
            const row = completeQuestionGeneration(job, { workerId, now: now() });
            return persistTransition(job, row, workerId);
        },

        async fail(job, error, { workerId } = {}) {
            const row = failQuestionGeneration(job, error, {
                workerId,
                now: now(),
                maxAttempts,
                baseBackoffMs,
                maxBackoffMs,
            });
            return persistTransition(job, row, workerId);
        },
    };
}

function summarizeQuestionGenerationJobs(rows) {
    const counts = { pending: 0, retrying: 0, manualReview: 0, ready: 0 };
    const failures = [];
    for (const row of rows || []) {
        const status = String(row?.status || '');
        if ([JOB_STATUS.PENDING, JOB_STATUS.GENERATING, JOB_STATUS.VALIDATING, JOB_STATUS.REPAIRING].includes(status)) counts.pending += 1;
        else if (status === JOB_STATUS.RETRY_WAIT) counts.retrying += 1;
        else if (status === JOB_STATUS.NEEDS_MANUAL_REVIEW) counts.manualReview += 1;
        else if (status === JOB_STATUS.READY) counts.ready += 1;
        if (status === JOB_STATUS.NEEDS_MANUAL_REVIEW) {
            failures.push({
                wordId: String(row.word_id || ''),
                status,
                attemptCount: Math.max(0, Number(row.attempt_count) || 0),
                lastErrorCode: safeQuestionGenerationErrorCode(row.last_error_code),
                nextAttemptAt: row.next_attempt_at || null,
            });
        }
    }
    return { counts, failures };
}

function hasRequiredReadyVariants(rows, wordId, requiredReadyCount = 2) {
    const targetWordId = requireId(wordId, 'WORD_ID_REQUIRED');
    const required = Math.max(2, Number(requiredReadyCount) || 2);
    const variants = (rows || [])
        .filter(row => String(row?.word_id || '') === targetWordId)
        .filter(row => String(row?.round_type || '') === 'primary')
        .filter(row => String(row?.quality_status || '') === 'ready')
        .map(row => ({
            fingerprint: String(row?.question_fingerprint || '').trim(),
            stem: String(row?.question_text || row?.questionText || '').trim().replace(/\s+/g, ' ').toLowerCase(),
        }))
        .filter(row => row.fingerprint && row.stem);
    const fingerprints = new Set(variants.map(row => row.fingerprint));
    const stems = new Set(variants.map(row => row.stem));
    return fingerprints.size >= required && stems.size >= required;
}

module.exports = {
    JOB_STATUS,
    DUE_STATUSES,
    RECOVERABLE_STATUSES,
    enqueueQuestionGeneration,
    claimQuestionGenerationJobs,
    completeQuestionGeneration,
    failQuestionGeneration,
    createQuestionGenerationJobStore,
    hasRequiredReadyVariants,
    summarizeQuestionGenerationJobs,
};
