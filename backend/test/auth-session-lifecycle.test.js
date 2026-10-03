const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthService } = require('../auth-service');
const { createApp } = require('../http-app');
const { requireUserSession, requireParentSession, setSessionCookie, sessionStore } = require('../auth-middleware');

function fixture() {
    const records = [];
    const auth = createAuthService({
        listAccountRecords: async () => records,
        addAccountRecord: async fields => records.push({ record_id: String(records.length + 1), fields }),
        updateAccountRecord: async (id, fields) => Object.assign(records.find(row => row.record_id === id).fields, fields),
    });
    const app = createApp({
        submitAnswers: async () => ({}),
        registerUser: auth.register,
        loginUser: auth.login,
        verifyParentLogin: auth.verifyParentLogin,
        getParentCredentialStatus: auth.getParentCredentialStatus,
        setParentCredentials: auth.setParentCredentials,
        requireUserSession,
        onUserLogin: ({ res, result }) => setSessionCookie(res, result, 'user'),
        onParentLogin: ({ res, result }) => setSessionCookie(res, result, 'parent'),
        getActiveFormalQuizChallenge: async () => null,
    });
    app.post('/parent-mutation', requireParentSession, (req, res) => res.json({ ok: true }));
    return { app, auth, records };
}

async function withServer(app, run) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try { await run(`http://127.0.0.1:${server.address().port}`); }
    finally { await new Promise(resolve => server.close(resolve)); }
}

function post(baseUrl, path, body, cookie) {
    return fetch(baseUrl + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
    });
}

function cookieOf(response) { return response.headers.get('set-cookie')?.split(';')[0]; }

test('successful registration creates the child session used immediately by learning requests', async () => {
    const { app } = fixture();
    await withServer(app, async baseUrl => {
        const response = await post(baseUrl, '/api/auth/register', { username: 'NewKid', password: 'kidpass' });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { user: 'NewKid' });
        const cookie = cookieOf(response);
        assert.ok(cookie, 'registration must return a session cookie');
        assert.equal(sessionStore.read({ get: () => cookie }).role, 'user');
        const learning = await fetch(baseUrl + '/api/quiz/session?user=newkid', { headers: { cookie } });
        assert.equal(learning.status, 200);
        assert.deepEqual(await learning.json(), { active: false });
        const mutation = await post(baseUrl, '/parent-mutation', { user: 'newkid' }, cookie);
        assert.equal(mutation.status, 403);
    });
});

test('failed registration never issues a session and child login retains its existing cookie behavior', async () => {
    const { app, auth } = fixture();
    await auth.register({ username: 'kid', password: 'kidpass' });
    await withServer(app, async baseUrl => {
        for (const body of [{ username: 'kid', password: 'otherpass' }, { username: 'newkid', password: 'x' }]) {
            const rejected = await post(baseUrl, '/api/auth/register', body);
            assert.equal(rejected.status, 400);
            assert.equal(rejected.headers.get('set-cookie'), null);
        }
        const loggedIn = await post(baseUrl, '/api/auth/login', { username: 'kid', password: 'kidpass' });
        assert.equal(loggedIn.status, 200);
        assert.equal(sessionStore.read({ get: () => cookieOf(loggedIn) }).role, 'user');
    });
});

test('parent status and setup are session scoped while replacement still requires existing parent credentials', async () => {
    const { app, auth } = fixture();
    await auth.register({ username: 'kid', password: 'kidpass' });
    await auth.register({ username: 'other', password: 'otherpass' });
    const cookie = sessionStore.cookie(sessionStore.issue('kid', 'user'));
    const body = { user: 'kid', childPassword: 'kidpass', parentUsername: 'adult', parentPassword: 'parentpass' };
    await withServer(app, async baseUrl => {
        const missingStatus = await fetch(baseUrl + '/api/auth/parent/status?user=kid');
        assert.equal(missingStatus.status, 401);
        const missingSetup = await post(baseUrl, '/api/auth/parent/setup', body);
        assert.equal(missingSetup.status, 401);
        const initial = await fetch(baseUrl + '/api/auth/parent/status?user=kid', { headers: { cookie } });
        assert.equal(initial.status, 200);
        assert.deepEqual(await initial.json(), { hasParentCredentials: false });
        const otherStatus = await fetch(baseUrl + '/api/auth/parent/status?user=other', { headers: { cookie } });
        assert.equal(otherStatus.status, 403);
        const otherSetup = await post(baseUrl, '/api/auth/parent/setup', { ...body, user: 'other', childPassword: 'otherpass' }, cookie);
        assert.equal(otherSetup.status, 403);
        const wrongPassword = await post(baseUrl, '/api/auth/parent/setup', { ...body, childPassword: 'wrongpass' }, cookie);
        assert.equal(wrongPassword.status, 400);
        const setup = await post(baseUrl, '/api/auth/parent/setup', body, cookie);
        assert.equal(setup.status, 200);
        assert.equal(setup.headers.get('set-cookie'), null, 'setup must not elevate the child session');
        const configured = await fetch(baseUrl + '/api/auth/parent/status', { headers: { cookie } });
        assert.deepEqual(await configured.json(), { hasParentCredentials: true });
        const rejectedReplacement = await post(baseUrl, '/api/auth/parent/setup', { ...body, parentPassword: 'newpass' }, cookie);
        assert.equal(rejectedReplacement.status, 400);
        await auth.verifyParentLogin({ user: 'kid', parentUsername: 'adult', password: 'parentpass' });
        const replacement = await post(baseUrl, '/api/auth/parent/setup', {
            ...body, parentPassword: 'newpass', currentParentUsername: 'adult', currentParentPassword: 'parentpass',
        }, cookie);
        assert.equal(replacement.status, 200);
        await auth.verifyParentLogin({ user: 'kid', parentUsername: 'adult', password: 'newpass' });
    });
});

test('parent logout downgrades the same authenticated user and the new cookie cannot perform parent mutations', async () => {
    const { app, auth } = fixture();
    await auth.register({ username: 'kid', password: 'kidpass' });
    await auth.setParentCredentials({ user: 'kid', childPassword: 'kidpass', parentUsername: 'adult', parentPassword: 'parentpass' });
    await withServer(app, async baseUrl => {
        const unauthenticated = await post(baseUrl, '/api/auth/parent/logout', {});
        assert.equal(unauthenticated.status, 401);
        const login = await post(baseUrl, '/api/auth/parent/login', { user: 'kid', parentUsername: 'adult', password: 'parentpass' });
        const parentCookie = cookieOf(login);
        assert.equal((await post(baseUrl, '/parent-mutation', { user: 'kid' }, parentCookie)).status, 200);
        const wrongTarget = await post(baseUrl, '/api/auth/parent/logout', { user: 'other' }, parentCookie);
        assert.equal(wrongTarget.status, 403);
        const logout = await post(baseUrl, '/api/auth/parent/logout', {}, parentCookie);
        assert.equal(logout.status, 200);
        assert.deepEqual(await logout.json(), { ok: true, user: 'kid' });
        const childCookie = cookieOf(logout);
        const session = sessionStore.read({ get: () => childCookie });
        assert.equal(session.user, 'kid');
        assert.equal(session.role, 'user');
        assert.equal((await post(baseUrl, '/parent-mutation', { user: 'kid' }, childCookie)).status, 403);
        assert.equal((await fetch(baseUrl + '/api/quiz/session?user=kid', { headers: { cookie: childCookie } })).status, 200);
    });
});
