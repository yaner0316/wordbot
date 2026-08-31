const http = require('node:http');
const test = require('node:test');
const assert = require('node:assert/strict');

const { verifyPublicHealthRelease } = require('../scripts/verify-public-health-release');

async function withHealthServer(body, callback) {
    const requests = [];
    const server = http.createServer((req, res) => {
        requests.push({ method: req.method, url: req.url });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(body));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        return await callback(`http://127.0.0.1:${server.address().port}/api/health`, requests);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

test('public health smoke accepts the expected release with one GET request', async () => {
    const expectedCommit = 'a1b478611653e7715c99b1fd4929836249c57831';

    await withHealthServer({
        ok: true,
        release: { commit: expectedCommit, source: 'render' },
    }, async (healthUrl, requests) => {
        const result = await verifyPublicHealthRelease({ healthUrl, expectedCommit });

        assert.deepEqual(result, { commit: expectedCommit, healthUrl });
        assert.deepEqual(requests, [{ method: 'GET', url: '/api/health' }]);
    });
});

test('public health smoke rejects a live release that does not match the expected commit', async () => {
    await withHealthServer({
        ok: true,
        release: { commit: 'b'.repeat(40), source: 'render' },
    }, async healthUrl => {
        await assert.rejects(
            verifyPublicHealthRelease({
                healthUrl,
                expectedCommit: 'a'.repeat(40),
            }),
            /release SHA did not match/i
        );
    });
});

test('public health smoke rejects an unhealthy response even with the expected release', async () => {
    const expectedCommit = 'a'.repeat(40);
    await withHealthServer({
        ok: false,
        release: { commit: expectedCommit, source: 'render' },
    }, async healthUrl => {
        await assert.rejects(
            verifyPublicHealthRelease({ healthUrl, expectedCommit }),
            /public health was not healthy/i
        );
    });
});
