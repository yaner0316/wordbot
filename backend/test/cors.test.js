const test = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../http-app');

async function withServer(app, run) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
        await run(`http://127.0.0.1:${server.address().port}`);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

function corsRequestHeaders(origin) {
    return { Origin: origin };
}

test('credentialed CORS precisely permits the production web origin for a session API', async () => {
    const app = createApp({
        submitAnswers: async () => ({}),
        getActiveQuizSession: async () => null,
    });

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/quiz/session?user=student`, {
            headers: {
                ...corsRequestHeaders('https://wordbot-web.onrender.com'),
                Cookie: 'wordbot_session=test-session',
            },
        });

        assert.equal(response.status, 200);
        assert.equal(response.headers.get('access-control-allow-origin'), 'https://wordbot-web.onrender.com');
        assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
        assert.match(response.headers.get('vary') || '', /Origin/);
    });
});

test('credentialed CORS answers OPTIONS for the question-cache status API', async () => {
    const app = createApp({ submitAnswers: async () => ({}) });

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/admin/questionCache/status?userId=student`, {
            method: 'OPTIONS',
            headers: {
                ...corsRequestHeaders('https://wordbot-web.onrender.com'),
                'Access-Control-Request-Method': 'GET',
                'Access-Control-Request-Headers': 'content-type',
            },
        });

        assert.equal(response.status, 204);
        assert.equal(response.headers.get('access-control-allow-origin'), 'https://wordbot-web.onrender.com');
        assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
        assert.match(response.headers.get('vary') || '', /Origin/);
        assert.match(response.headers.get('access-control-allow-methods') || '', /GET/);
        assert.equal(response.headers.get('access-control-allow-headers'), 'content-type');
    });
});

test('origins outside the allowlist receive normal HTTP responses but no CORS permission', async () => {
    const app = createApp({ submitAnswers: async () => ({}) });

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/health`, {
            headers: corsRequestHeaders('https://attacker.example'),
        });

        assert.equal(response.status, 200);
        assert.equal(response.headers.get('access-control-allow-origin'), null);
        assert.equal(response.headers.get('access-control-allow-credentials'), null);
    });
});

test('origins outside the allowlist cannot receive CORS permission from OPTIONS', async () => {
    const app = createApp({ submitAnswers: async () => ({}) });

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/admin/questionCache/status?userId=student`, {
            method: 'OPTIONS',
            headers: {
                ...corsRequestHeaders('https://attacker.example'),
                'Access-Control-Request-Method': 'GET',
                'Access-Control-Request-Headers': 'content-type',
            },
        });

        assert.equal(response.headers.get('access-control-allow-origin'), null);
        assert.equal(response.headers.get('access-control-allow-credentials'), null);
        assert.equal(response.headers.get('access-control-allow-methods'), null);
    });
});

test('allowlist can be configured without loading production server dependencies', async () => {
    const app = createApp({
        submitAnswers: async () => ({}),
        corsEnvironment: {
            NODE_ENV: 'production',
            WORDBOT_CORS_ALLOWED_ORIGINS: 'https://preview.wordbot.example, https://wordbot-web.onrender.com',
        },
    });

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/health`, {
            headers: corsRequestHeaders('https://preview.wordbot.example'),
        });

        assert.equal(response.status, 200);
        assert.equal(response.headers.get('access-control-allow-origin'), 'https://preview.wordbot.example');
        assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
        assert.match(response.headers.get('vary') || '', /Origin/);
    });
});

test('localhost is allowed only for explicit development mode', async () => {
    const developmentApp = createApp({
        submitAnswers: async () => ({}),
        corsEnvironment: { NODE_ENV: 'development' },
    });
    const productionApp = createApp({
        submitAnswers: async () => ({}),
        corsEnvironment: { NODE_ENV: 'production' },
    });

    await withServer(developmentApp, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/health`, {
            headers: corsRequestHeaders('http://localhost:5173'),
        });
        assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
        assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
    });

    await withServer(productionApp, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/health`, {
            headers: corsRequestHeaders('http://localhost:5173'),
        });
        assert.equal(response.headers.get('access-control-allow-origin'), null);
        assert.equal(response.headers.get('access-control-allow-credentials'), null);
    });
});

test('requests without Origin retain normal same-origin API behavior', async () => {
    const app = createApp({ submitAnswers: async () => ({}) });

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/health`);

        assert.equal(response.status, 200);
        assert.equal(response.headers.get('access-control-allow-origin'), null);
    });
});
