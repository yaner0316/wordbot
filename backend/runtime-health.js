const REQUIRED_ENV = [
    'FEISHU_APP_ID',
    'FEISHU_APP_SECRET',
    'FEISHU_WORD_APP_TOKEN',
    'FEISHU_WORD_TABLE_ID',
    'FEISHU_TEST_APP_TOKEN',
    'FEISHU_TEST_TABLE_ID',
    'FEISHU_STATS_APP_TOKEN',
    'FEISHU_STATS_TABLE_ID',
];

function getRuntimeHealth({
    env = process.env,
    version = '1.0.0',
    now = () => new Date().toISOString(),
} = {}) {
    const envStatus = {};
    for (const name of REQUIRED_ENV) {
        envStatus[name] = Boolean(env[name]);
    }
    const missing = REQUIRED_ENV.filter(name => !envStatus[name]);
    return {
        ok: missing.length === 0,
        service: 'wordbot-backend',
        version,
        time: now(),
        env: envStatus,
        missing,
    };
}

module.exports = {
    REQUIRED_ENV,
    getRuntimeHealth,
};
