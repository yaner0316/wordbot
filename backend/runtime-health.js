const SUPABASE_REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const REQUIRED_ENV = SUPABASE_REQUIRED_ENV;

const DEFAULT_WORKER_STALL_AFTER_MS = 15 * 60_000;

function validTimestamp(value) {
    const timestamp = Date.parse(String(value || ''));
    return Number.isFinite(timestamp) ? timestamp : null;
}

function elapsedBeyond(now, value, thresholdMs) {
    const nowMs = validTimestamp(now);
    const valueMs = validTimestamp(value);
    return nowMs !== null && valueMs !== null && nowMs - valueMs > thresholdMs;
}

function latestTimestamp(...values) {
    return values.reduce((latest, value) => {
        const currentMs = validTimestamp(value);
        const latestMs = validTimestamp(latest);
        if (currentMs === null) return latest;
        return latestMs === null || currentMs > latestMs ? value : latest;
    }, null);
}

function normalizeEligibleDueCount(value) {
    if (value === 'unknown' || value === undefined || value === null) return 'unknown';
    const count = Number(value);
    return Number.isFinite(count) && count >= 0 ? Math.floor(count) : 'unknown';
}

function getQuestionGenerationWorkerHealth({
    configured = false,
    running = false,
    lastError = '',
    startedAt = null,
    lastAttemptAt = null,
    lastClaimAt = null,
    lastSuccessAt = null,
    lastCompletionAt = null,
    eligibleDueCount = 'unknown',
    now = new Date().toISOString(),
    stallAfterMs = DEFAULT_WORKER_STALL_AFTER_MS,
} = {}) {
    const dueCount = normalizeEligibleDueCount(eligibleDueCount);
    const thresholdMs = Math.max(1, Number(stallAfterMs) || DEFAULT_WORKER_STALL_AFTER_MS);
    const neverSucceeded = !lastSuccessAt;
    const pollingAnchor = lastAttemptAt || startedAt;
    const progressAnchor = latestTimestamp(lastCompletionAt, lastClaimAt, startedAt);
    const pollingStalled = Boolean(configured && running && pollingAnchor)
        && elapsedBeyond(now, pollingAnchor, thresholdMs);
    const backlogStalled = typeof dueCount === 'number' && dueCount > 0
        && Boolean(progressAnchor)
        && elapsedBeyond(now, progressAnchor, thresholdMs);
    const stalled = pollingStalled || backlogStalled;

    let status = 'healthy';
    if (!configured) status = 'disabled';
    else if (!running) status = 'stopped';
    else if (lastError) status = 'error';
    else if (stalled) status = 'stalled';
    else if (dueCount === 0) status = 'idle';
    else if (neverSucceeded) status = 'never_succeeded';

    return {
        ok: !configured || (running && !lastError && !stalled),
        configured: Boolean(configured),
        running: Boolean(running),
        status,
        stalled,
        neverSucceeded,
        eligibleDueCount: dueCount,
        startedAt: startedAt || null,
        lastAttemptAt: lastAttemptAt || null,
        lastClaimAt: lastClaimAt || null,
        lastSuccessAt: lastSuccessAt || null,
        lastCompletionAt: lastCompletionAt || null,
        lastError: lastError || null,
    };
}

function getRuntimeHealth({
    env = process.env,
    version = '1.0.0',
    now = () => new Date().toISOString(),
} = {}) {
    const dataSource = 'supabase';
    const requiredEnv = SUPABASE_REQUIRED_ENV;
    const envStatus = Object.fromEntries(requiredEnv.map(name => [name, Boolean(env[name])]));
    const missing = requiredEnv.filter(name => !envStatus[name]);
    const questionCache = { configured: missing.length === 0, source: 'supabase' };
    const session = {
        sharedSecretConfigured: Boolean(env.WORDBOT_SESSION_SECRET || env.WORDBOT_ADMIN_TOKEN),
    };
    return {
        ok: missing.length === 0,
        service: 'wordbot-backend',
        version,
        time: now(),
        dataSource,
        env: envStatus,
        questionCache,
        session,
        missing,
    };
}

module.exports = {
    DEFAULT_WORKER_STALL_AFTER_MS,
    REQUIRED_ENV,
    SUPABASE_REQUIRED_ENV,
    getQuestionGenerationWorkerHealth,
    getRuntimeHealth,
};
