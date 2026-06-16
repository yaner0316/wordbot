/**
 * WordBot 全局配置文件
 * 所有敏感信息必须通过环境变量注入，禁止硬编码！
 */

// 本地开发时从 .env 文件加载环境变量
try {
  require('dotenv').config();
} catch (e) {
  // dotenv 未安装或 .env 不存在，不影响生产环境
}

// 飞书应用凭证
function getEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`缺少必需的环境变量: ${name}`);
  }
  return value;
}

// 飞书应用身份凭证（必填，无默认值）
const APP_ID = getEnv('FEISHU_APP_ID');
const APP_SECRET = getEnv('FEISHU_APP_SECRET');

// AI 服务（可选，部分功能需要）
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;

// 飞书多维表格配置（必填，无默认值）
// 4 张表的 appToken 和 tableId
const WORD_TABLE = {
  appToken: getEnv('FEISHU_WORD_APP_TOKEN'),
  tableId: getEnv('FEISHU_WORD_TABLE_ID'),
};
// 干扰词表为可选（部分功能使用）
const DIST_TABLE = (process.env.FEISHU_DIST_APP_TOKEN && process.env.FEISHU_DIST_TABLE_ID)
  ? { appToken: process.env.FEISHU_DIST_APP_TOKEN, tableId: process.env.FEISHU_DIST_TABLE_ID }
  : null;
const TEST_TABLE = {
  appToken: getEnv('FEISHU_TEST_APP_TOKEN'),
  tableId: getEnv('FEISHU_TEST_TABLE_ID'),
};
const STATS_TABLE = {
  appToken: getEnv('FEISHU_STATS_APP_TOKEN'),
  tableId: getEnv('FEISHU_STATS_TABLE_ID'),
};
const QUESTION_CACHE_TABLE = (process.env.FEISHU_QUESTION_CACHE_APP_TOKEN && process.env.FEISHU_QUESTION_CACHE_TABLE_ID)
  ? { appToken: process.env.FEISHU_QUESTION_CACHE_APP_TOKEN, tableId: process.env.FEISHU_QUESTION_CACHE_TABLE_ID }
  : null;

// 飞书字段选项 ID 映射（可配置，避免表格改动后硬编码失效）
const OPTION_IDS = {
  // 状态
  STATUS_MASTERED: process.env.FEISHU_OPT_STATUS_MASTERED || 'optF5P0W3O',
  STATUS_PENDING: process.env.FEISHU_OPT_STATUS_PENDING || 'optXjbXS2F',
  // 正确/错误
  IS_CORRECT: process.env.FEISHU_OPT_IS_CORRECT || 'optHGT7gYf',
  IS_WRONG: process.env.FEISHU_OPT_IS_WRONG || 'optbe4bsQk',
  // 多义词标记
  MULTI_DEF_YES: process.env.FEISHU_OPT_MULTI_DEF_YES || 'opthB7bmkB',
  MULTI_DEF_NO: process.env.FEISHU_OPT_MULTI_DEF_NO || 'optpWwFJpq',
};

// 状态常量（显示名称）
const STATUS = {
  STATUS_PENDING: 'Pending',
  STATUS_MASTERED: 'Mastered',
};

module.exports = {
  APP_ID,
  APP_SECRET,
  MINIMAX_API_KEY,
  WORD_TABLE,
  DIST_TABLE,
  TEST_TABLE,
  STATS_TABLE,
  QUESTION_CACHE_TABLE,
  OPTION_IDS,
  STATUS,
};
