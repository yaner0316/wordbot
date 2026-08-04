const test = require('node:test');
const assert = require('node:assert');
const {
    requireAdminToken,
    requireUserSession,
    setSessionCookie,
    sessionStore,
    ADMIN_TOKEN_PROTECTED_PATHS,
    USER_SESSION_PROTECTED_PATHS,
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

test('ADMIN_TOKEN_PROTECTED_PATHS contains expected paths', () => {
    assert.ok(ADMIN_TOKEN_PROTECTED_PATHS.has('/api/admin/backfill'));
    assert.ok(ADMIN_TOKEN_PROTECTED_PATHS.has('/api/admin/cache/rebuild'));
    assert.ok(ADMIN_TOKEN_PROTECTED_PATHS.has('/api/admin/cache/status'));
});

test('USER_SESSION_PROTECTED_PATHS contains expected paths', () => {
    assert.ok(USER_SESSION_PROTECTED_PATHS.has('/api/quiz'));
    assert.ok(USER_SESSION_PROTECTED_PATHS.has('/api/submit'));
    assert.ok(USER_SESSION_PROTECTED_PATHS.has('/api/stats'));
    assert.ok(USER_SESSION_PROTECTED_PATHS.has('/api/history'));
    assert.ok(USER_SESSION_PROTECTED_PATHS.has('/api/word'));
    assert.ok(USER_SESSION_PROTECTED_PATHS.has('/api/reviews'));
});

test('requireAdminToken: allows unprotected paths', () => {
    const req = createMockReq({ path: '/api/public' });
    const res = createMockRes();
    let nextCalled = false;
    
    requireAdminToken(req, res, () => { nextCalled = true; });
    
    assert.strictEqual(nextCalled, true);
    assert.strictEqual(res.statusCode, 200);
});

test('requireAdminToken: rejects missing token in production', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalToken = process.env.WORDBOT_ADMIN_TOKEN;
    
    process.env.NODE_ENV = 'production';
    delete process.env.WORDBOT_ADMIN_TOKEN;
    
    const req = createMockReq({ path: '/api/admin/backfill' });
    const res = createMockRes();
    let nextCalled = false;
    
    requireAdminToken(req, res, () => { nextCalled = true; });
    
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 503);
    assert.strictEqual(res.body.code, 'ADMIN_TOKEN_NOT_CONFIGURED');
    
    process.env.NODE_ENV = originalEnv;
    process.env.WORDBOT_ADMIN_TOKEN = originalToken;
});

test('requireAdminToken: rejects invalid token', () => {
    const originalToken = process.env.WORDBOT_ADMIN_TOKEN;
    process.env.WORDBOT_ADMIN_TOKEN = 'valid-token';
    
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
    
    process.env.WORDBOT_ADMIN_TOKEN = originalToken;
});

test('requireAdminToken: allows valid token', () => {
    const originalToken = process.env.WORDBOT_ADMIN_TOKEN;
    process.env.WORDBOT_ADMIN_TOKEN = 'valid-token';
    
    const req = createMockReq({ 
        path: '/api/admin/backfill',
        headers: { 'x-wordbot-admin-token': 'valid-token' }
    });
    const res = createMockRes();
    let nextCalled = false;
    
    requireAdminToken(req, res, () => { nextCalled = true; });
    
    assert.strictEqual(nextCalled, true);
    assert.strictEqual(res.statusCode, 200);
    
    process.env.WORDBOT_ADMIN_TOKEN = originalToken;
});

test('requireUserSession: allows non-production', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    
    const req = createMockReq({ path: '/api/quiz' });
    const res = createMockRes();
    let nextCalled = false;
    
    requireUserSession(req, res, () => { nextCalled = true; });
    
    assert.strictEqual(nextCalled, true);
    assert.strictEqual(res.statusCode, 200);
    
    process.env.NODE_ENV = originalEnv;
});

test('requireUserSession: allows missing session in production', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    
    const req = createMockReq({ path: '/api/quiz' });
    const res = createMockRes();
    let nextCalled = false;
    
    requireUserSession(req, res, () => { nextCalled = true; });
    
    assert.strictEqual(nextCalled, true);
    assert.strictEqual(res.statusCode, 200);
    
    process.env.NODE_ENV = originalEnv;
});

test('requireUserSession: rejects mismatched user', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    
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
    
    process.env.NODE_ENV = originalEnv;
});

test('requireUserSession: allows matching user', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    
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
    
    process.env.NODE_ENV = originalEnv;
});

test('setSessionCookie: sets cookie with correct attributes', () => {
    const res = createMockRes();
    const result = { user: 'testuser' };
    
    setSessionCookie(res, result, 'user');
    
    assert.ok(res.headers['Set-Cookie']);
    const cookie = res.headers['Set-Cookie'];
    assert.ok(cookie.includes('wordbot_session='));
    assert.ok(cookie.includes('Path=/'));
    assert.ok(cookie.includes('HttpOnly'));
    assert.ok(cookie.includes('SameSite=Lax'));
});
