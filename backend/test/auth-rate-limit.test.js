const test = require('node:test');
const assert = require('node:assert/strict');

const {
    ACCOUNT_FAILURE_LIMIT,
    ACCOUNT_FAILURE_WINDOW_MS,
    IP_AUTH_ATTEMPT_LIMIT,
    REGISTRATION_IP_ATTEMPT_LIMIT,
    createAuthRateLimiter,
} = require('../auth-rate-limit');

function createClock(start = 0) {
    let now = start;
    return {
        now: () => now,
        advance(ms) { now += ms; },
    };
}

function authRequest(overrides = {}) {
    return {
        route: 'child-login',
        ip: '203.0.113.5',
        account: 'student',
        ...overrides,
    };
}

test('blocks the sixth failed credential attempt for the same route and account', () => {
    const clock = createClock();
    const limiter = createAuthRateLimiter({ now: clock.now });

    for (let attempt = 0; attempt < ACCOUNT_FAILURE_LIMIT; attempt += 1) {
        assert.equal(limiter.consume(authRequest()).allowed, true);
        limiter.recordFailure(authRequest());
    }

    const blocked = limiter.consume(authRequest());
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.reason, 'account_failures');
    assert.ok(blocked.retryAfterSeconds >= 1);
});

test('successful authentication clears only its own failed-account history', () => {
    const limiter = createAuthRateLimiter({ now: () => 0 });
    const student = authRequest();
    const otherStudent = authRequest({ account: 'other-student' });

    for (let attempt = 0; attempt < ACCOUNT_FAILURE_LIMIT - 1; attempt += 1) {
        limiter.consume(student);
        limiter.recordFailure(student);
        limiter.consume(otherStudent);
        limiter.recordFailure(otherStudent);
    }
    limiter.recordSuccess(student);

    assert.equal(limiter.consume(student).allowed, true);
    limiter.recordFailure(otherStudent);
    assert.equal(limiter.consume(otherStudent).allowed, false);
});

test('expires account failures after the configured window', () => {
    const clock = createClock();
    const limiter = createAuthRateLimiter({ now: clock.now });

    for (let attempt = 0; attempt < ACCOUNT_FAILURE_LIMIT; attempt += 1) {
        limiter.consume(authRequest());
        limiter.recordFailure(authRequest());
    }
    clock.advance(ACCOUNT_FAILURE_WINDOW_MS + 1);

    assert.equal(limiter.consume(authRequest()).allowed, true);
});

test('caps registrations by source IP even when account names differ', () => {
    const limiter = createAuthRateLimiter({ now: () => 0 });

    for (let attempt = 0; attempt < REGISTRATION_IP_ATTEMPT_LIMIT; attempt += 1) {
        assert.equal(limiter.consume(authRequest({ route: 'register', account: `student-${attempt}` })).allowed, true);
    }

    const blocked = limiter.consume(authRequest({ route: 'register', account: 'student-next' }));
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.reason, 'registration_ip');
});

test('caps all protected authentication attempts by source IP', () => {
    const limiter = createAuthRateLimiter({ now: () => 0 });

    for (let attempt = 0; attempt < IP_AUTH_ATTEMPT_LIMIT; attempt += 1) {
        assert.equal(limiter.consume(authRequest({ account: `student-${attempt}` })).allowed, true);
    }

    const blocked = limiter.consume(authRequest({ route: 'parent-login', account: 'student:parent' }));
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.reason, 'ip_attempts');
});

test('refuses unseen limiter keys at capacity without retaining the new key', () => {
    const limiter = createAuthRateLimiter({ now: () => 0, maxKeys: 2 });

    assert.equal(limiter.consume(authRequest()).allowed, true);
    const blocked = limiter.consume(authRequest({ ip: '203.0.113.6', account: 'other-student' }));

    assert.equal(blocked.allowed, false);
    assert.equal(blocked.reason, 'capacity');
    assert.deepEqual(limiter.getStats(), { keyCount: 2 });
});

test('successful logins do not exhaust a shared IP budget', () => {
    const limiter = createAuthRateLimiter({ now: () => 0 });
    for (let i = 0; i < IP_AUTH_ATTEMPT_LIMIT * 2; i++) {
        const request = authRequest({ account: `student-${i % 2}` });
        assert.equal(limiter.consume(request).allowed, true);
        limiter.recordSuccess(request);
    }
});

test('success refunds only its own attempt, preserving failures and pending requests', () => {
    const limiter = createAuthRateLimiter({ now: () => 0 });
    const success = authRequest({ account: 'valid-student' });
    assert.equal(limiter.consume(success).allowed, true);
    for (let i = 1; i < IP_AUTH_ATTEMPT_LIMIT; i++) {
        const request = authRequest({ account: `other-${i}` });
        assert.equal(limiter.consume(request).allowed, true);
        limiter.recordFailure(request);
    }
    limiter.recordSuccess(success);
    limiter.recordSuccess(success);
    assert.equal(limiter.consume(authRequest({ account: 'next' })).allowed, true);
    assert.equal(limiter.consume(authRequest({ account: 'blocked' })).allowed, false);
});

test('late success cannot refund a newer request after its own attempt expires', () => {
    const clock = createClock();
    const limiter = createAuthRateLimiter({ now: clock.now });
    const old = authRequest();
    limiter.consume(old);
    clock.advance(ACCOUNT_FAILURE_WINDOW_MS + 1);
    for (let i = 0; i < IP_AUTH_ATTEMPT_LIMIT; i++) {
        assert.equal(limiter.consume(authRequest({ account: `new-${i}` })).allowed, true);
    }
    limiter.recordSuccess(old);
    assert.equal(limiter.consume(authRequest({ account: 'blocked' })).allowed, false);
});
