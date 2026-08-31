const test = require('node:test');
const assert = require('node:assert/strict');

const { getReleaseInfo } = require('../release-info');

test('release info exposes only a full Render Git commit SHA', () => {
    const sha = 'a1b478611653e7715c99b1fd4929836249c57831';

    assert.deepEqual(getReleaseInfo({ RENDER_GIT_COMMIT: sha }), {
        commit: sha,
        source: 'render',
    });
});

test('release info masks missing and malformed deployment values', () => {
    assert.deepEqual(getReleaseInfo({}), { commit: null, source: 'unknown' });
    assert.deepEqual(getReleaseInfo({ RENDER_GIT_COMMIT: 'not-a-sha' }), {
        commit: null,
        source: 'unknown',
    });
    assert.deepEqual(getReleaseInfo({ RENDER_GIT_COMMIT: 'a'.repeat(41) }), {
        commit: null,
        source: 'unknown',
    });
});
