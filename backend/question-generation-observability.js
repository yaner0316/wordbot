'use strict';

const FORMAL_QUIZ_READY_COUNT = 10;
const OLDEST_PENDING_ALERT_AFTER_MS = 30 * 60_000;
const PENDING_STATUSES = new Set(['pending']);
const RUNNING_STATUSES = new Set(['generating', 'validating', 'repairing']);
const RETRYING_STATUSES = new Set(['retry_wait']);
const FAILED_STATUSES = new Set(['needs_manual_review']);

function toTimestamp(value) {
    const timestamp = Date.parse(String(value || ''));
    return Number.isFinite(timestamp) ? timestamp : null;
}

function safeQuestionGenerationErrorCode(value) {
    const code = String(value || '').trim();
    if (!code) return null;
    return /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : 'QUESTION_GENERATION_FAILED';
}

function summarizeQuestionGenerationQueue(rows, { now = new Date().toISOString() } = {}) {
    const nowMs = toTimestamp(now);
    const counts = { pending: 0, running: 0, retrying: 0, failed: 0 };
    let oldestPendingAt = null;
    let lastErrorCode = null;

    for (const row of rows || []) {
        const status = String(row?.status || '').trim();
        if (PENDING_STATUSES.has(status)) {
            counts.pending += 1;
            const createdAt = toTimestamp(row?.created_at);
            if (createdAt !== null && (oldestPendingAt === null || createdAt < oldestPendingAt)) oldestPendingAt = createdAt;
        } else if (RUNNING_STATUSES.has(status)) {
            counts.running += 1;
        } else if (RETRYING_STATUSES.has(status)) {
            counts.retrying += 1;
        } else if (FAILED_STATUSES.has(status)) {
            counts.failed += 1;
        }

        const code = safeQuestionGenerationErrorCode(row?.last_error_code);
        if (code) lastErrorCode = code;
    }

    const oldestPendingAgeMs = oldestPendingAt !== null && nowMs !== null
        ? Math.max(0, nowMs - oldestPendingAt)
        : null;
    return {
        counts,
        oldestPendingAgeMs,
        lastErrorCode,
        alerts: {
            oldestPendingOverThreshold: oldestPendingAgeMs !== null
                && oldestPendingAgeMs >= OLDEST_PENDING_ALERT_AFTER_MS,
        },
    };
}

function getReadinessStatus({ readyCount, queue }) {
    if (readyCount >= FORMAL_QUIZ_READY_COUNT) return 'ready';
    if (queue.failedCount > 0) return 'needs_attention';
    if (queue.retryingCount > 0) return 'waiting_retry';
    if (queue.pendingCount > 0 || queue.runningCount > 0) return 'building';
    return 'empty';
}

function summarizeUserQuestionReadiness({ readyCount = 0, jobs = [], now } = {}) {
    const summary = summarizeQuestionGenerationQueue(jobs, { now });
    const queue = {
        pendingCount: summary.counts.pending,
        runningCount: summary.counts.running,
        retryingCount: summary.counts.retrying,
        failedCount: summary.counts.failed,
        oldestPendingAgeMs: summary.oldestPendingAgeMs,
        lastErrorCode: summary.lastErrorCode,
    };
    const ready = Math.max(0, Number(readyCount) || 0);
    return {
        canStartFormalQuiz: ready >= FORMAL_QUIZ_READY_COUNT,
        status: getReadinessStatus({ readyCount: ready, queue }),
        queue,
        alerts: {
            belowReadyThreshold: ready < FORMAL_QUIZ_READY_COUNT,
            oldestPendingOverThreshold: summary.alerts.oldestPendingOverThreshold,
        },
    };
}

module.exports = {
    FORMAL_QUIZ_READY_COUNT,
    OLDEST_PENDING_ALERT_AFTER_MS,
    safeQuestionGenerationErrorCode,
    summarizeQuestionGenerationQueue,
    summarizeUserQuestionReadiness,
};
