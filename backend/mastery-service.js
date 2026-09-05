/**
 * 统一掌握判定服务
 * 单一事实来源，所有掌握判定逻辑集中在这里
 */

const { evaluateMeaningMastery, evaluateWordMastery } = require('./mastery-evidence');

/**
 * 掌握判定规则（已确认）
 * - 所有来源词义统一：最近两次正式答对间隔 18–720 小时
 * - 答错后清零，从下一次答对重新开始
 * - 每个释义独立掌握，全部掌握才算单词掌握
 * - 两次必须使用不同题干；缺失题干或重复提交不能证明掌握
 * - 复习题不计入掌握证据
 */

/**
 * 评估单个释义的掌握状态
 * @param {Array} records - 答题记录
 * @param {Function} isCorrectValue - 判断是否正确的函数
 * @returns {Object} 掌握状态
 */
function evaluateMeaning(records, isCorrectValue) {
    return evaluateMeaningMastery(records, isCorrectValue);
}

/**
 * 评估整个单词的掌握状态（多义词）
 * @param {Array} recordIds - 释义记录ID列表
 * @param {Array} records - 所有答题记录
 * @param {Function} isCorrectValue - 判断是否正确的函数
 * @returns {Object} 掌握状态
 */
function evaluateWord(recordIds, records, isCorrectValue) {
    return evaluateWordMastery(recordIds, records, isCorrectValue);
}

/**
 * 汇总用户所有单词的掌握进度
 * @param {Array} wordRecords - 单词记录
 * @param {Array} submittedRecords - 已提交的答题记录
 * @param {Function} isCorrectValue - 判断是否正确的函数
 * @param {Function} getWordKey - 获取单词key的函数
 * @param {Function} getRecordId - 获取记录ID的函数
 * @returns {Object} 掌握进度汇总
 */
function summarizeProgress(wordRecords, submittedRecords, isCorrectValue, getWordKey, getRecordId) {
    const groups = new Map();
    
    // 按单词分组
    for (const record of wordRecords || []) {
        const word = getWordKey(record);
        if (!word) continue;
        if (!groups.has(word)) groups.set(word, []);
        groups.get(word).push(record);
    }

    const counts = {
        mastered: 0,
        consolidating: 0,
        recognized: 0,
        unseen: 0,
    };
    const progress = {};

    // 评估每个单词
    for (const [word, records] of groups.entries()) {
        const recordIds = records.map(getRecordId).filter(Boolean);
        const evaluation = evaluateWord(recordIds, submittedRecords || [], isCorrectValue);
        const stage = evaluation.stage || 'unseen';
        counts[stage] = (counts[stage] || 0) + 1;
        progress[word] = evaluation;
    }

    const totalWords = groups.size;
    return {
        totalWords,
        totalMeanings: (wordRecords || []).length,
        masteredWords: counts.mastered,
        consolidatingWords: counts.consolidating,
        recognizedWords: counts.recognized,
        unseenWords: counts.unseen,
        pendingWords: totalWords - counts.mastered,
        masteryStageCounts: counts,
        masteryProgress: progress,
    };
}

/**
 * 检查单词是否可用于正式考试
 * @param {Object} word - 单词记录
 * @param {Object} options - 选项
 * @returns {boolean} 是否可用
 */
function isWordEligibleForQuiz(word, options = {}) {
    const { now = Date.now(), minAgeMs = 18 * 60 * 60 * 1000 } = options;
    
    // 检查冷却期
    const timestamp = getWordTimestamp(word);
    if (!timestamp) return false; // 缺失时间戳默认不可用（保守策略）
    
    return now - timestamp >= minAgeMs;
}

/**
 * 获取单词记录的时间戳
 * @param {Object} record - 单词记录
 * @returns {number} 时间戳
 */
function getWordTimestamp(record) {
    const recordTime = Number(record?.fields?.record_time || record?.record_time || 0);
    if (Number.isFinite(recordTime) && recordTime > 0) return recordTime;
    
    const createdTime = Number(record?.created_time || record?.created_at || 0);
    return Number.isFinite(createdTime) && createdTime > 0 ? createdTime : 0;
}

module.exports = {
    evaluateMeaning,
    evaluateWord,
    summarizeProgress,
    isWordEligibleForQuiz,
    getWordTimestamp,
};
