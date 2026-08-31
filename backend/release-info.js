const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

function getReleaseInfo(env = process.env) {
    const commit = String(env.RENDER_GIT_COMMIT || '').toLowerCase();
    if (!GIT_SHA_PATTERN.test(commit)) return { commit: null, source: 'unknown' };
    return { commit, source: 'render' };
}

module.exports = {
    getReleaseInfo,
};
