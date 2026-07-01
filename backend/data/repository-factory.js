const { assertRepositoryShape } = require('./repository-contract');
const { createFeishuRepositories } = require('./feishu-repositories');

function normalizeDataSource(value) {
    return String(value || 'feishu').trim() || 'feishu';
}

function loadDefaultFeishuDependencies() {
    const config = require('../config');
    const { createFeishuClient } = require('./feishu-client');
    return {
        feishuClient: createFeishuClient({
            appId: config.APP_ID,
            appSecret: config.APP_SECRET,
        }),
        tables: {
            word: config.WORD_TABLE,
            test: config.TEST_TABLE,
            stats: config.STATS_TABLE,
            questionCache: config.QUESTION_CACHE_TABLE,
        },
    };
}

function createRepositories({
    env = process.env,
    feishuClient,
    tables,
    loadDefaults = loadDefaultFeishuDependencies,
} = {}) {
    const dataSource = normalizeDataSource(env.WORDBOT_DATA_SOURCE);
    if (dataSource !== 'feishu') {
        throw new Error(`Unsupported WORDBOT_DATA_SOURCE for Phase 3: ${dataSource}`);
    }

    const defaults = feishuClient && tables ? {} : loadDefaults();
    const repositories = createFeishuRepositories({
        client: feishuClient || defaults.feishuClient,
        tables: tables || defaults.tables,
    });
    return assertRepositoryShape(repositories);
}

module.exports = {
    createRepositories,
    normalizeDataSource,
};
