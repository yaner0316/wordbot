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
    const dataSource = String(env.DATA_SOURCE || env.WORDBOT_DATA_SOURCE || 'supabase').trim().toLowerCase() === 'feishu'
        ? 'feishu'
        : 'supabase';
    const missing = dataSource === 'feishu' ? REQUIRED_ENV.filter(name => !envStatus[name]) : [];
    const questionCache = {
        appTokenConfigured: Boolean(env.FEISHU_QUESTION_CACHE_APP_TOKEN),
        tableIdConfigured: Boolean(env.FEISHU_QUESTION_CACHE_TABLE_ID),
    };
    questionCache.configured = questionCache.appTokenConfigured && questionCache.tableIdConfigured;
    const session = {
        sharedSecretConfigured: Boolean(env.WORDBOT_SESSION_SECRET || env.WORDBOT_ADMIN_TOKEN),
    };
    return {
        ok: missing.length === 0,
        service: 'wordbot-backend',
        version,
        time: now(),
        dataSource: env.DATA_SOURCE || 'supabase',
        env: envStatus,
        questionCache,
        session,
        missing,
    };
}

module.exports = {
    REQUIRED_ENV,
    getRuntimeHealth,
};
