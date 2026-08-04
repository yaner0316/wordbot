/**
 * 统一数据源配置
 * 单一事实来源，所有数据源相关配置集中在这里
 */

/**
 * 标准化数据源名称
 * @param {string} value - 数据源名称
 * @returns {string} 标准化后的数据源名称
 */
function normalizeDataSource(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'feishu' ? 'feishu' : 'supabase';
}

/**
 * 获取当前数据源
 * 优先级：DATA_SOURCE > WORDBOT_DATA_SOURCE > 默认值 'supabase'
 * @returns {string} 数据源名称
 */
function getDataSource() {
    const value = process.env.DATA_SOURCE || process.env.WORDBOT_DATA_SOURCE || 'supabase';
    return normalizeDataSource(value);
}

/**
 * 检查是否使用 Supabase
 * @returns {boolean} 是否使用 Supabase
 */
function isSupabase() {
    return getDataSource() === 'supabase';
}

/**
 * 检查是否使用 Feishu
 * @returns {boolean} 是否使用 Feishu
 */
function isFeishu() {
    return getDataSource() === 'feishu';
}

/**
 * 获取数据源配置
 * @returns {Object} 数据源配置
 */
function getDataSourceConfig() {
    const source = getDataSource();
    return {
        source,
        isSupabase: source === 'supabase',
        isFeishu: source === 'feishu',
        // Supabase 配置
        supabase: {
            url: process.env.SUPABASE_URL,
            serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
            configured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
        },
        // Feishu 配置
        feishu: {
            appId: process.env.FEISHU_APP_ID,
            appSecret: process.env.FEISHU_APP_SECRET,
            configured: Boolean(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET),
        },
    };
}

module.exports = {
    normalizeDataSource,
    getDataSource,
    isSupabase,
    isFeishu,
    getDataSourceConfig,
};
