const test = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../http-app');

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
