/**
 * 统一 18 小时冷却期管理
 * 单一事实来源，所有冷却期逻辑集中在这里
 */

/**
 * 冷却期常量（18小时）
 */
const WORD_QUIZ_COOLDOWN_MS = 18 * 60 * 60 * 1000;

/**
 * 获取单词记录的时间戳
 * @param {Object} record - 单词记录
 * @returns {number} 时间戳，如果没有则返回 0
 */
function getWordRecordTimestamp(record) {
    // 优先使用 record_time
    const recordTime = Number(record?.fields?.record_time || record?.record_time || 0);
    if (Number.isFinite(recordTime) && recordTime > 0) return recordTime;
    
    // 其次使用 created_time
    const createdTime = Number(record?.created_time || record?.created_at || 0);
    return Number.isFinite(createdTime) && createdTime > 0 ? createdTime : 0;
}

/**
 * 检查单词是否已过冷却期
 * @param {Object} record - 单词记录
 * @param {Object} options - 选项
 * @param {number} options.now - 当前时间戳
 * @param {number} options.minAgeMs - 最小冷却时间（毫秒）
 * @returns {boolean} 是否已过冷却期
 */
function isWordRecordPastQuizCooldown(record, { now = Date.now(), minAgeMs = WORD_QUIZ_COOLDOWN_MS } = {}) {
    // 如果 minAgeMs 为 0，表示不启用冷却期
    if (!minAgeMs) return true;
    
    const timestamp = getWordRecordTimestamp(record);
    
    // 缺失时间戳的记录默认不可用于正式考试（保守策略）
    // 这是为了防止历史数据绕过冷却期
    if (!timestamp) return false;
    
    return now - timestamp >= minAgeMs;
}

/**
 * 检查单词是否可用于正式考试
 * @param {Object} record - 单词记录
 * @param {Object} options - 选项
 * @returns {boolean} 是否可用
 */
function isWordEligibleForQuiz(record, options = {}) {
    return isWordRecordPastQuizCooldown(record, options);
}

/**
 * 获取冷却期内的单词记录ID集合
 * @param {Array} records - 单词记录列表
 * @param {string} userId - 用户ID
 * @param {number} now - 当前时间戳
 * @returns {Set} 冷却期内的记录ID集合
 */
function getQuizCooldownExcludedRecordIds(records, userId, now = Date.now()) {
    return new Set((records || [])
        .filter(record => userMatches(record.fields?.user, userId))
        .filter(record => !isWordRecordPastQuizCooldown(record, { now, minAgeMs: WORD_QUIZ_COOLDOWN_MS }))
        .map(record => record.record_id)
        .filter(Boolean));
}

/**
 * 检查用户是否匹配
 * @param {*} userField - 用户字段
 * @param {string} userId - 用户ID
 * @returns {boolean} 是否匹配
 */
function userMatches(userField, userId) {
    if (!userField || !userId) return false;
    const fieldValue = String(userField).toLowerCase();
    const targetValue = String(userId).toLowerCase();
    return fieldValue === targetValue || fieldValue.includes(targetValue);
}

module.exports = {
    WORD_QUIZ_COOLDOWN_MS,
    getWordRecordTimestamp,
    isWordRecordPastQuizCooldown,
    isWordEligibleForQuiz,
    getQuizCooldownExcludedRecordIds,
};
