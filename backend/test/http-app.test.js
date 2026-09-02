const test = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../http-app');
const { ACCOUNT_FAILURE_LIMIT, createAuthRateLimiter } = require('../auth-rate-limit');

async function withServer(app, run) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const { port } = server.address();
    try {
        await run(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

test('auth endpoints call the server-side account service', async () => {
    const calls = [];
    const app = createApp({
        submitAnswers: async () => ({}),
        registerUser: async input => { calls.push(['register', input]); return { user: input.username }; },
        loginUser: async input => { calls.push(['login', input]); return { user: input.username || input.identifier }; },
    });

    await withServer(app, async baseUrl => {
        const registerResponse = await fetch(baseUrl + '/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'Draggy', password: 'secret1' }),
        });
        const loginResponse = await fetch(baseUrl + '/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier: 'Draggy', password: 'secret1' }),
        });

        assert.equal(registerResponse.status, 200);
        assert.equal(loginResponse.status, 200);
        assert.deepEqual(calls, [
            ['register', { username: 'Draggy', password: 'secret1' }],
            ['login', { username: 'Draggy', password: 'secret1' }],
        ]);
    });
});

test('child login rate limit returns a generic 429 before the account adapter is called', async () => {
    const calls = [];
    const app = createApp({
        submitAnswers: async () => ({}),
        authRateLimiter: createAuthRateLimiter({ now: () => 0 }),
        loginUser: async input => {
            calls.push(input);
            throw new Error('username/password error');
        },
    });

    await withServer(app, async baseUrl => {
        for (let attempt = 0; attempt < ACCOUNT_FAILURE_LIMIT; attempt += 1) {
            const response = await fetch(`${baseUrl}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.20' },
                body: JSON.stringify({ username: 'student', password: 'wrong-password' }),
            });
            assert.equal(response.status, 400);
        }

        const blocked = await fetch(`${baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.20' },
            body: JSON.stringify({ username: 'student', password: 'wrong-password' }),
        });

        assert.equal(blocked.status, 429);
        assert.equal(blocked.headers.get('retry-after'), '900');
        assert.deepEqual(await blocked.json(), {
            error: 'Too many attempts. Try again later.',
            code: 'AUTH_RATE_LIMITED',
        });
    });

    assert.equal(calls.length, ACCOUNT_FAILURE_LIMIT);
});

test('all protected auth routes are checked before their account adapters', async () => {
    const checks = [];
    const adapterCalls = [];
    const authRateLimiter = {
        consume(request) {
            checks.push(request);
            return { allowed: false, retryAfterSeconds: 60 };
        },
        recordFailure() {},
        recordSuccess() {},
    };
    const app = createApp({
        submitAnswers: async () => ({}),
        authRateLimiter,
        registerUser: async () => adapterCalls.push('register'),
        loginUser: async () => adapterCalls.push('login'),
        verifyParentLogin: async () => adapterCalls.push('parent-login'),
        setParentCredentials: async () => adapterCalls.push('parent-setup'),
        resetChildPassword: async () => adapterCalls.push('parent-reset'),
    });

    await withServer(app, async baseUrl => {
        const requests = [
            ['/api/auth/register', { username: 'student', password: 'pass' }],
            ['/api/auth/login', { username: 'student', password: 'pass' }],
            ['/api/auth/parent/login', { user: 'student', parentUsername: 'parent', password: 'pass' }],
            ['/api/auth/parent/setup', { user: 'student', childPassword: 'pass', parentUsername: 'parent', parentPassword: 'pass' }],
            ['/api/auth/parent/reset-child-password', { user: 'student', parentUsername: 'parent', parentPassword: 'pass', newPassword: 'next-pass' }],
        ];
        for (const [path, body] of requests) {
            const response = await fetch(baseUrl + path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.21' },
                body: JSON.stringify(body),
            });
            assert.equal(response.status, 429);
            assert.equal(response.headers.get('retry-after'), '60');
        }
    });

    assert.deepEqual(adapterCalls, []);
    assert.deepEqual(checks.map(check => check.route), [
        'register',
        'child-login',
        'parent-login',
        'parent-setup',
        'parent-reset',
    ]);
    assert.deepEqual(checks.map(check => check.account), [
        'student',
        'student',
        'student:parent',
        'student:parent',
        'student:parent',
    ]);
});

test('session progress endpoint is registered when the progress adapter is supplied', async () => {
    const calls = [];
    const app = createApp({
        submitAnswers: async () => ({}),
        updateQuizSessionProgress: async (user, testId, progress) => {
            calls.push({ user, testId, progress });
            return { test_id: testId };
        },
    });

    await withServer(app, async baseUrl => {
        const response = await fetch(baseUrl + '/api/quiz/session/progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user: 'test_user',
                testId: 'real-session-progress-contract',
                currentQuestion: 1,
                answers: [{ option: 0, confidence: 'sure' }],
            }),
        });

        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            saved: true,
            testId: 'real-session-progress-contract',
        });
    });

    assert.deepEqual(calls, [{
        user: 'test_user',
        testId: 'real-session-progress-contract',
        progress: {
            currentQuestion: 1,
            answers: [{ option: 0, confidence: 'sure' }],
        },
    }]);
});

test('quiz session endpoints return readable missing-parameter errors', async () => {
    const app = createApp({
        submitAnswers: async () => ({}),
        getActiveFormalQuizChallenge: async () => null,
        updateQuizSessionProgress: async () => null,
    });

    await withServer(app, async baseUrl => {
        const missingUser = await fetch(`${baseUrl}/api/quiz/session`);
        assert.equal(missingUser.status, 400);
        assert.deepEqual(await missingUser.json(), {
            error: '缺少用户ID',
            code: 'BAD_REQUEST',
        });

        const missingProgressParameters = await fetch(`${baseUrl}/api/quiz/session/progress`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: 'student', testId: 'real-1' }),
        });
        assert.equal(missingProgressParameters.status, 400);
        assert.deepEqual(await missingProgressParameters.json(), {
            error: '缺少参数',
            code: 'BAD_REQUEST',
        });
    });
});

test('session guard blocks createApp private routes before business adapters run', async () => {
    const calls = [];
    const requireUserSession = (req, res) => {
        calls.push(['guard', req.method, String(req.originalUrl || '').split('?')[0]]);
        res.status(401).json({ error: 'Unauthorized' });
    };
    const app = createApp({
        requireUserSession,
        submitAnswers: async () => {
            calls.push(['submitAnswers']);
            return {};
        },
        getActiveFormalQuizChallenge: async () => {
            calls.push(['getActiveFormalQuizChallenge']);
            return null;
        },
        updateQuizSessionProgress: async () => {
            calls.push(['updateQuizSessionProgress']);
            return {};
        },
        createReviewRound: async () => {
            calls.push(['createReviewRound']);
            return {};
        },
        getActiveReviewRound: async () => {
            calls.push(['getActiveReviewRound']);
            return {};
        },
        submitReviewRound: async () => {
            calls.push(['submitReviewRound']);
            return {};
        },
        deferReviewRound: async () => {
            calls.push(['deferReviewRound']);
            return {};
        },
        getReviewSummary: async () => {
            calls.push(['getReviewSummary']);
            return {};
        },
    });

    await withServer(app, async baseUrl => {
        const requests = [
            fetch(`${baseUrl}/api/quiz/session?user=student`),
            fetch(`${baseUrl}/api/quiz/session/progress`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user: 'student', testId: 'real-1', answers: [] }),
            }),
            fetch(`${baseUrl}/api/submit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user: 'student', testId: 'real-1', answers: [] }),
            }),
            fetch(`${baseUrl}/api/reviews`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user: 'student', sourceTestId: 'real-1' }),
            }),
            fetch(`${baseUrl}/api/reviews/active?user=student&sourceTestId=real-1`),
            fetch(`${baseUrl}/api/reviews/real-review-r1/submit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user: 'student', answers: [] }),
            }),
            fetch(`${baseUrl}/api/reviews/real-review-r1/defer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user: 'student' }),
            }),
            fetch(`${baseUrl}/api/reviews/summary?user=student&sourceTestId=real-1`),
        ];
        const responses = await Promise.all(requests);
        assert.deepEqual(responses.map(response => response.status), Array(8).fill(401));
    });

    const sortCalls = items => items
        .slice()
        .sort((left, right) => `${left[1]} ${left[2]}`.localeCompare(`${right[1]} ${right[2]}`));
    assert.deepEqual(sortCalls(calls), sortCalls([
        ['guard', 'GET', '/api/quiz/session'],
        ['guard', 'POST', '/api/quiz/session/progress'],
        ['guard', 'POST', '/api/submit'],
        ['guard', 'POST', '/api/reviews'],
        ['guard', 'GET', '/api/reviews/active'],
        ['guard', 'POST', '/api/reviews/real-review-r1/submit'],
        ['guard', 'POST', '/api/reviews/real-review-r1/defer'],
        ['guard', 'GET', '/api/reviews/summary'],
    ]));
});

test('parent auth endpoint verifies the parent account in child context', async () => {
    const calls = [];
    const app = createApp({
        submitAnswers: async () => ({}),
        verifyParentLogin: async input => { calls.push(['parentLogin', input]); return { ok: true, user: input.user, parentUsername: input.parentUsername }; },
    });

    await withServer(app, async baseUrl => {
        const parentResponse = await fetch(baseUrl + '/api/auth/parent/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: 'Draggy', parentUsername: 'xiaoyan', password: '111111' }),
        });

        assert.equal(parentResponse.status, 200);
        assert.deepEqual(calls, [
            ['parentLogin', { user: 'Draggy', parentUsername: 'xiaoyan', password: '111111' }],
        ]);
    });
});


test('parent reset child password endpoint calls the server-side account service', async () => {
    const calls = [];
    const app = createApp({
        submitAnswers: async () => ({}),
        resetChildPassword: async input => { calls.push(['resetChildPassword', input]); return { ok: true, user: input.user }; },
    });

    await withServer(app, async baseUrl => {
        const response = await fetch(baseUrl + '/api/auth/parent/reset-child-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: 'Draggy', parentUsername: 'xiaoyan', parentPassword: '111111', newPassword: 'newpass' }),
        });

        assert.equal(response.status, 200);
        assert.deepEqual(calls, [
            ['resetChildPassword', { user: 'Draggy', parentUsername: 'xiaoyan', parentPassword: '111111', newPassword: 'newpass' }],
        ]);
    });
});

test('otp auth endpoints are no longer exposed', async () => {
    const app = createApp({ submitAnswers: async () => ({}) });
    await withServer(app, async baseUrl => {
        for (const path of ['/api/auth/requestOtp', '/api/auth/otpLogin', '/api/auth/parentOtp']) {
            const response = await fetch(baseUrl + path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: '15863061969', otp: '123456' }),
            });
            assert.equal(response.status, 404);
        }
    });
});

test('submit endpoint rejects a non-array answer payload with HTTP 400', async () => {
    const app = createApp({
        submitAnswers: async () => {
            throw new Error('should not be called');
        },
    });

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user: 'student',
                testId: 'quiz-1',
                answers: null,
            }),
        });
        const body = await response.json();

        assert.equal(response.status, 400);
        assert.ok(body.error);
        assert.equal(body.code, 'BAD_REQUEST');
    });
});

test('submit endpoint returns a stable code for unexpected server errors', async () => {
    const app = createApp({
        submitAnswers: async () => {
            throw new Error('upstream unavailable');
        },
    });

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user: 'student',
                testId: 'quiz-1',
                answers: [],
            }),
        });
        const body = await response.json();

        assert.equal(response.status, 500);
        assert.deepEqual(body, {
            error: 'upstream unavailable',
            code: 'INTERNAL_ERROR',
        });
    });
});

test('submit endpoint returns an already-submitted result unchanged', async () => {
    const expected = {
        alreadySubmitted: true,
        correct: 1,
        total: 1,
        accuracy: '100.0%',
    };
    const app = createApp({
        submitAnswers: async () => expected,
    });

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user: 'student',
                testId: 'quiz-1',
                answers: [0],
            }),
        });

        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), expected);
    });
});


test('submit endpoint starts wrong-answer review prebuild without waiting for it', async () => {
    let releasePrebuild;
    const prebuildDone = new Promise(resolve => { releasePrebuild = resolve; });
    const calls = [];
    const app = createApp({
        submitAnswers: async () => ({
            results: [{ recordId: 'word-1', correct: false }],
            correct: 0,
            total: 1,
        }),
        createReviewRound: async input => {
            calls.push(input);
            await prebuildDone;
            return { reviewId: 'real-review-r1', questions: [] };
        },
    });

    await withServer(app, async baseUrl => {
        const response = await fetch(baseUrl + '/api/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user: 'student',
                testId: 'real-q1',
                answers: [{ option: 1, confidence: 'sure' }],
            }),
        });

        assert.equal(response.status, 200);
        assert.equal((await response.json()).total, 1);
        assert.deepEqual(calls, [{
            userId: 'student',
            sourceTestId: 'real-q1',
            parentReviewId: '',
        }]);
        releasePrebuild();
    });
});

test('review creation endpoint forwards explicit linkage', async () => {
    let received;
    const app = createApp({
        submitAnswers: async () => ({}),
        createReviewRound: async input => {
            received = input;
            return { reviewId: 'real-review-r1', questions: [] };
        },
    });

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/reviews`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user: 'student',
                sourceTestId: 'real-q1',
                parentReviewId: '',
            }),
        });

        assert.equal(response.status, 200);
        assert.deepEqual(received, {
            userId: 'student',
            sourceTestId: 'real-q1',
            parentReviewId: '',
        });
    });
});

test('review endpoints return the common bad-request contract', async () => {
    const app = createApp({
        submitAnswers: async () => ({}),
        createReviewRound: async () => ({}),
    });

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/reviews`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });

        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), {
            error: '缺少参数',
            code: 'BAD_REQUEST',
        });
    });
});

test('active formal quiz session response exposes trusted cache-only metadata', async () => {
    const questions = Array.from({ length: 10 }, (_, index) => ({
        type: 1,
        word: `word-${index}`,
        wordRecordId: `meaning-${index}`,
        cacheRecordId: `cache-${index}`,
        source: 'question_cache',
    }));
    const app = createApp({
        submitAnswers: async () => ({}),
        getActiveFormalQuizChallenge: async user => ({
            test_id: `real-${user}`,
            questions,
            progress: { currentQuestion: 3, answers: ['A'] },
            source: 'question_cache',
            mode: 'real',
        }),
    });

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/quiz/session?user=student&source=live_fallback&mode=test`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            active: true,
            testId: 'real-student',
            source: 'question_cache',
            mode: 'real',
            partialFormalChallenge: false,
            readyCount: 10,
            requiredCount: 10,
            diagnostics: {
                fallbackUsed: false,
                resumed: true,
                requiredCount: 10,
                readyCount: 10,
                finalQuestionCount: 10,
            },
            questions,
            progress: { currentQuestion: 3, answers: ['A'] },
        });
    });
});

test('active session DTO rejects a complete formal session with missing question source', async () => {
    const questions = Array.from({ length: 10 }, (_, index) => ({
        type: 1,
        word: `word-${index}`,
        wordRecordId: `meaning-${index}`,
        cacheRecordId: `cache-${index}`,
    }));
    const app = createApp({
        submitAnswers: async () => ({}),
        getActiveFormalQuizChallenge: async () => ({
            test_id: 'real-missing-question-source',
            questions,
            progress: { currentQuestion: 3, answers: ['A'] },
        }),
    });

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/quiz/session?user=student`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { active: false });
    });
});

test('active session DTO rejects a partial formal cache challenge', async () => {
    const questions = Array.from({ length: 7 }, (_, index) => ({
        type: 1,
        word: `word-${index}`,
        wordRecordId: `meaning-${index}`,
        cacheRecordId: `cache-${index}`,
        source: 'question_cache',
    }));
    const app = createApp({
        submitAnswers: async () => ({}),
        getActiveFormalQuizChallenge: async () => ({
            test_id: 'real-partial-student',
            questions,
            progress: { currentQuestion: 3, answers: ['A'] },
        }),
    });

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/quiz/session?user=student`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { active: false });
    });
});

test('inactive quiz session response does not fabricate formal cache metadata', async () => {
    const app = createApp({
        submitAnswers: async () => ({}),
        getActiveFormalQuizChallenge: async () => null,
    });

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/quiz/session?user=student`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { active: false });
    });
});

test('active formal session endpoint fails closed instead of reading a legacy quiz session', async () => {
    const legacyReads = [];
    const legacyQuestions = Array.from({ length: 10 }, (_, index) => ({
        type: 1,
        word: `word-${index}`,
        wordRecordId: `meaning-${index}`,
        cacheRecordId: `cache-${index}`,
        source: 'question_cache',
    }));
    const app = createApp({
        submitAnswers: async () => ({}),
        getActiveFormalQuizChallenge: async () => null,
        getActiveQuizSession: async (...args) => {
            legacyReads.push(args);
            return { test_id: 'real-legacy', questions: legacyQuestions };
        },
    });

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/quiz/session?user=student`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { active: false });
    });
    assert.deepEqual(legacyReads, []);
});
test('health endpoint reports runtime and configuration presence', async () => {
    const app = createApp({
        submitAnswers: async () => ({}),
        getRuntimeHealth: () => ({
            ok: true,
            version: '1.0.0',
            env: {
                FEISHU_APP_ID: true,
                FEISHU_APP_SECRET: false,
            },
        }),
    });

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/health`);
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.ok, true);
        assert.equal(body.version, '1.0.0');
        assert.equal(body.env.FEISHU_APP_ID, true);
        assert.equal(body.env.FEISHU_APP_SECRET, false);
    });
});

test('active session DTO rejects sessions that are not resumable formal cache challenges', async t => {
    const validQuestions = Array.from({ length: 3 }, (_, index) => ({
        type: 1,
        word: `word-${index}`,
        wordRecordId: `meaning-${index}`,
        cacheRecordId: `cache-${index}`,
        source: 'question_cache',
    }));
    const invalidSessions = [
        {
            name: 'empty questions',
            session: { test_id: 'real-empty', questions: [] },
        },
        {
            name: 'test mode',
            session: { test_id: 'test-session', mode: 'test', questions: validQuestions },
        },
        {
            name: 'live fallback source',
            session: { test_id: 'real-live', source: 'live_fallback', questions: validQuestions },
        },
        {
            name: 'duplicate meaning ids',
            session: {
                test_id: 'real-duplicate',
                questions: validQuestions.map(question => ({ ...question, wordRecordId: 'same-meaning' })),
            },
        },
        {
            name: 'missing meaning id',
            session: {
                test_id: 'real-missing-meaning',
                questions: validQuestions.map(({ wordRecordId, ...question }) => question),
            },
        },
    ];

    for (const { name, session } of invalidSessions) {
        await t.test(name, async () => {
            const app = createApp({
                submitAnswers: async () => ({}),
                getActiveFormalQuizChallenge: async () => session,
            });

            await withServer(app, async baseUrl => {
                const response = await fetch(`${baseUrl}/api/quiz/session?user=student`);
                assert.equal(response.status, 200);
                assert.deepEqual(await response.json(), { active: false });
            });
        });
    }
});
