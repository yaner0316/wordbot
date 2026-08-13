'use strict';

const HIGH_ATTEMPT_THRESHOLD = 10;
const AVAILABLE_CACHE_STATES = new Set(['active', 'reserved_next_day']);
const PROCESSING_JOB_STATES = new Set(['generating', 'validating', 'repairing']);
const FENCE_TIMESTAMP_PREFIX = '9999-12-31';

function text(value) {
    return String(value ?? '').trim();
}

function safeCode(value, fallback = 'unspecified') {
    const normalized = text(value);
    if (!normalized) return fallback;
    return /^[a-z0-9_.:-]{1,100}$/i.test(normalized) ? normalized : 'redacted';
}

function identityKey(userId, wordId) {
    return `${text(userId)}\u0000${text(wordId)}`;
}

function isValidQuizWord(value) {
    const normalized = text(value);
    return normalized.toLowerCase() !== 'genaine'
        && /^[a-z]+(?:[ '-][a-z]+)*$/i.test(normalized);
}

function isAvailableCache(row) {
    return text(row?.quality_status) === 'ready'
        && AVAILABLE_CACHE_STATES.has(text(row?.cache_state));
}

function isReadyPrimaryCache(row) {
    return isAvailableCache(row)
        && text(row?.round_type) === 'primary'
        && text(row?.question_type) === '1';
}

function cachePairState(rows) {
    const readyRows = (rows || []).filter(isReadyPrimaryCache);
    const active = readyRows.filter(row => text(row.cache_state) === 'active');
    const reserved = readyRows.filter(row => text(row.cache_state) === 'reserved_next_day');
    const reasons = [];
    if (active.length === 0) reasons.push('missing_active');
    if (reserved.length === 0) reasons.push('missing_reserved_next_day');
    if (active.length > 1) reasons.push('duplicate_active');
    if (reserved.length > 1) reasons.push('duplicate_reserved_next_day');
    return {
        complete: active.length === 1 && reserved.length === 1,
        reasons,
        cacheIds: readyRows.map(row => text(row.id)).filter(Boolean).sort(),
    };
}

function increment(record, key, amount = 1) {
    record[key] = (record[key] || 0) + amount;
}

function sortedCounts(record) {
    return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

function timestampMs(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
}

function emptyUserSummary() {
    return {
        unclaimablePending: 0,
        masteredAvailableCache: 0,
        readyJobIncompleteCache: 0,
        eligibleWords: 0,
        completeWords: 0,
        coverageGaps: 0,
        retryWait: 0,
        needsManualReview: 0,
        highAttempts: 0,
    };
}

function compareItemId(left, right) {
    const leftId = text(left.jobId || left.cacheId || left.wordId);
    const rightId = text(right.jobId || right.cacheId || right.wordId);
    return leftId.localeCompare(rightId);
}

function auditQuestionGenerationBacklog({
    users = [], words = [], cacheRows = [], jobs = [],
} = {}, { highAttemptThreshold = HIGH_ATTEMPT_THRESHOLD, now = new Date() } = {}) {
    const threshold = Math.max(1, Math.floor(Number(highAttemptThreshold) || HIGH_ATTEMPT_THRESHOLD));
    const nowMs = timestampMs(now);
    if (nowMs === null) throw new Error('QUESTION_GENERATION_BACKLOG_AUDIT_FAILED');
    const usernames = new Map(users.map(user => [text(user.id), text(user.username) || text(user.id)]));
    const wordsByKey = new Map();
    const cacheByKey = new Map();
    const byUser = {};

    function username(userId) {
        return usernames.get(text(userId)) || text(userId);
    }
    function userSummary(userId) {
        const name = username(userId);
        if (!byUser[name]) byUser[name] = emptyUserSummary();
        return byUser[name];
    }

    for (const user of users) userSummary(user.id);
    for (const word of words) {
        const key = identityKey(word.user_id, word.id);
        if (key !== '\u0000') wordsByKey.set(key, word);
        userSummary(word.user_id);
    }
    for (const row of cacheRows) {
        const key = identityKey(row.user_id, row.word_id);
        if (!cacheByKey.has(key)) cacheByKey.set(key, []);
        cacheByKey.get(key).push(row);
        userSummary(row.user_id);
    }
    for (const row of jobs) userSummary(row.user_id);

    const items = {
        unclaimablePending: [],
        masteredAvailableCache: [],
        readyJobIncompleteCache: [],
        coverageGaps: [],
        jobAttention: [],
        claimBlockers: [],
    };
    const unclaimableByReason = {};
    const attentionByReason = {};
    const attentionByErrorCode = {};
    let futurePending = 0;
    let fenceStuck = 0;
    let expiredProcessingLease = 0;

    for (const row of jobs) {
        const status = text(row.status);
        const word = wordsByKey.get(identityKey(row.user_id, row.word_id));
        const timingFlags = [];
        if (status === 'pending') {
            const nextAttemptMs = timestampMs(row.next_attempt_at);
            if (nextAttemptMs !== null && nextAttemptMs > nowMs) {
                timingFlags.push('future_pending');
                futurePending += 1;
                if (text(row.next_attempt_at).startsWith(FENCE_TIMESTAMP_PREFIX)) {
                    timingFlags.push('fence_stuck');
                    fenceStuck += 1;
                }
            }
        } else if (PROCESSING_JOB_STATES.has(status)) {
            const leaseExpiresMs = timestampMs(row.lease_expires_at);
            if (leaseExpiresMs === null || leaseExpiresMs <= nowMs) {
                timingFlags.push('expired_processing_lease');
                expiredProcessingLease += 1;
            }
        }
        if (timingFlags.length) {
            items.claimBlockers.push({
                user: username(row.user_id), userId: text(row.user_id), jobId: text(row.id),
                wordId: text(row.word_id), flags: timingFlags,
            });
        }
        if (status === 'pending') {
            const reasons = [];
            if (!word) {
                reasons.push('missing_word');
            } else {
                if (text(word.mastery_status) === 'mastered') reasons.push('mastered');
                if (Number(row.word_version) !== Number(word.question_generation_version)) reasons.push('version_mismatch');
                if (!isValidQuizWord(word.word)) reasons.push('invalid_word');
            }
            if (reasons.length) {
                const summary = userSummary(row.user_id);
                summary.unclaimablePending += 1;
                for (const reason of reasons) increment(unclaimableByReason, reason);
                items.unclaimablePending.push({
                    user: username(row.user_id), userId: text(row.user_id), jobId: text(row.id),
                    wordId: text(row.word_id), reasons,
                });
            }
        }

        if (status === 'ready') {
            const pair = cachePairState(cacheByKey.get(identityKey(row.user_id, row.word_id)) || []);
            if (!pair.complete) {
                userSummary(row.user_id).readyJobIncompleteCache += 1;
                items.readyJobIncompleteCache.push({
                    user: username(row.user_id), userId: text(row.user_id), jobId: text(row.id),
                    wordId: text(row.word_id), reasons: pair.reasons, cacheIds: pair.cacheIds,
                });
            }
        }

        const attemptCount = Math.max(0, Number(row.attempt_count) || 0);
        const flags = [];
        if (status === 'retry_wait') flags.push('retry_wait');
        if (status === 'needs_manual_review') flags.push('needs_manual_review');
        if (attemptCount >= threshold) flags.push('high_attempts');
        if (flags.length) {
            const summary = userSummary(row.user_id);
            const reason = safeCode(row.reason);
            const errorCode = text(row.last_error_code) ? safeCode(row.last_error_code) : null;
            if (flags.includes('retry_wait')) summary.retryWait += 1;
            if (flags.includes('needs_manual_review')) summary.needsManualReview += 1;
            if (flags.includes('high_attempts')) summary.highAttempts += 1;
            increment(attentionByReason, reason);
            if (errorCode) increment(attentionByErrorCode, errorCode);
            items.jobAttention.push({
                user: username(row.user_id), userId: text(row.user_id), jobId: text(row.id),
                wordId: text(row.word_id), status, attemptCount, reason,
                errorCode, flags,
            });
        }
    }

    for (const row of cacheRows) {
        const word = wordsByKey.get(identityKey(row.user_id, row.word_id));
        if (word && text(word.mastery_status) === 'mastered' && isAvailableCache(row)) {
            userSummary(row.user_id).masteredAvailableCache += 1;
            items.masteredAvailableCache.push({
                user: username(row.user_id), userId: text(row.user_id), cacheId: text(row.id),
                wordId: text(row.word_id), reason: 'mastered_word',
            });
        }
    }

    let eligibleWords = 0;
    let completeWords = 0;
    for (const word of words) {
        if (text(word.mastery_status) === 'mastered' || !isValidQuizWord(word.word)) continue;
        eligibleWords += 1;
        const summary = userSummary(word.user_id);
        summary.eligibleWords += 1;
        const pair = cachePairState(cacheByKey.get(identityKey(word.user_id, word.id)) || []);
        if (pair.complete) {
            completeWords += 1;
            summary.completeWords += 1;
        } else {
            summary.coverageGaps += 1;
            items.coverageGaps.push({
                user: username(word.user_id), userId: text(word.user_id), wordId: text(word.id),
                reasons: pair.reasons, cacheIds: pair.cacheIds,
            });
        }
    }

    for (const list of Object.values(items)) list.sort(compareItemId);
    const orderedByUser = Object.fromEntries(Object.entries(byUser).sort(([left], [right]) => left.localeCompare(right)));
    return {
        summary: {
            scanned: { users: users.length, words: words.length, cacheRows: cacheRows.length, jobs: jobs.length },
            unclaimablePending: {
                count: items.unclaimablePending.length,
                byReason: sortedCounts(unclaimableByReason),
            },
            masteredAvailableCache: items.masteredAvailableCache.length,
            readyJobIncompleteCache: items.readyJobIncompleteCache.length,
            coverage: {
                eligibleWords,
                completeWords,
                gapCount: eligibleWords - completeWords,
            },
            jobAttention: {
                retryWait: jobs.filter(row => text(row.status) === 'retry_wait').length,
                needsManualReview: jobs.filter(row => text(row.status) === 'needs_manual_review').length,
                highAttempts: jobs.filter(row => (Number(row.attempt_count) || 0) >= threshold).length,
                highAttemptThreshold: threshold,
                byReason: sortedCounts(attentionByReason),
                byErrorCode: sortedCounts(attentionByErrorCode),
            },
            claimBlockers: {
                futurePending,
                fenceStuck,
                expiredProcessingLease,
            },
        },
        byUser: orderedByUser,
        items,
    };
}

module.exports = {
    HIGH_ATTEMPT_THRESHOLD,
    auditQuestionGenerationBacklog,
    cachePairState,
    isValidQuizWord,
    safeCode,
};
