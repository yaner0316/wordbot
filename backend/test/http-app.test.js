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
        assert.match(body.error, /答案必须是数组/);
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
