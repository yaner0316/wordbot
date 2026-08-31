'use strict';

const ACCOUNT_FAILURE_LIMIT = 5;
const ACCOUNT_FAILURE_WINDOW_MS = 15 * 60_000;
const IP_AUTH_ATTEMPT_LIMIT = 20;
const IP_AUTH_ATTEMPT_WINDOW_MS = 15 * 60_000;
const REGISTRATION_IP_ATTEMPT_LIMIT = 5;
const REGISTRATION_IP_ATTEMPT_WINDOW_MS = 60 * 60_000;
const DEFAULT_MAX_KEYS = 10_000;

function normalizedPart(value, fallback) {
    const text = String(value || '').trim().toLowerCase();
    return text || fallback;
}

function retryAfterSeconds(timestamps, windowMs, now) {
    const oldest = timestamps[0];
    return Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
}

function createAuthRateLimiter({ now = () => Date.now(), maxKeys = DEFAULT_MAX_KEYS } = {}) {
    const entries = new Map();
    const limit = Math.max(1, Number(maxKeys) || DEFAULT_MAX_KEYS);

    function keyFor(request) {
        const route = normalizedPart(request?.route, 'unknown-route');
        const ip = normalizedPart(request?.ip, 'unknown-ip');
        const account = normalizedPart(request?.account, 'unknown-account');
        return {
            account: `account:${route}:${account}`,
            ip: `ip:${ip}`,
            registration: `registration:${ip}`,
            isRegistration: route === 'register',
        };
    }

    function trim(key, windowMs, currentNow) {
        const existing = entries.get(key);
        if (!existing) return [];
        if (existing.length === 0) return [];
        const active = existing.filter(timestamp => timestamp > currentNow - windowMs);
        if (active.length === 0) {
            entries.delete(key);
            return [];
        }
        entries.set(key, active);
        return active;
    }

    function cleanup(currentNow) {
        for (const [key] of entries) {
            const windowMs = key.startsWith('registration:')
                ? REGISTRATION_IP_ATTEMPT_WINDOW_MS
                : key.startsWith('ip:')
                    ? IP_AUTH_ATTEMPT_WINDOW_MS
                    : ACCOUNT_FAILURE_WINDOW_MS;
            trim(key, windowMs, currentNow);
        }
    }

    function hasCapacity(keys, currentNow) {
        cleanup(currentNow);
        const missing = keys.filter(key => !entries.has(key));
        return entries.size + new Set(missing).size <= limit;
    }

    function consume(request) {
        const currentNow = Number(now());
        const keys = keyFor(request);
        const accountFailures = trim(keys.account, ACCOUNT_FAILURE_WINDOW_MS, currentNow);
        if (accountFailures.length >= ACCOUNT_FAILURE_LIMIT) {
            return {
                allowed: false,
                reason: 'account_failures',
                retryAfterSeconds: retryAfterSeconds(accountFailures, ACCOUNT_FAILURE_WINDOW_MS, currentNow),
            };
        }
        const ipAttempts = trim(keys.ip, IP_AUTH_ATTEMPT_WINDOW_MS, currentNow);
        if (ipAttempts.length >= IP_AUTH_ATTEMPT_LIMIT) {
            return {
                allowed: false,
                reason: 'ip_attempts',
                retryAfterSeconds: retryAfterSeconds(ipAttempts, IP_AUTH_ATTEMPT_WINDOW_MS, currentNow),
            };
        }
        const registrationAttempts = keys.isRegistration
            ? trim(keys.registration, REGISTRATION_IP_ATTEMPT_WINDOW_MS, currentNow)
            : [];
        if (registrationAttempts.length >= REGISTRATION_IP_ATTEMPT_LIMIT) {
            return {
                allowed: false,
                reason: 'registration_ip',
                retryAfterSeconds: retryAfterSeconds(registrationAttempts, REGISTRATION_IP_ATTEMPT_WINDOW_MS, currentNow),
            };
        }
        const requiredKeys = [keys.account, keys.ip];
        if (keys.isRegistration) requiredKeys.push(keys.registration);
        if (!hasCapacity(requiredKeys, currentNow)) {
            return { allowed: false, reason: 'capacity', retryAfterSeconds: 1 };
        }
        if (!entries.has(keys.account)) entries.set(keys.account, []);
        entries.set(keys.ip, [...ipAttempts, currentNow]);
        if (keys.isRegistration) entries.set(keys.registration, [...registrationAttempts, currentNow]);
        return { allowed: true };
    }

    function recordFailure(request) {
        const currentNow = Number(now());
        const key = keyFor(request).account;
        const active = trim(key, ACCOUNT_FAILURE_WINDOW_MS, currentNow);
        if (!entries.has(key) && !hasCapacity([key], currentNow)) return;
        entries.set(key, [...active, currentNow]);
    }

    function recordSuccess(request) {
        entries.delete(keyFor(request).account);
    }

    return {
        consume,
        recordFailure,
        recordSuccess,
        getStats() {
            cleanup(Number(now()));
            return { keyCount: entries.size };
        },
    };
}

module.exports = {
    ACCOUNT_FAILURE_LIMIT,
    ACCOUNT_FAILURE_WINDOW_MS,
    IP_AUTH_ATTEMPT_LIMIT,
    REGISTRATION_IP_ATTEMPT_LIMIT,
    createAuthRateLimiter,
};
