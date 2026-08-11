const test = require('node:test');
const assert = require('node:assert/strict');

const { createSessionStore } = require('../session-auth');

test('signed session can be read by a separate store instance', () => {
    const first = createSessionStore({ secret: 'test-shared-secret', ttlMs: 60_000 });
    const second = createSessionStore({ secret: 'test-shared-secret', ttlMs: 60_000 });
    const token = first.issue('qiuqiu', 'user');
    const req = { get: () => `wordbot_session=${token}` };

    const session = second.read(req);
    assert.equal(session.user, 'qiuqiu');
    assert.equal(session.role, 'user');
    assert.equal(typeof session.expiresAt, 'number');
});

test('signed session rejects a token modified after issuance', () => {
    const store = createSessionStore({ secret: 'test-shared-secret', ttlMs: 60_000 });
    const token = store.issue('qiuqiu', 'user');
    const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;

    assert.equal(store.read({ get: () => `wordbot_session=${tampered}` }), null);
});

test('signed session rejects an expired token', () => {
    const store = createSessionStore({ secret: 'test-shared-secret', ttlMs: 1 });
    const token = store.issue('qiuqiu', 'user');

    return new Promise(resolve => setTimeout(() => {
        assert.equal(store.read({ get: () => `wordbot_session=${token}` }), null);
        resolve();
    }, 5));
});
