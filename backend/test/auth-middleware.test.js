const test = require('node:test');
const assert = require('node:assert');
const {
    requireAdminToken,
    requireUserSession,
    setSessionCookie,
    sessionStore,
} = require('../auth-middleware');

// Mock Express request/response
function createMockReq({ path = '/', method = 'GET', headers = {}, body = {}, query = {}, params = {} } = {}) {
    return {
        path,
        method,
        get: (key) => headers[key.toLowerCase()],
        body,
        query,
        params,
    };
}

function createMockRes() {
    const res = {
        statusCode: 200,
        headers: {},
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(data) {
            this.body = data;
            return this;
        },
        setHeader(key, value) {
            this.headers[key] = value;
        },
    };
    return res;
}

function setTestEnv(t, patch) {
    const previous = Object.fromEntries(Object.keys(patch).map(key => [key, process.env[key]]));
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    t.after(() => {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });
}

test('requireAdminToken: rejects a missing token whenever the middleware is invoked', t => {
    setTestEnv(t, { WORDBOT_ADMIN_TOKEN: 'valid-token' });

    const req = createMockReq({ path: '/users' });
    const res = createMockRes();
    let nextCalled = false;
    
    requireAdminToken(req, res, () => { nextCalled = true; });
    
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.body.code, 'UNAUTHORIZED');

});

test('requireAdminToken: rejects missing configured token regardless of NODE_ENV', t => {
    setTestEnv(t, { NODE_ENV: undefined, WORDBOT_ADMIN_TOKEN: undefined });
    
    const req = createMockReq({ path: '/api/admin/backfill' });
    const res = createMockRes();
    let nextCalled = false;
    
    requireAdminToken(req, res, () => { nextCalled = true; });
    
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 503);
    assert.strictEqual(res.body.code, 'ADMIN_TOKEN_NOT_CONFIGURED');
    
});

test('requireAdminToken: rejects invalid token', t => {
    setTestEnv(t, { WORDBOT_ADMIN_TOKEN: 'valid-token' });
    
    const req = createMockReq({ 
        path: '/api/admin/backfill',
        headers: { 'x-wordbot-admin-token': 'invalid-token' }
    });
    const res = createMockRes();
    let nextCalled = false;
    
    requireAdminToken(req, res, () => { nextCalled = true; });
    
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.body.code, 'UNAUTHORIZED');
    
});

test('requireAdminToken: allows valid token', t => {
    setTestEnv(t, { WORDBOT_ADMIN_TOKEN: 'valid-token' });
    
    const req = createMockReq({ 
        path: '/api/admin/backfill',
        headers: { 'x-wordbot-admin-token': 'valid-token' }
    });
    const res = createMockRes();
    let nextCalled = false;
    
    requireAdminToken(req, res, () => { nextCalled = true; });
    
    assert.strictEqual(nextCalled, true);
    assert.strictEqual(res.statusCode, 200);
    
});

test('requireUserSession: fails closed when NODE_ENV is missing', t => {
    setTestEnv(t, { NODE_ENV: undefined });
    
    const req = createMockReq({ path: '/api/quiz' });
    const res = createMockRes();
    let nextCalled = false;
    
    requireUserSession(req, res, () => { nextCalled = true; });
    
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.body.code, 'UNAUTHORIZED');
    
});

test('requireUserSession: rejects missing session in production', t => {
    setTestEnv(t, { NODE_ENV: 'production' });
    
    const req = createMockReq({ path: '/api/quiz' });
    const res = createMockRes();
    let nextCalled = false;
    
    requireUserSession(req, res, () => { nextCalled = true; });
    
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.body.code, 'UNAUTHORIZED');

});

test('requireUserSession: rejects invalid session in production', t => {
    setTestEnv(t, { NODE_ENV: 'production' });

    const req = createMockReq({
        path: '/api/quiz',
        headers: { cookie: 'wordbot_session=invalid-session' },
    });
    const res = createMockRes();
    let nextCalled = false;

    requireUserSession(req, res, () => { nextCalled = true; });

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.body.code, 'UNAUTHORIZED');
    
});

test('requireUserSession: rejects mismatched user', t => {
    setTestEnv(t, { NODE_ENV: 'production' });
    
    // Create a session for user1
    const token = sessionStore.issue('user1', 'user');
    
    const req = createMockReq({ 
        path: '/api/quiz',
        headers: { cookie: `wordbot_session=${token}` },
        query: { user: 'user2' }
    });
    const res = createMockRes();
    let nextCalled = false;
    
    requireUserSession(req, res, () => { nextCalled = true; });
    
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.code, 'FORBIDDEN');
    
});

test('requireUserSession: rejects cross-user targets from body, query, and params', async (t) => {
    setTestEnv(t, { NODE_ENV: 'production' });

    const token = sessionStore.issue('user1', 'user');
    const targetLocations = ['body', 'query', 'params'];
    const targetKeys = ['user', 'userId', 'targetUser', 'owner'];

    for (const location of targetLocations) {
        for (const key of targetKeys) {
            await t.test(`${location}.${key}`, () => {
                const req = createMockReq({
                    path: '/api/quiz',
                    headers: { cookie: `wordbot_session=${token}` },
                    [location]: { [key]: 'user2' },
                });
                const res = createMockRes();
                let nextCalled = false;

                requireUserSession(req, res, () => { nextCalled = true; });

                assert.strictEqual(nextCalled, false);
                assert.strictEqual(res.statusCode, 403);
                assert.strictEqual(res.body.code, 'FORBIDDEN');
            });
        }
    }
});

test('requireUserSession: allows matching user', t => {
    setTestEnv(t, { NODE_ENV: 'production' });
    
    // Create a session for user1
    const token = sessionStore.issue('user1', 'user');
    
    const req = createMockReq({ 
        path: '/api/quiz',
        headers: { cookie: `wordbot_session=${token}` },
        query: { user: 'user1' }
    });
    const res = createMockRes();
    let nextCalled = false;
    
    requireUserSession(req, res, () => { nextCalled = true; });
    
    assert.strictEqual(nextCalled, true);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(req.wordbotSession);
    assert.strictEqual(req.wordbotSession.user, 'user1');
    
});

test('setSessionCookie: sets cross-site production cookie attributes', t => {
    setTestEnv(t, { NODE_ENV: 'production' });
    const res = createMockRes();
    const result = { user: 'testuser' };
    
    setSessionCookie(res, result, 'user');
    
    assert.ok(res.headers['Set-Cookie']);
    const cookie = res.headers['Set-Cookie'];
    assert.ok(cookie.includes('wordbot_session='));
    assert.ok(cookie.includes('Path=/'));
    assert.ok(cookie.includes('HttpOnly'));
    assert.ok(cookie.includes('SameSite=None'));
    assert.ok(cookie.includes('Secure'));
    assert.ok(cookie.includes('Partitioned'));
});
