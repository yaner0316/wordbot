const https = require('https');
const { getFormKey, inflectWord } = require('./word-inflector');
const { createAuthService } = require('./auth-service');
const { createTableCache } = require('./table-cache');
const crypto = require('crypto');
const {
    createSubmissionCoordinator,
    rebuildSubmittedResult,
} = require('./submission-coordinator');
const {
    ASSESSMENT_MODE,
    createAssessmentId,
    filterAssessmentRecords,
    getAssessmentMode,
    isRealAssessment,
    isTestAssessment,
    normalizeAssessmentMode,
    shouldAffectLearningState,
} = require('./assessment-mode');
const {
    encodeAnswer,
    evaluateWordMastery,
    normalizeSubmittedAnswer,
    parseStoredAnswer,
} = require('./mastery-evidence');
const {
    normalizeArticleContext,
    normalizeQuizArticleContexts,
} = require('./article-context');
const { enrichQuestionOptionMeanings } = require('./option-meanings');
const { createQuizBuilder } = require('./quiz-builder');
const { hasAiMetaResponse, hasMeaningfulChineseMeaning } = require('./question-quality');
const {
    createQuizTimingLogger,
    shouldAllowLiveQuizFallback,
    shouldRunAiQuizAudit,
} = require('./quiz-performance-policy');
const {
    buildLearningSettings,
    createLearningSettingsOverlay,
    validateLearningLevelChange,
} = require('./user-learning-settings');
const {
    buildCacheRowsForRecord,
    isCacheQuestionReady,
    selectReadyCachedQuestions,
    summarizeCacheStatus,
} = require('./question-cache');
const { createContextDifficultyAdapter } = require('./language-enrichment');
const { createReviewQuestionBuilder } = require('./review-question-builder');
const { createReviewService } = require('./review-service');
const {
    ASSESSMENT_KIND,
    getAssessmentKind,
} = require('./review-session');
const {
    getDeferredRecordIds,
    prioritizePendingRecords,
} = require('./review-priority');
const { calculateGameReward } = require('./game-reward');
const { createQuizRecordWriteStaging } = require('./quiz-record-staging');
const { createSubmitRewardSummary } = require('./reward-submit-summary');
const {
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
} = require('./config');

const { STATUS_MASTERED, STATUS_PENDING } = STATUS;
const {
  STATUS_MASTERED: OPT_STATUS_MASTERED,
  STATUS_PENDING: OPT_STATUS_PENDING,
  IS_CORRECT: OPT_IS_CORRECT,
  IS_WRONG: OPT_IS_WRONG,
  MULTI_DEF_YES: OPT_MULTI_DEF_YES,
} = OPTION_IDS;

// Normalize Bitable field values into plain strings.


function getFieldValue(value) {
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return value.length > 0 ? getFieldValue(value[0]) : '';
    if (typeof value === 'object') {
        if (value.text !== undefined) return String(value.text);
        if (value.name !== undefined) return String(value.name);
        if (value.value !== undefined) return String(value.value);
        if (value.id !== undefined) return String(value.id);
        return JSON.stringify(value);
    }
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed) || (parsed && typeof parsed === 'object')) {
                return getFieldValue(parsed);
            }
        } catch (e) {}
        return value;
    }
    return String(value);
}

function normalizeUserKey(value) {
    return getFieldValue(value).trim().toLowerCase();
}

function userMatches(value, userId) {
    const current = normalizeUserKey(value);
    const target = normalizeUserKey(userId);
    return Boolean(current && target && current === target);
}

function findCanonicalUserRecord(records, userId) {
    const key = normalizeUserKey(userId);
    const matches = (records || []).filter(record => userMatches(record.fields?.user, userId));
    if (matches.length === 0) return null;
    return matches.find(record => getFieldValue(record.fields?.user) === key) || matches[0];
}

function normalizeStatus(status) {
    const value = getFieldValue(status).trim();
    const lower = value.toLowerCase();
    if (lower === STATUS_MASTERED.toLowerCase() || value === OPT_STATUS_MASTERED || value === '\u5df2\u638c\u63e1') return STATUS_MASTERED;
    if (lower === STATUS_PENDING.toLowerCase() || value === OPT_STATUS_PENDING || value === '\u5f85\u590d\u4e60') return STATUS_PENDING;
    return STATUS_PENDING;
}

function isMasteredStatus(status) {
    return normalizeStatus(status) === STATUS_MASTERED;
}

function isCorrectField(value) {
    const normalized = getFieldValue(value).trim();
    return normalized === OPT_IS_CORRECT || normalized === '\u6b63\u786e' || normalized.toLowerCase() === 'true';
}

function hasSubmittedAnswer(record) {
    return record?.fields?.is_correct !== undefined && record?.fields?.is_correct !== null;
}

const TRAD_TO_SIMP = {};

function toSimp(text) {
    if (!text || typeof text !== 'string') return text || '';
    let r = text;
    for (const [t, s] of Object.entries(TRAD_TO_SIMP)) {
        if (r.includes(t)) r = r.split(t).join(s);
    }
    return r;
}

function request(method, path, body, token, timeoutOverrideMs) {
    const timeoutMs = Number(timeoutOverrideMs || process.env.WORDBOT_FEISHU_REQUEST_TIMEOUT_MS || 15000);
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const headers = { 'Content-Type': 'application/json' };
        if (data) headers['Content-Length'] = Buffer.byteLength(data);
        if (token) headers['Authorization'] = 'Bearer ' + token;
        let settled = false;
        let req;
        let totalTimer;
        function settle(callback, value) {
            if (settled) return;
            settled = true;
            clearTimeout(totalTimer);
            callback(value);
        }
        req = https.request({ hostname: 'open.feishu.cn', path, method, headers, timeout: timeoutMs }, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                try { settle(resolve, JSON.parse(Buffer.concat(chunks).toString())); }
                catch { settle(resolve, {}); }
            });
        });
        totalTimer = setTimeout(() => {
            req.destroy(new Error(`Feishu request timeout after ${timeoutMs}ms: ${method} ${path}`));
        }, timeoutMs);
        req.on('timeout', () => {
            req.destroy(new Error(`Feishu request timeout after ${timeoutMs}ms: ${method} ${path}`));
        });
        req.on('error', error => settle(reject, error));
        if (data) req.write(data);
        req.end();
    });
}

let cachedToken = null;
let tokenExpiry = 0;
const recordsCache = createTableCache({ ttlMs: Number(process.env.WORDBOT_FEISHU_RECORDS_CACHE_TTL_MS || 60000) });
const learningSettingsOverlay = createLearningSettingsOverlay({
    ttlMs: Number(process.env.WORDBOT_LEARNING_SETTINGS_OVERLAY_TTL_MS || 2 * 60 * 1000),
});

async function getToken() {
    if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
    const res = await request('POST', '/open-apis/auth/v3/tenant_access_token/internal', {
        app_id: APP_ID, app_secret: APP_SECRET
    });
    cachedToken = res.tenant_access_token;
    tokenExpiry = Date.now() + (res.expire || 7200) * 1000 - 60000;
    return cachedToken;
}

async function loadRecordsFromFeishu(table) {
    const token = await getToken();
    const allRecords = [];
    let pageToken = null;
    do {
        let url = `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records?page_size=500`;
        if (pageToken) url += `&page_token=${encodeURIComponent(pageToken)}`;
        const res = await request('GET', url, null, token);
        const items = res.data?.items || [];
        allRecords.push(...items);
        pageToken = res.data?.page_token;
    } while (pageToken);
    console.log(`getRecords: table=${table.tableId} records=${allRecords.length}`);
    return allRecords;
}

async function getRecords(table) {
    return recordsCache.get(table, () => loadRecordsFromFeishu(table));
}

function invalidateRecordsCache(table) {
    recordsCache.invalidate(table);
}

async function searchRecords(table, filter, sort, timeout = 30000) {
    const token = await getToken();
    const allRecords = [];
    let pageToken = null;
    let prevPageToken = null;
    const body = { page_size: 500 };
    if (filter) body.filter = filter;
    if (sort) body.sort = sort;

    const startTime = Date.now();
    let pageCount = 0;
    do {
        pageCount++;
        if (pageToken) body.page_token = pageToken;
        if (Date.now() - startTime > timeout) {
            console.error(`searchRecords timeout after ${Date.now() - startTime}ms, pages=${pageCount}, records=${allRecords.length}`);
            throw new Error('search timeout');
        }
        const res = await request('POST', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records/search`, body, token, timeout);
        const items = res.data?.items || [];
        allRecords.push(...items);
        prevPageToken = pageToken;
        pageToken = res.data?.page_token;
        if (pageToken && pageToken === prevPageToken) {
            console.warn(`searchRecords: repeated page_token, stopping pagination (table=${table.tableId})`);
            break;
        }
    } while (pageToken);
    console.log(`searchRecords: table=${table.tableId} records=${allRecords.length}`);
    return allRecords;
}

async function addRecord(table, fields, timeoutOverrideMs) {
    const token = await getToken();
    console.log('getRecords request', table.appToken, table.tableId);
    console.log('getRecords filter', JSON.stringify(fields));
    const res = await request('POST', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records`, { fields }, token, timeoutOverrideMs);
    console.log('getRecords response', JSON.stringify(res).substring(0, 200));
    if (res.code !== 0) {
        throw new Error("Feishu add record failed: " + (res.msg || res.code));
    }
    invalidateRecordsCache(table);
    return res;
}

async function addRecords(table, fieldList) {
    const token = await getToken();
    const records = fieldList.map(fields => ({ fields }));
    console.log(`addRecords request table=${table.appToken}/${table.tableId} count=${records.length}`);
    const res = await request('POST', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records/batch_create`, { records }, token);
    console.log('addRecords response', JSON.stringify(res).substring(0, 200));
    if (res.code !== 0) {
        throw new Error("Feishu add records failed: " + (res.msg || res.code));
    }
    invalidateRecordsCache(table);
    return res;
}


const ACCOUNT_FIELDS = [
    { field_name: 'auth_password_hash', type: 1 },
    { field_name: 'auth_password_salt', type: 1 },
    { field_name: 'auth_created_at', type: 5 },
    { field_name: 'phone', type: 1 },
    { field_name: 'phone_verified_at', type: 5 },
];
const LEARNING_SETTINGS_FIELDS = [
    { field_name: 'Learning_Level', type: 1 },
    { field_name: 'Level_Changed_At', type: 5 },
    { field_name: 'Question_Cache_Status', type: 1 },
];
let accountFieldsReady = false;
let learningSettingsFieldsReady = false;

async function listTableFields(table, timeoutOverrideMs) {
    const token = await getToken();
    const fields = [];
    let pageToken = null;
    let prevPageToken = null;
    do {
        let url = `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/fields?page_size=100`;
        if (pageToken) url += `&page_token=${pageToken}`;
        const res = await request('GET', url, null, token, timeoutOverrideMs);
        if (res.code !== 0) throw new Error("Feishu list table fields failed: " + (res.msg || res.code));
        fields.push(...(res.data?.items || []));
        prevPageToken = pageToken;
        pageToken = res.data?.page_token;
        if (pageToken && pageToken === prevPageToken) {
            console.warn(`listTableFields: repeated page_token, stopping pagination (table=${table.tableId})`);
            break;
        }
    } while (pageToken);
    return fields;
}

async function createTableField(table, field, timeoutOverrideMs) {
    const token = await getToken();
    const res = await request('POST', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/fields`, field, token, timeoutOverrideMs);
    if (res.code !== 0 && res.msg !== 'FieldNameDuplicated') {
        throw new Error("Feishu create table field failed: " + (res.msg || res.code));
    }
}

async function ensureTableFields(table, fields, timeoutMs) {
    const existing = new Set((await listTableFields(table, timeoutMs)).map(field => field.field_name));
    for (const field of fields) {
        if (!existing.has(field.field_name)) await createTableField(table, field, timeoutMs);
    }
}

async function ensureAccountFields() {
    if (accountFieldsReady) return;
    await ensureTableFields(STATS_TABLE, ACCOUNT_FIELDS, AUTH_ACCOUNT_FIELD_TIMEOUT_MS);
    accountFieldsReady = true;
}

async function ensureLearningSettingsFields() {
    if (learningSettingsFieldsReady) return;
    await ensureTableFields(STATS_TABLE, LEARNING_SETTINGS_FIELDS, AUTH_ACCOUNT_FIELD_TIMEOUT_MS);
    learningSettingsFieldsReady = true;
}

const AUTH_ACCOUNT_WRITE_TIMEOUT_MS = Number(process.env.WORDBOT_AUTH_ACCOUNT_WRITE_TIMEOUT_MS || 5000);
const LEARNING_SETTINGS_WRITE_TIMEOUT_MS = Number(process.env.WORDBOT_LEARNING_SETTINGS_WRITE_TIMEOUT_MS || 5000);
const AUTH_ACCOUNT_FIELD_TIMEOUT_MS = Number(process.env.WORDBOT_AUTH_ACCOUNT_FIELD_TIMEOUT_MS || 3000);

const quizRecordWrites = createQuizRecordWriteStaging();

async function findAccountRecord(userId) {
    const records = await searchRecords(
        STATS_TABLE,
        { conjunction: 'and', conditions: [{ field_name: 'user', operator: 'is', value: [userId] }] },
        null,
        800
    );
    const targeted = findCanonicalUserRecord(records, userId);
    if (targeted) return targeted;
    return findCanonicalUserRecord(await getRecords(STATS_TABLE), userId);
}

async function findAccountByPhone(phone) {
    const records = await searchRecords(
        STATS_TABLE,
        { conjunction: 'and', conditions: [{ field_name: 'phone', operator: 'is', value: [phone] }] },
        null,
        800
    );
    return records.find(record => getFieldValue(record.fields?.phone).replace(/\D/g, '') === phone) || null;
}

const authService = createAuthService({
    listAccountRecords: () => getRecords(STATS_TABLE),
    findAccountRecord,
    findAccountByPhone,
    listWordUsers: getAllUsers,
    addAccountRecord: fields => addRecord(STATS_TABLE, fields, AUTH_ACCOUNT_WRITE_TIMEOUT_MS),
    updateAccountRecord: (recordId, fields) => updateRecord(STATS_TABLE, recordId, fields, AUTH_ACCOUNT_WRITE_TIMEOUT_MS),
    ensureAccountFields,
    fieldPreparationTimeoutMs: AUTH_ACCOUNT_FIELD_TIMEOUT_MS,
});

async function registerUser(input) {
    return authService.register(input);
}

async function loginUser(input) {
    return authService.login(input);
}

async function requestAuthOtp(input) {
    return authService.requestOtp(input);
}

async function loginWithOtp(input) {
    return authService.loginWithOtp(input);
}

async function verifyParentOtp(input) {
    return authService.verifyParentOtp(input);
}
async function getQuestionCacheRecords() {
    if (!QUESTION_CACHE_TABLE) return [];
    return getRecords(QUESTION_CACHE_TABLE);
}

async function addQuestionCacheRecords(rows) {
    if (!QUESTION_CACHE_TABLE || rows.length === 0) return { skipped: true, count: 0 };
    return addRecords(QUESTION_CACHE_TABLE, rows);
}

async function deleteQuestionCacheRows(userId, type) {
    if (!QUESTION_CACHE_TABLE) return { skipped: true, deleted: 0 };
    const rows = await getQuestionCacheRecords();
    const ids = rows
        .filter(row =>
            userMatches(row.fields?.user, userId) &&
            (type == null || Number(row.fields?.question_type) === type)
        )
        .map(row => row.record_id)
        .filter(Boolean);
    if (ids.length === 0) return { deleted: 0 };
    const token = await getToken();
    let deleted = 0;
    for (let i = 0; i < ids.length; i += 500) {
        const batch = ids.slice(i, i + 500);
        const res = await request(
            'POST',
            `/open-apis/bitable/v1/apps/${QUESTION_CACHE_TABLE.appToken}/tables/${QUESTION_CACHE_TABLE.tableId}/records/batch_delete`,
            { records: batch },
            token
        );
        if (res.code !== 0) {
            throw new Error('Feishu delete question cache rows failed: ' + (res.msg || res.code));
        }
        deleted += batch.length;
    }
    invalidateRecordsCache(QUESTION_CACHE_TABLE);
    return { deleted };
}

async function markQuestionCacheUsed(cacheRecordIds) {
    if (!QUESTION_CACHE_TABLE) return;
    for (const recordId of cacheRecordIds.filter(Boolean)) {
        await updateRecord(QUESTION_CACHE_TABLE, recordId, {
            used_count: 1,
            last_used_at: String(Date.now()),
        });
    }
}

async function updateRecord(table, recordId, fields, timeoutOverrideMs) {
    const token = await getToken();
    const res = await request('PUT', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records/${recordId}`, { fields }, token, timeoutOverrideMs);
    console.log('updateRecord response', JSON.stringify(res).substring(0, 200));
    if (res.code !== 0) {
        throw new Error("Feishu update record failed: " + (res.msg || res.code));
    }
    invalidateRecordsCache(table);
    return res;
}

function secureRandom(arr, count) {
    const pool = [...arr];
    for (let i = pool.length - 1; i > 0; i--) {
        const j = crypto.randomInt(0, i + 1);
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, Math.min(count, pool.length));
}

async function getDistractorPool(records = null) {
    records = records || await getRecords(WORD_TABLE);
    const pool = {};
    const wordIndex = {};
    let stats = { total: 0, hasCN: 0, hasDist3: 0, canType3: 0 };
    
    for (const r of records) {
        const w = getFieldValue(r.fields.Word).toLowerCase();
        if (w) {
            const cn = getFieldValue(r.fields.CN_Meaning).trim();
            const dists = getFieldValue(r.fields.Distractors).split(',').map(s => s.trim()).filter(s => s);
            const context = getFieldValue(r.fields.Context);
            
            pool[r.record_id] = {
                word: getFieldValue(r.fields.Word),
                pos: getFieldValue(r.fields.POS),
                meaning: getFieldValue(r.fields.Meaning),
                CN_Meaning: cn,
                distractors: dists,
                context: context,
                rawContext: context,
                multi_definition: r.fields.multi_definition
            };

            if (!wordIndex[w]) wordIndex[w] = [];
            wordIndex[w].push(r.record_id);
            
            stats.total++;
            if (cn) stats.hasCN++;
            if (dists.length >= 3) stats.hasDist3++;
            if (cn && dists.length >= 3) stats.canType3++;
        }
    }
    console.log(`Distractor pool stats: total=${stats.total}, hasCN=${stats.hasCN}, hasDist3=${stats.hasDist3}, canType3=${stats.canType3}`);
    return { pool, wordIndex };
}

async function getPendingWords(userId, records = null) {
    records = records || await getRecords(WORD_TABLE);
    return records
        .filter(r => userMatches(r.fields.user, userId) && !isMasteredStatus(r.fields.Status))
        .map(r => ({
            record_id: r.record_id,
            word: getFieldValue(r.fields.Word),
            meaning: getFieldValue(r.fields.Meaning),
            pos: getFieldValue(r.fields.POS),
            cn_meaning: getFieldValue(r.fields.CN_Meaning),
            context: getFieldValue(r.fields.Context),
            distractors: getFieldValue(r.fields.Distractors),
            multi_definition: r.fields.multi_definition,
            quality_flags: getFieldValue(r.fields.Quality_Flags),
            level: getFieldValue(r.fields.Level)
        }));
}

async function getUserAssessmentRecords(userId, timeout = 12000) {
    return searchRecords(
        TEST_TABLE,
        { conjunction: 'and', conditions: [{ field_name: 'user', operator: 'is', value: [userId] }] },
        [{ desc: true, field_name: 'test_time' }],
        timeout
    );
}

async function getRecentQuizFootprint(userId, testCount = 4, assessmentRecords = null) {
    const allRecords = assessmentRecords || await getUserAssessmentRecords(userId);
    const records = filterAssessmentRecords(allRecords, ASSESSMENT_MODE.REAL);
    const recentTestIds = [];
    const seenTests = new Set();
    for (const record of records) {
        const testId = getFieldValue(record.fields.test_id);
        if (!testId || seenTests.has(testId)) continue;
        seenTests.add(testId);
        recentTestIds.push(testId);
        if (recentTestIds.length >= testCount) break;
    }

    const recentSet = new Set(recentTestIds);
    const recordIds = new Set();
    const words = new Set();
    for (const record of records) {
        const testId = getFieldValue(record.fields.test_id);
        if (!recentSet.has(testId)) continue;
        const recordId = getFieldValue(record.fields.record_id);
        const word = getFieldValue(record.fields.word).toLowerCase();
        if (recordId) recordIds.add(recordId);
        if (word) words.add(word);
    }
    return { recordIds, words };
}

function isContextValid(ctx) {
    if (!ctx || ctx === '___' || ctx.includes('[object Object]')) return false;
    return true;
}

function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isReservedTestWord(word) {
    return /^test(?:_|$)/i.test(String(word || '').trim());
}

function getWordForms(word) {
    const key = String(word || '').toLowerCase();
    const forms = new Set([key]);
    if (key.endsWith('y')) forms.add(key.slice(0, -1) + 'ies');
    forms.add(key + 's');
    forms.add(key + 'ed');
    forms.add(key + 'ing');
    return Array.from(forms).filter(Boolean);
}

function isContextUsableForWord(word, ctx) {
    if (!ctx || typeof ctx !== 'string') return false;
    const text = ctx.trim();
    if (text === '___' || text.includes('[object Object]')) return false;
    const tokens = text.match(/[A-Za-z]+/g) || [];
    if (tokens.length < 7) return false;
    if (/^it\s+(works|worked|functions?)\s+like\s+a\s+charm\.?$/i.test(text)) return false;
    if (/^the word ".+" is used in context\.$/i.test(ctx.trim())) return false;
    const forms = getWordForms(word).map(escapeRegExp).join('|');
    if (!new RegExp(`\\b(${forms})\\b`, 'i').test(text)) return false;
    const lower = text.toLowerCase();
    const target = String(word || '').toLowerCase();
    const clueWords = tokens
        .map(t => t.toLowerCase())
        .filter(t => !getWordForms(target).includes(t))
        .filter(t => !['the','a','an','it','this','that','these','those','he','she','they','we','i','you','his','her','their','our','my','your','is','are','was','were','be','been','being','has','have','had','do','does','did','to','of','in','on','at','for','with','by','and','or','but','like'].includes(t));
    return clueWords.length >= 4;
}

const buildQuizQuestion = createQuizBuilder({
    choose: secureRandom,
    escapeRegExp,
    getWordForms,
    isContextUsableForWord,
    normalizeArticleContext,
    getFallbackDistractors: info => info.fallbackDistractors || [],
    getFormKey,
    inflectWord,
});
const adaptContextsByLevel = createContextDifficultyAdapter({
    callAI: prompt => callMiniMaxAPI(prompt, 'MiniMax-M2.7', 12000),
    timeoutMs: 14000,
});

function generateQuestion(word, info, distractors, type, allWords) {
    if (!distractors || distractors.length < 3) {
        distractors = secureRandom(allWords.filter(w => w !== word.toLowerCase()), 3);
    }
    const idx = crypto.randomInt(0, 4);
    const opts = [...distractors];
    opts.splice(idx, 0, word);
    const letters = ['A', 'B', 'C', 'D'];
    
    let context = info.context || '';
    context = context.replace(new RegExp(word, 'gi'), '___');
    
    if (type === 1) {
        return {
            type: 1,
            word,
            context: context,
            options: opts.map((o, i) => `${letters[i]}. ${o}`),
            answer: letters[idx]
        };
    }
    if (type === 2) {
        return {
            type: 2,
            word,
            meaning: info.meaning || '',
            options: opts.map((o, i) => `${letters[i]}. ${o}`),
            answer: letters[idx]
        };
    }
    const lastBlank = context.lastIndexOf('___');
    return {
        type: 3,
        word,
        context: context.substring(0, lastBlank),
        suffix: context.substring(lastBlank + 3),
        options: opts.map((o, i) => `${letters[i]}. ${o}`),
        answer: letters[idx]
    };
}

async function generateQuiz(userId, level = null, mode = ASSESSMENT_MODE.REAL) {
    const markTiming = createQuizTimingLogger({
        enabled: process.env.WORDBOT_QUIZ_TIMING === '1',
    });
    const assessmentMode = normalizeAssessmentMode(mode);
    const requiredQuestionCount = 10;
    const cacheConfigured = Boolean(QUESTION_CACHE_TABLE);
    let effectiveLevel = level || null;
    const diagnostics = {
        cacheConfigured,
        cacheAttempted: false,
        level: effectiveLevel,
        readyCount: null,
        requiredCount: requiredQuestionCount,
        fallbackUsed: false,
        cacheReadLatencyMs: null,
        liveGenerationLatencyMs: null,
        testRecordWriteLatencyMs: null,
        cacheUsageWriteLatencyMs: null,
        cacheUsageWriteScheduled: false,
    };
    if (QUESTION_CACHE_TABLE && effectiveLevel) {
        diagnostics.cacheAttempted = true;
        const cacheReadStarted = Date.now();
        const cachedRows = await getQuestionCacheRecords();
        const cachedQuestions = selectReadyCachedQuestions({
            rows: cachedRows,
            userId,
            level: effectiveLevel,
            roundType: 'primary',
            limit: requiredQuestionCount,
        });
        diagnostics.cacheReadLatencyMs = Date.now() - cacheReadStarted;
        diagnostics.readyCount = cachedQuestions.length;
        markTiming('question-cache-read');
        if (cachedQuestions.length >= 10) {
            const testId = createAssessmentId(
                assessmentMode,
                () => crypto.randomUUID().split('-')[0]
            );
            const randomizedQuestions = secureRandom(cachedQuestions, requiredQuestionCount);
            const baseTestTime = Date.now();
            const testRecordWriteStarted = Date.now();
            await addRecords(TEST_TABLE, randomizedQuestions.map((q, index) => ({
                user: userId,
                test_id: testId,
                record_id: q.record_id,
                word: q.word,
                question_type: q.type,
                context: q.context,
                correct_answer: q.answer,
                options: JSON.stringify(q.options),
                test_time: baseTestTime + index,
                level: effectiveLevel || '',
                source: 'question_cache',
            })));
            diagnostics.testRecordWriteLatencyMs = Date.now() - testRecordWriteStarted;
            diagnostics.cacheUsageWriteScheduled = true;
            markQuestionCacheUsed(randomizedQuestions.map(q => q.cacheRecordId))
                .then(() => console.log('question cache usage marked count=' + randomizedQuestions.length))
                .catch(error => console.log('question cache usage mark failed: ' + error.message));
            markTiming('question-cache-hit');
            return {
                testId,
                mode: assessmentMode,
                level: effectiveLevel,
                source: 'question_cache',
                diagnostics,
                difficultyApplied: true,
                questions: randomizedQuestions.map(({ cacheRecordId, testId: _, record_id: __, ...q }) => q),
            };
        }
        if (!shouldAllowLiveQuizFallback({
            cacheConfigured: Boolean(QUESTION_CACHE_TABLE),
            flag: process.env.WORDBOT_ALLOW_LIVE_QUIZ_FALLBACK,
        })) {
            return {
                error: 'Question cache is still preparing. Please rebuild the question cache and try again.',
                code: 'QUESTION_CACHE_NOT_READY',
                source: 'question_cache',
                level: effectiveLevel,
                diagnostics: {
                    ...diagnostics,
                    fallbackUsed: false,
                },
                readyCount: cachedQuestions.length,
                requiredCount: requiredQuestionCount,
            };
        }
        diagnostics.fallbackUsed = true;
    }
    const liveGenerationStarted = Date.now();
    const wordRecords = await getRecords(WORD_TABLE);
    if (!effectiveLevel) {
        const userRecord = wordRecords.find(record => userMatches(record.fields.user, userId));
        effectiveLevel = buildLearningSettings({ userId, record: userRecord || null }).learningLevel;
        diagnostics.level = effectiveLevel;
    }
    markTiming('word-records');
    const { pool } = await getDistractorPool(wordRecords);
    const pendingBase = await getPendingWords(userId, wordRecords);
    const userAssessmentRecords = await getUserAssessmentRecords(userId).catch(e => {
        console.log(`user assessment records failed: ${e.message}`);
        return [];
    });
    markTiming('test-records');
    const masteredRecordIds = new Set(
        wordRecords
            .filter(record =>
                userMatches(record.fields.user, userId) &&
                isMasteredStatus(record.fields.Status)
            )
            .map(record => record.record_id)
    );
    const deferredRecordIds = new Set(getDeferredRecordIds(
        userAssessmentRecords,
        { userId, mode: assessmentMode, masteredRecordIds }
    ));
    const pending = prioritizePendingRecords(pendingBase, deferredRecordIds);

    const recent = await getRecentQuizFootprint(userId, 4, userAssessmentRecords).catch(e => {
        console.log(`recent quiz footprint failed: ${e.message}`);
        return { recordIds: new Set(), words: new Set() };
    });
    markTiming('recent-footprint');

    const validBase = pending.filter(r => {
        const info = pool[r.record_id];
        return info && (info.distractors || []).filter(d => d).length >= 3;
    });
    const reviewClean = validBase.filter(r => !r.quality_flags);
    const valid = reviewClean.length >= 2 ? reviewClean : validBase;

    if (valid.length < 2) {
        return { error: `Not enough valid questions (0)` };
    }

    const wordGroup = {};
    for (const rec of valid) {
        const w = rec.word.toLowerCase();
        if (!wordGroup[w]) wordGroup[w] = [];
        wordGroup[w].push(rec);
    }

    const isMultiDef = (rec) => {
        const m = rec.multi_definition;
        return m === OPT_MULTI_DEF_YES || (Array.isArray(m) && m.includes(OPT_MULTI_DEF_YES));
    };

    const multiDefGroups = Object.entries(wordGroup)
        .filter(([w, recs]) => recs.length >= 2 && recs.length <= 10 && isMultiDef(recs[0]));
    const freshMultiDefGroups = multiDefGroups.filter(([w, recs]) =>
        !recent.words.has(w) && recs.every(r => !recent.recordIds.has(r.record_id))
    );

    let questions = [];
    const usedRecordIds = new Set();
    const usedDistractors = new Set();
    const testId = createAssessmentId(
        assessmentMode,
        () => crypto.randomUUID().split('-')[0]
    );
    const letters = ['A', 'B', 'C', 'D'];
    const fallbackWords = valid
        .map(record => String(record.word || '').trim().toLowerCase())
        .filter(word => word && !isReservedTestWord(word));
    const buildFreshQuestion = (recordId, info, qType) => {
        const question = buildQuizQuestion(
            recordId,
            { ...info, fallbackDistractors: fallbackWords },
            qType,
            testId,
            letters,
            { excludedDistractors: [...usedDistractors] }
        );
        if (!question) return null;
        for (const option of question.options || []) {
            const optionWord = String(option).replace(/^[A-D]\.\s*/, '').trim().toLowerCase();
            if (optionWord && optionWord !== question.word.toLowerCase()) {
                usedDistractors.add(optionWord);
            }
        }
        return question;
    };

    const multiCandidates = freshMultiDefGroups.length > 0 ? freshMultiDefGroups : multiDefGroups;
    for (const [pickedWord, pickedRecs] of secureRandom(multiCandidates, multiCandidates.length)) {
        const multiQuestions = [];
        for (const rec of pickedRecs) {
            const info = pool[rec.record_id];
            const hasGoodCN = hasMeaningfulChineseMeaning(info.CN_Meaning);
            const qType = hasGoodCN ? 3 : (isContextUsableForWord(info.word, info.context) ? 1 : 2);
            const q = buildFreshQuestion(rec.record_id, info, qType);
            if (q) multiQuestions.push(q);
        }
        if (multiQuestions.length === pickedRecs.length) {
            console.log(`multi-definition quiz group word=${pickedWord} meanings=${pickedRecs.length}`);
            for (const q of multiQuestions) {
                questions.push(q);
                usedRecordIds.add(q.record_id);
            }
            break;
        }
    }

    const typeSlots = secureRandom([...Array(6).fill(1), ...Array(2).fill(2), ...Array(2).fill(3)], 10);
    const fallbackTypeSlots = [1, 2, 3];
    const remaining = valid.filter(r => !usedRecordIds.has(r.record_id));
    function candidatesForSlot(slot) {
        return remaining.filter(r => {
            if (usedRecordIds.has(r.record_id)) return false;
            const w = r.word.toLowerCase();
            if (questions.some(q => q.word.toLowerCase() === w)) return false;
            const info = pool[r.record_id];
            if (slot === 1) return isContextUsableForWord(info.word, info.context);
            if (slot === 2) return info.meaning?.trim();
            if (slot === 3) return hasMeaningfulChineseMeaning(info.CN_Meaning);
            return false;
        });
    }
    for (const slot of [...typeSlots, ...fallbackTypeSlots]) {
        if (questions.length >= 10) break;
        const candidates = candidatesForSlot(slot);
        if (candidates.length === 0) continue;
        const freshCandidates = candidates.filter(r =>
            !recent.recordIds.has(r.record_id) && !recent.words.has(r.word.toLowerCase())
        );
        const picked = secureRandom(freshCandidates.length > 0 ? freshCandidates : candidates, candidates.length);
        for (const rec of picked) {
            if (questions.length >= 10) break;
            const q = buildFreshQuestion(rec.record_id, pool[rec.record_id], slot);
            if (q) {
                questions.push(q);
                usedRecordIds.add(rec.record_id);
            }
        }
    }

    console.log(`quiz built total=${questions.length}, type1=${questions.filter(q=>q.type===1).length}, type2=${questions.filter(q=>q.type===2).length}, type3=${questions.filter(q=>q.type===3).length}`);

    // Run optional AI audit after local quiz construction.
    markTiming('local-build');
    if (shouldRunAiQuizAudit({
        enabled: process.env.WORDBOT_AI_QUIZ_AUDIT === '1',
        hasApiKey: Boolean(MINIMAX_API_KEY),
        questionCount: questions.length,
    })) {
        try {
            const validated = await validateAndFixQuiz(questions, pool, testId, letters);
            questions = validated.filter(q => q !== null);
        } catch (e) {
            console.error('AI audit failed:', e.message);
        }
        console.log('AI audit completed: questions=' + questions.length);
    }

    // Apply level-specific context rewriting with a hard timeout.
    markTiming('ai-audit');
    let difficultyApplied = !effectiveLevel;
    if (effectiveLevel && MINIMAX_API_KEY && questions.length > 0) {
        try {
            difficultyApplied = await Promise.race([
                adaptContextsByLevel(questions, effectiveLevel),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000)),
            ]);
            if (difficultyApplied) console.log(`difficulty rewrite applied level=${effectiveLevel}`);
        } catch (e) {
            console.error(`difficulty rewrite failed level=${effectiveLevel}: ${e.message}`);
        }
    }

    markTiming('difficulty-rewrite');
    normalizeQuizArticleContexts(questions);
    await enrichQuestionOptionMeanings({
        questions,
        records: wordRecords,
        translateWords: translateWordsToCN,
        updateRecord: (recordId, fields) => updateRecord(WORD_TABLE, recordId, fields),
    });
    markTiming('option-meanings');
    const randomizedQuestions = secureRandom(questions, questions.length);
    const baseTestTime = Date.now();
    const testRows = randomizedQuestions.map((q, index) => ({
            user: userId,
            test_id: testId,
            record_id: q.record_id,
            word: q.word,
            question_type: q.type,
            correct_answer: q.answer,
            options: JSON.stringify(q.options),
            test_time: baseTestTime + index,
            level: effectiveLevel || '',
            source: 'live_fallback',
    }));
    quizRecordWrites.stage(
        testId,
        addRecords(TEST_TABLE, testRows).catch(error => {
            console.log(`quiz record write failed testId=${testId}: ${error.message}`);
            throw error;
        })
    );

    markTiming('test-record-write-staged');
    diagnostics.liveGenerationLatencyMs = Date.now() - liveGenerationStarted;
    return {
        testId,
        mode: assessmentMode,
        level: effectiveLevel || null,
        source: 'live_generation',
        diagnostics,
        difficultyApplied,
        warning: effectiveLevel && !difficultyApplied ? 'AI difficulty adjustment was not applied.' : null,
        questions: randomizedQuestions.map(({ testId: _, record_id: __, ...q }) => q)
    };
}

async function validateAndFixQuiz(questions, pool, testId, letters) {
    const maxRounds = 2;
    let currentQuestions = [...questions];

    for (let round = 0; round < maxRounds; round++) {
        const ambiguousIdx = await checkQuizAmbiguity(currentQuestions);
        if (ambiguousIdx.length === 0) break;
        console.log('AI audit ambiguity round=' + (round + 1) + ' count=' + ambiguousIdx.length);

        for (const idx of ambiguousIdx) {
            const q = currentQuestions[idx];
            const info = pool[q.record_id];
            if (!info) continue;

            // Regenerate distractors only for questions the audit marked ambiguous.
            const betterDistrs = await generateBetterDistractors(q, info);
            if (betterDistrs && betterDistrs.length >= 3) {
                const rebuilt = buildQuizQuestion(q.record_id, {
                    ...info,
                    distractors: betterDistrs
                }, q.type, testId, letters);
                if (rebuilt) currentQuestions[idx] = rebuilt;
            }
        }
    }
    return currentQuestions;
}

async function checkQuizAmbiguity(questions) {
    const batchSize = 5;

    // Check ambiguity in small batches to keep MiniMax prompts short.
    const checks = [];
    for (let offset = 0; offset < questions.length; offset += batchSize) {
        const batch = questions.slice(offset, offset + batchSize);
        const quizText = batch.map((q, i) =>
            `Q${offset + i + 1}: ${q.context}  Correct:${q.answer}. ${q.options.join(' ')}`
        ).join('\n');

        checks.push((async () => {
            try {
                const r = await callMiniMaxAPI(
                    `For each question the correct answer is marked. Check if any WRONG option could also correctly answer the question. List Q numbers where wrong options also work. Return numbers only, comma-separated. None->empty.\n\n${quizText}`,
                    'MiniMax-M2.7', 60000
                );
                if (!r) return [];
                const nums = r.match(/\d+/g);
                return nums ? nums.map(Number) : [];
            } catch {
                return [];
            }
        })());
    }

    const results = await Promise.all(checks);
    const ambiguous = [...new Set(results.flat())];
    // convert 1-based to 0-based, filter valid
    return ambiguous.filter(i => i >= 1 && i <= questions.length).map(i => i - 1);
}

// Generate replacement distractors for ambiguous questions.


async function generateBetterDistractors(q, info) {
    const prompt = q.type === 1
        ? `Context: "${q.context}"
Correct word: "${info.word}"
Correct meaning: "${info.meaning || info.CN_Meaning || ''}"
The current wrong options also fit the blank, making the question ambiguous.
Generate 3 new wrong options that are COMPLETELY WRONG when put in this blank:
- Different meaning from "${info.word}"
- Different part of speech
- Obviously incorrect in context
Return JSON: {"distractors": ["word1", "word2", "word3"]}`
        : `Target: "${info.word}"
Meaning: "${info.meaning || q.context}"
Current wrong options are too close to the correct answer.
Generate 3 clearly different wrong options.
Return JSON: {"distractors": ["option1", "option2", "option3"]}`;

    try {
        const result = await callMiniMaxAPI(prompt, 'MiniMax-M2.7', 15000);
        if (!result) return null;
        const match = result.match(/"distractors"\s*:\s*\[(.*?)\]/s);
        if (!match) return null;
        const words = match[1].match(/"([^"]+)"/g);
        if (!words || words.length < 3) return null;
        return words.map(w => w.replace(/"/g, '').trim()).slice(0, 3);
    } catch (e) {
        return null;
    }
}

async function settleAnswers(testRecords, answers, userId, testId) {
    console.log(`settleAnswers: user=${userId}, testId=${testId}, records=${testRecords.length}`);
    const sortedRecords = [...testRecords].sort(
        (a, b) => Number(a.fields.test_time || 0) - Number(b.fields.test_time || 0)
    );

    let correct = 0;
    const results = [];
    const wordMap = {};

    const letters = ['A', 'B', 'C', 'D'];
    for (let i = 0; i < Math.min(sortedRecords.length, answers.length); i++) {
        const rec = sortedRecords[i];
        const submitted = normalizeSubmittedAnswer(answers[i]);
        const yourAnswerIdx = submitted.option;
        const yourAnswer = yourAnswerIdx !== null && yourAnswerIdx !== undefined ? letters[yourAnswerIdx] : null;
        const correctAnswer = rec.fields.correct_answer;
        console.log(`question ${i + 1} correctAnswer:`, JSON.stringify(correctAnswer));
        const answerStr = getFieldValue(correctAnswer);
        const isCorrect = yourAnswer === answerStr;
        if (isCorrect) correct++;

        const opts = rec.fields.options || [];
        const optsText = Array.isArray(opts) ? opts.join(' | ') : String(opts);
        await updateRecord(TEST_TABLE, rec.record_id, {
            your_answer: encodeAnswer(yourAnswer || '', submitted.confidence),
            is_correct: isCorrect ? [OPT_IS_CORRECT] : [OPT_IS_WRONG],
            options: optsText
        });

        const word = getFieldValue(rec.fields.word).toLowerCase();
        const recordId = getFieldValue(rec.fields.record_id);
        if (!wordMap[word]) {
            wordMap[word] = { correct: 0, total: 0, recordIds: [], wrongRecordIds: [], hasRecordIds: false };
        }
        wordMap[word].total++;
        if (isCorrect) wordMap[word].correct++;
        if (recordId) {
            wordMap[word].hasRecordIds = true;
            wordMap[word].recordIds.push(recordId);
            if (!isCorrect) wordMap[word].wrongRecordIds.push(recordId);
        }

        results.push({
            q: i + 1,
            word,
            recordId,
            your: yourAnswer,
            answer: answerStr,
            correct: isCorrect,
            confidence: submitted.confidence,
        });
    }

    const mode = getAssessmentMode(testId);
    if (!shouldAffectLearningState(testId)) {
        const currentStats = await getStats(userId);
        return {
            alreadySubmitted: false,
            mode,
            results,
            correct,
            total: results.length,
            accuracy: `${((correct / results.length) * 100).toFixed(1)}%`,
            masteredWords: [],
            stats: {
                total: currentStats.totalWords,
                mastered: currentStats.masteredWords,
                pending: currentStats.pendingWords,
            },
        };
    }

    const allWordRecords = await getRecords(WORD_TABLE);
    const wordRecords = allWordRecords.filter(r => userMatches(r.fields.user, userId));
    const rewardBeforeWordRecords = wordRecords.map(record => ({
        record_id: record.record_id,
        fields: { ...record.fields },
    }));
    const allTestRecords = await getRecords(TEST_TABLE);
    const userRealTests = filterAssessmentRecords(
        allTestRecords.filter(r => userMatches(r.fields.user, userId) && hasSubmittedAnswer(r)),
        ASSESSMENT_MODE.REAL
    );
    const masteredWords = [];
    const masteryProgress = {};

    for (const [word, currentStats] of Object.entries(wordMap)) {
        const meanings = wordRecords.filter(
            record => getFieldValue(record.fields.Word).toLowerCase() === word
        );
        const recordIds = meanings.map(record => record.record_id);
        const evaluation = evaluateWordMastery(recordIds, userRealTests, isCorrectField);
        masteryProgress[word] = evaluation;

        if (evaluation.mastered) {
            masteredWords.push(word);
            for (const meaning of meanings) {
                await updateRecord(WORD_TABLE, meaning.record_id, {
                    Status: STATUS_MASTERED,
                    remember_time: Date.now(),
                });
                meaning.fields.Status = STATUS_MASTERED;
            }
        } else if (currentStats.wrongRecordIds.length > 0) {
            for (const meaning of meanings) {
                const wasWrong = currentStats.wrongRecordIds.includes(meaning.record_id);
                const updateFields = { Status: STATUS_PENDING };
                if (wasWrong) {
                    updateFields.Error_Count = Number(meaning.fields?.Error_Count || 0) + 1;
                }
                await updateRecord(WORD_TABLE, meaning.record_id, updateFields);
                meaning.fields.Status = STATUS_PENDING;
            }
        }
    }

    const total = wordRecords.length;
    const mastered = wordRecords.filter(r => isMasteredStatus(r.fields.Status)).length;

    if (getAssessmentKind(testId) === ASSESSMENT_KIND.QUIZ) {
        const statsRecords = await getRecords(STATS_TABLE);
        const userRecord = statsRecords.find(r => userMatches(r.fields.user, userId));
        const statsFields = {
            user: userId,
            total_words: total,
            mastered_words: mastered,
            pending_words: total - mastered,
            total_tests: Number((userRecord?.fields?.total_tests || 0)) + 1,
            correct_count: Number((userRecord?.fields?.correct_count || 0)) + correct,
            last_test_time: Date.now()
        };

        if (userRecord) {
            await updateRecord(STATS_TABLE, userRecord.record_id, statsFields);
        } else {
            await addRecord(STATS_TABLE, statsFields);
        }
    }

    console.log('submitAnswers results:', JSON.stringify(results).substring(0, 500));
    const rewardSummary = createSubmitRewardSummary({
        userId,
        beforeRecords: rewardBeforeWordRecords,
        afterRecords: wordRecords,
    });
    return {
        alreadySubmitted: false,
        mode,
        results,
        correct,
        total: results.length,
        accuracy: `${((correct / results.length) * 100).toFixed(1)}%`,
        masteredWords,
        masteryProgress,
        gameReward: calculateGameReward({
            testId,
            mode,
            correct,
            total: results.length,
        }),
        rewardSummary,
        stats: { total, mastered, pending: total - mastered }
    };
}

async function loadQuizRecords(testId) {
    await quizRecordWrites.waitFor(testId);
    const filter = {
        conjunction: 'and',
        conditions: [
            { field_name: 'test_id', operator: 'is', value: [testId] }
        ]
    };
    const records = await searchRecords(TEST_TABLE, filter);
    return records.sort(
        (a, b) => Number(a.fields.test_time || 0) - Number(b.fields.test_time || 0)
    );
}

const submissionCoordinator = createSubmissionCoordinator({
    loadRecords: loadQuizRecords,
    isSubmitted: hasSubmittedAnswer,
    rebuildResult: async records => {
        const result = rebuildSubmittedResult(records, isCorrectField);
        const userId = getFieldValue(records[0]?.fields?.user);
        const stats = await getStats(userId);
        return {
            ...result,
            stats: {
                total: stats.totalWords,
                mastered: stats.masteredWords,
                pending: stats.pendingWords,
            },
        };
    },
    settle: settleAnswers,
});

async function submitAnswers(userId, testId, answers) {
    return submissionCoordinator.submit(userId, testId, answers);
}

async function rewriteReviewQuestion({ info, type }) {
    const field = type === 1 ? 'context' : type === 2 ? 'meaning' : 'CN_Meaning';
    const original = info[field] || '';
    if (type === 1 && info.word) {
        return {
            ...info,
            context: `During a fresh review exercise, the learner used ${info.word} to complete a meaningful practice sentence.`,
        };
    }
    if (type === 2 && info.meaning) {
        return {
            ...info,
            meaning: `A review clue for the same idea: ${info.meaning}`,
        };
    }
    if (type === 3 && info.CN_Meaning) {
        return {
            ...info,
            CN_Meaning: `${info.CN_Meaning} (review wording)`,  
        };
    }
    const prompt = `Rewrite this vocabulary review prompt with different wording.
Target word: "${info.word}"
Question type: ${type}
Original: "${original}"
Keep the same tested meaning. For type 1, include the target word in a natural sentence.
Return only the rewritten text.`;
    const rewritten = await callMiniMaxAPI(prompt, 'MiniMax-M2.7', 5000);
    if (!rewritten || rewritten.trim() === original.trim()) {
        throw new Error('Failed to rewrite review prompt');
    }
    return { ...info, [field]: rewritten.trim() };
}

async function generateReviewDistractors({ info, excludedDistractors }) {
    const key = String(info.word || '').trim().toLowerCase();
    const excluded = new Set([...excludedDistractors].map(word =>
        String(word || '').trim().toLowerCase()
    ));
    const local = [...new Set([
        ...(info.distractors || []),
        ...(info.fallbackDistractors || []),
    ]
        .map(word => String(word || '').trim().toLowerCase())
        .filter(word => word && word !== key && !excluded.has(word))
    )].slice(0, 3);
    if (local.length === 3) return local;

    const prompt = `Generate exactly 3 English wrong options for a vocabulary quiz.
Correct word: "${info.word}"
Meaning: "${info.meaning || info.CN_Meaning}"
Do not use: ${[...excludedDistractors].join(', ')}
The options must be unique and clearly wrong. Return JSON only:
{"distractors":["word1","word2","word3"]}`;
    const response = await callMiniMaxAPI(prompt, 'MiniMax-M2.7', 5000).catch(() => '');
    const match = response?.match(/\{[\s\S]*\}/);
    if (!match) return local;
    const parsed = JSON.parse(match[0]);
    const ai = Array.isArray(parsed.distractors) ? parsed.distractors : [];
    return [...new Set([
        ...local,
        ...ai.map(word => String(word || '').trim().toLowerCase()),
    ].filter(word => word && word !== key && !excluded.has(word)))].slice(0, 3);
}

const buildReviewQuestionCore = createReviewQuestionBuilder({
    buildQuizQuestion,
    rewriteContext: rewriteReviewQuestion,
    generateDistractors: generateReviewDistractors,
    chooseType: types => secureRandom(types, 1)[0],
    isContextUsableForWord,
});

const reviewService = createReviewService({
    createId: () => crypto.randomUUID().split('-')[0],
    loadAssessmentRecords: loadQuizRecords,
    loadReviewChainRecords: async sourceTestId => {
        const records = await getRecords(TEST_TABLE);
        return records.filter(record =>
            getFieldValue(record.fields.test_id) === sourceTestId ||
            getFieldValue(record.fields.source_test_id) === sourceTestId
        );
    },
    loadWordRecords: () => getRecords(WORD_TABLE),
    loadWordInfo: async (recordId, wordRecords = null) => {
        const records = wordRecords || await getRecords(WORD_TABLE);
        const { pool } = await getDistractorPool(records);
        const info = pool[recordId];
        if (!info) throw new Error('Word record not found for review generation');
        return {
            ...info,
            fallbackDistractors: [...new Set(
                Object.values(pool)
                    .map(record => String(record.word || '').trim().toLowerCase())
                    .filter(Boolean)
            )],
        };
    },
    buildReviewQuestion: async input => {
        const info = input.info || {};
        let correctMeaning = String(info.CN_Meaning || '').trim();
        if (!correctMeaning || hasAiMetaResponse(correctMeaning)) {
            const translated = await translateToCN(info.meaning || info.word).catch(() => '');
            if (translated && !hasAiMetaResponse(translated)) {
                correctMeaning = toSimp(translated).trim();
                if (correctMeaning && input.source?.recordId) {
                    updateRecord(WORD_TABLE, input.source.recordId, {
                        CN_Meaning: correctMeaning,
                    }).catch(error => {
                        console.log(`review meaning backfill failed record=${input.source.recordId}: ${error.message}`);
                    });
                }
            }
        }
        return {
            type: 4,
            answerMode: 'cn_meaning',
            word: info.word,
            context: '',
            options: [],
            correctMeaning,
            answer: undefined,
            record_id: input.source.recordId,
            testId: input.reviewId,
        };
    },
    addReviewRecords: rows => addRecords(TEST_TABLE, rows),
    updateReviewRecord: (rowId, fields) => updateRecord(TEST_TABLE, rowId, fields),
    submitAssessment: submitAnswers,
    isSubmitted: hasSubmittedAnswer,
    isCorrect: isCorrectField,
    fieldValue: getFieldValue,
});

async function createReviewRound(input) {
    return reviewService.createRound(input);
}

async function getActiveReviewRound(input) {
    return reviewService.getActiveRound(input);
}

async function submitReviewRound(input) {
    return reviewService.submitRound(input);
}

async function deferReviewRound(input) {
    return reviewService.deferRound(input);
}

async function getReviewSummary(input) {
    return reviewService.getSummary(input);
}

async function getStats(userId) {
    const wordRecords = (await getRecords(WORD_TABLE)).filter(r => userMatches(r.fields.user, userId));
    const total = wordRecords.length;
    const mastered = wordRecords.filter(r => isMasteredStatus(r.fields.Status)).length;

    // Stats are based on submitted real assessment records only.
    const allTestRecords = await getRecords(TEST_TABLE);
    const testRecords = filterAssessmentRecords(
        allTestRecords.filter(r => userMatches(r.fields.user, userId)),
        ASSESSMENT_MODE.REAL
    );
    const submittedRecords = testRecords.filter(hasSubmittedAnswer);
    const quizRecords = submittedRecords.filter(record =>
        getAssessmentKind(getFieldValue(record.fields.test_id)) === ASSESSMENT_KIND.QUIZ
    );
    const submittedTestIds = new Set(quizRecords.map(r => getFieldValue(r.fields.test_id)).filter(Boolean));
    const correctCount = quizRecords.filter(r => isCorrectField(r.fields.is_correct)).length;
    const totalQuestions = quizRecords.length;
    const lastTestTime = quizRecords.reduce((max, r) => {
        const time = Number(r.fields.test_time) || 0;
        return time > max ? time : max;
    }, 0);
    const acc = totalQuestions > 0 ? (correctCount / totalQuestions) * 100 : 0;

    return {
        user: userId,
        totalWords: total,
        masteredWords: mastered,
        pendingWords: total - mastered,
        totalTests: submittedTestIds.size,
        totalQuestions,
        correctCount,
        accuracyRate: `${acc.toFixed(1)}%`,
        lastTestTime: lastTestTime || null
    };
}

async function addWord(targetUser, wordData) {
    const { Word, Meaning, POS, Context } = wordData;
    if (!Word || !Meaning) {
        throw new Error('Word and meaning are required');
    }
    const fields = {
        user: targetUser,
        Word: toSimp(Word),
        Meaning: toSimp(Meaning),
        Status: 'Pending',
        record_time: Date.now()
    };
    if (POS) fields.POS = POS;
    if (Context) fields.Context = toSimp(Context);
    
    await addRecord(WORD_TABLE, fields);
    return { success: true, word: Word };
}

async function getAllUsers() {
    const records = await getRecords(WORD_TABLE);
    const userMap = new Map();
    for (const record of records) {
        const user = getFieldValue(record.fields.user);
        if (!user) continue;
        const key = normalizeUserKey(user);
        if (!userMap.has(key) || user === key) userMap.set(key, user);
    }
    return Array.from(userMap.values()).sort((a, b) => a.localeCompare(b));
}

async function getAllStats() {
    const users = await getAllUsers();
    const stats = [];
    for (const user of users) {
        const userStats = await getStats(user);
        stats.push(userStats);
    }
    return stats;
}

function resolveLearningSettings(userId, userRecord) {
    const current = buildLearningSettings({
        userId,
        record: userRecord || null,
    });
    const saved = learningSettingsOverlay.get(userId);
    if (!saved) return current;
    if (userRecord && current.levelChangedAt >= saved.levelChangedAt) return current;
    return saved;
}

async function getUserLearningSettings(userId) {
    const records = await getRecords(STATS_TABLE);
    const userRecord = findCanonicalUserRecord(records, userId);
    const canonicalUserId = getFieldValue(userRecord?.fields?.user) || userId;
    return resolveLearningSettings(canonicalUserId, userRecord || null);
}

async function writeLearningSettingsRecord(userRecord, updateFields) {
    try {
        if (userRecord) {
            return await updateRecord(STATS_TABLE, userRecord.record_id, updateFields, LEARNING_SETTINGS_WRITE_TIMEOUT_MS);
        }
        return await addRecord(STATS_TABLE, updateFields, LEARNING_SETTINGS_WRITE_TIMEOUT_MS);
    } catch (error) {
        if (!String(error?.message || '').includes('FieldNameNotFound')) throw error;
        learningSettingsFieldsReady = false;
        await ensureLearningSettingsFields();
        if (userRecord) {
            return updateRecord(STATS_TABLE, userRecord.record_id, updateFields, LEARNING_SETTINGS_WRITE_TIMEOUT_MS);
        }
        return addRecord(STATS_TABLE, updateFields, LEARNING_SETTINGS_WRITE_TIMEOUT_MS);
    }
}
async function updateUserLearningSettings(userId, requestedLevel) {
    const records = await getRecords(STATS_TABLE);
    const userRecord = findCanonicalUserRecord(records, userId);
    const canonicalUserId = getFieldValue(userRecord?.fields?.user) || userId;
    const hasPendingSettings = Boolean(learningSettingsOverlay.get(canonicalUserId));
    const current = resolveLearningSettings(canonicalUserId, userRecord || null);
    const change = validateLearningLevelChange({
        currentLevel: current.learningLevel,
        requestedLevel,
        lastChangedAt: current.levelChangedAt,
    });

    if (!change.ok) {
        return {
            success: false,
            error: change.reason,
            settings: {
                ...current,
                nextLevelChangeAt: change.nextLevelChangeAt,
                canChangeLevel: false,
            },
        };
    }

    const updateFields = change.unchanged
        ? { user: canonicalUserId, Learning_Level: change.learningLevel }
        : {
            user: canonicalUserId,
            Learning_Level: change.learningLevel,
            Level_Changed_At: Date.now(),
            Question_Cache_Status: 'building',
        };
    const settings = {
        userId: canonicalUserId,
        learningLevel: change.learningLevel,
        levelChangedAt: updateFields.Level_Changed_At || current.levelChangedAt,
        nextLevelChangeAt: change.nextLevelChangeAt,
        canChangeLevel: change.unchanged ? current.canChangeLevel : false,
        questionCacheStatus: change.unchanged ? current.questionCacheStatus : 'building',
    };

    if (!(change.unchanged && !userRecord && hasPendingSettings)) {
        await writeLearningSettingsRecord(userRecord, updateFields);
    }
    learningSettingsOverlay.set(canonicalUserId, settings);

    return {
        success: true,
        settings,
    };
}

async function getQuestionCacheStatus(userId) {
    const rows = (await getQuestionCacheRecords())
        .filter(record => userMatches(record.fields?.user, userId));
    return {
        configured: Boolean(QUESTION_CACHE_TABLE),
        ...summarizeCacheStatus(rows),
    };
}

function appendReadyCacheRows(rows, { userId, level, primaryQuestion, reviewQuestion, sourceVersion }) {
    const candidateRows = buildCacheRowsForRecord({
        userId,
        level,
        primaryQuestion,
        reviewQuestion,
        sourceVersion,
        now: Date.now(),
    });
    const [primaryRow, reviewRow] = candidateRows;
    if (isCacheQuestionReady(primaryRow) && isCacheQuestionReady(reviewRow)) {
        rows.push(...candidateRows);
        return true;
    }
    return false;
}

async function rebuildQuestionCacheForUser(userId) {
    if (!QUESTION_CACHE_TABLE) {
        return { configured: false, skipped: true, count: 0 };
    }
    const QUESTION_CACHE_REBUILD_FLUSH_SIZE = 10;
    async function flushQuestionCacheRows(bufferedRows, writtenRows) {
        if (!bufferedRows.length) return;
        const batch = bufferedRows.splice(0, bufferedRows.length);
        await addQuestionCacheRecords(batch);
        writtenRows.push(...batch);
    }

    const settings = await getUserLearningSettings(userId);
    const level = settings.learningLevel;
    const wordRecords = await getRecords(WORD_TABLE);
    const { pool } = await getDistractorPool(wordRecords);
    const pending = await getPendingWords(userId, wordRecords);
    const fallbackWords = pending
        .map(record => String(record.word || '').trim().toLowerCase())
        .filter(word => word && !isReservedTestWord(word));
    const letters = ['A', 'B', 'C', 'D'];
    const bufferedRows = [];
    const writtenRows = [];
    const PRIMARY_TYPE_QUOTA = [1,1,1,1,1,1,2,2,2,3];
    let wordIndex = 0;
    for (const rec of pending) {
        const info = pool[rec.record_id];
        if (!info) continue;
        const availableTypes = [
            ...(isContextUsableForWord(info.word, info.context) ? [1] : []),
            ...(info.meaning?.trim() ? [2] : []),
            ...(hasMeaningfulChineseMeaning(info.CN_Meaning) ? [3] : []),
        ];
        const preferred = PRIMARY_TYPE_QUOTA[wordIndex % PRIMARY_TYPE_QUOTA.length];
        const primaryType = availableTypes.includes(preferred) ? preferred : (availableTypes[0] || 1);
        wordIndex++;
        const reviewType = primaryType === 1
            ? (info.meaning?.trim() ? 2 : primaryType)
            : (isContextUsableForWord(info.word, info.context) ? 1 : primaryType);
        const baseInfo = { ...info, fallbackDistractors: fallbackWords };
        const primaryQuestion = buildQuizQuestion(
            rec.record_id,
            baseInfo,
            primaryType,
            'cache-primary',
            letters
        );
        const reviewQuestion = buildQuizQuestion(
            rec.record_id,
            baseInfo,
            reviewType,
            'cache-review',
            letters
        );
        if (!primaryQuestion || !reviewQuestion) continue;
        let cacheQuestions = [primaryQuestion, reviewQuestion];
        if (level && MINIMAX_API_KEY) {
            await adaptContextsByLevel(cacheQuestions, level);
        }
        if (shouldRunAiQuizAudit({
            enabled: process.env.WORDBOT_AI_QUIZ_AUDIT === '1',
            hasApiKey: Boolean(MINIMAX_API_KEY),
            questionCount: cacheQuestions.length,
        })) {
            cacheQuestions = (await validateAndFixQuiz(
                cacheQuestions,
                pool,
                'cache-quality',
                letters
            )).filter(Boolean);
        }
        if (cacheQuestions.length !== 2) continue;
        normalizeQuizArticleContexts(cacheQuestions);
        await enrichQuestionOptionMeanings({
            questions: cacheQuestions,
            records: wordRecords,
            translateWords: translateWordsToCN,
            updateRecord: (recordId, fields) => updateRecord(WORD_TABLE, recordId, fields),
        });
        appendReadyCacheRows(bufferedRows, {
            userId,
            level,
            primaryQuestion: cacheQuestions[0],
            reviewQuestion: cacheQuestions[1],
            sourceVersion: 'phase-2',
        });
        if (bufferedRows.length >= QUESTION_CACHE_REBUILD_FLUSH_SIZE) {
            await flushQuestionCacheRows(bufferedRows, writtenRows);
        }
    }
    await flushQuestionCacheRows(bufferedRows, writtenRows);
    return {
        configured: true,
        level,
        count: writtenRows.length,
        status: summarizeCacheStatus(writtenRows),
    };
}

async function validateWords(words) {
    const errors = [];
    const multiMeanings = [];
    const distPool = await getDistractorPool();
    
    for (const word of words) {
        const lowerWord = word.toLowerCase();
        if (!/^[a-z]+$/.test(lowerWord)) {
            errors.push(word);
            continue;
        }
        
        let meanings = [];
        
        const exists = distPool[lowerWord];
        if (exists && exists.meaning) {
            meanings = exists.meaning.split(',').map(m => m.trim()).filter(m => m);
        } else {
            const def = await fetchWordDefinition(word);
            if (def.meaning && def.meaning.includes(';')) {
                meanings = def.meaning.split(';').map(m => m.trim()).filter(m => m);
            } else if (def.meaning) {
                meanings = [def.meaning];
            }
        }
        
        if (meanings.length > 1) {
            multiMeanings.push({ word, meanings });
        }
    }
    
    return { errors, multiMeanings };
}

function requesthttp(url, timeout = 8000) {
    return new Promise((resolve, reject) => {
        const req = https.request(url, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
                catch { resolve(null); }
            });
        });
        req.on('error', reject);
        req.setTimeout(timeout, () => {
            req.destroy(new Error('request timeout'));
        });
        req.end();
    });
}

function generateDistractorsWithAI(word, meaning) {
    const prompt = [
        'Generate exactly 3 common English distractor words for a vocabulary quiz.',
        `Target word: ${word}.`,
        `Target meaning: ${meaning}.`,
        'Return only valid JSON with this exact shape: {"distractors":["word1","word2","word3"]}.',
        'Do not include the target word. Avoid synonyms or any word that could also match the target meaning.',
    ].join(' ');
    try {
        const escapedPrompt = prompt.replace(/"/g, '\\"');
        const result = execSync(`mmx text chat --message "${escapedPrompt}" --output json`, { encoding: 'utf8', timeout: 20000 });
        const textMatch = result.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (textMatch) {
            const innerJson = textMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
            const distMatch = innerJson.match(/"distractors"\s*:\s*\[(.*?)\]/s);
            if (distMatch) {
                const words = distMatch[1].match(/"([^"]+)"/g);
                if (words && words.length >= 3) {
                    return words.map(w => w.replace(/"/g, ''));
                }
            }
        }
    } catch (e) { }
    return null;
}

async function callMiniMaxAPI(prompt, model = 'MiniMax-M2.7', timeout = 15000) {
    return new Promise((resolve, reject) => {
        if (!MINIMAX_API_KEY) {
            reject(new Error('MINIMAX_API_KEY not set'));
            return;
        }
        const data = JSON.stringify({
            model: model,
            messages: [{ role: 'user', content: prompt }]
        });
        const options = {
            hostname: 'api.minimax.chat',
            path: '/v1/text/chatcompletion_v2',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${MINIMAX_API_KEY}`,
                'Content-Length': Buffer.byteLength(data)
            }
        };
        const req = https.request(options, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                try {
                    const result = JSON.parse(Buffer.concat(chunks).toString());
                    const content = result.choices?.[0]?.message?.content;
                    resolve(content);
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        const timer = setTimeout(() => {
            req.destroy();
            reject(new Error('timeout'));
        }, timeout);
        req.on('close', () => clearTimeout(timer));
        req.write(data);
        req.end();
    });
}

async function generateDistractorsWithContext(word, context) {
    const prompt = `Given the sentence: "${context}"
Target word: "${word}"
Generate 3 wrong distractors that:
1. Are grammatically correct in this sentence
2. Make the sentence sound natural but meaning wrong
3. Are NOT synonyms of "${word}"
Return JSON: {"distractors": ["word1", "word2", "word3"]}`;
    try {
        const result = await callMiniMaxAPI(prompt);
        if (result) {
            const match = result.match(/"distractors"\s*:\s*\[(.*?)\]/s);
            if (match) {
                const words = match[1].match(/"([^"]+)"/g);
                if (words && words.length >= 3) {
                    return words.map(w => w.replace(/"/g, '').trim());
                }
            }
        }
    } catch (e) { }
    return null;
}

async function generateDistractorsWithCollocation(word, context) {
    const prompt = `Sentence: "${context}"
Word: "${word}"
Generate 3 WRONG words by analyzing collocation keywords in the sentence.
The wrong words should create semantic confusion when substituted.
Return JSON: {"distractors": ["wrong1", "wrong2", "wrong3"]}`;
    try {
        const result = await callMiniMaxAPI(prompt);
        if (result) {
            const match = result.match(/"distractors"\s*:\s*\[(.*?)\]/s);
            if (match) {
                const words = match[1].match(/"([^"]+)"/g);
                if (words && words.length >= 3) {
                    return words.map(w => w.replace(/"/g, '').trim());
                }
            }
        }
    } catch (e) { }
    return null;
}

async function generateExampleWithAI(word, meaning) {
    const prompt = `Create one natural English vocabulary quiz sentence.
Target word: "${word}"
Meaning: "${meaning || ''}"
Rules:
1. Include the exact target word once.
2. Add concrete context clues so a learner can infer the meaning.
3. Do not use thin idioms or fixed phrases such as "It works like a charm".
4. Avoid generic sentences.
5. Keep it under 22 words.
Return JSON only: {"example": "sentence"}`;
    try {
        const result = await callMiniMaxAPI(prompt);
        if (result) {
            const match = result.match(/"example"\s*:\s*"([^"]+)"/);
            if (match && isContextUsableForWord(word, match[1])) return match[1];
        }
    } catch (e) { }
    return null;
}

async function translateToCN(text) {
    if (!text) return null;
    const prompt = `Translate the following English word or phrase to Simplified Chinese. Return ONLY the Chinese translation 闁?no explanations, no greetings, no extra text.\n\nEnglish: ${text}`;
    try {
        const result = await callMiniMaxAPI(prompt);
        if (!result) return null;
        const trimmed = result.trim();
        if (hasAiMetaResponse(trimmed)) return null;
        if (!/[\u4e00-\u9fff]/.test(trimmed)) return null;
        if (trimmed.length > 50) return null;
        return trimmed;
    } catch (e) { }
    return null;
}

async function translateWordsToCN(words) {
    if (!words.length) return {};
    const translations = {};
    const prompt = `Translate each English word to Simplified Chinese. Return ONLY a JSON object mapping each word to its Chinese translation. No explanations, no extra text.\n\nWords: ${JSON.stringify(words)}`;
    try {
        const result = await callMiniMaxAPI(prompt, 'MiniMax-M2.7', 30000);
        const match = result?.match(/\{[\s\S]*\}/);
        if (match) {
            const parsed = JSON.parse(match[0]);
            for (const word of words) {
                const meaning = String(parsed[word] || '').trim();
                if (meaning && hasMeaningfulChineseMeaning(meaning)) translations[word] = toSimp(meaning);
            }
        }
    } catch (e) { }

    const missingWords = words.filter(word => !translations[word]);
    for (const word of missingWords) {
        const definition = await fetchWordDefinition(word);
        const translated = await translateToCN(definition.meaning || word);
        if (translated) translations[word] = toSimp(translated);
    }
    return translations;
}

async function fetchWordDefinition(word) {
    try {
        const wordLower = word.toLowerCase();
        const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${wordLower}`;
        const data = await requesthttp(url);
        
        if (data && data[0]) {
            const entry = data[0];
            const meanings = [];
            let pos = 'n.';
            let example = '';
            
            for (const meaning of entry.meanings || []) {
                if (meaning.partOfSpeech) pos = meaning.partOfSpeech;
                for (const def of meaning.definitions || []) {
                    meanings.push(def.definition);
                    if (def.example && !example) {
                        example = def.example.replace(/"/g, '');
                    }
                }
            }
            
            const meaningStr = meanings.slice(0, 3).join('; ');
            
            return {
                meaning: toSimp(meaningStr || word),
                pos: toSimp(pos),
                context: example ? example : '',
                rawContext: example || ''
            };
        }
    } catch (e) { }
    
    try {
        const wordLower = word.toLowerCase();
        const encoded = encodeURIComponent(wordLower);
        const url = `https://api.mymemory.translated.net/get?q=${encoded}&langpair=en|zht`;
        const data = await requesthttp(url);
        
        if (data && data.responseStatus === 200) {
            const translation = data.responseData?.translatedText || '';
            return {
                meaning: toSimp(translation || word),
                pos: toSimp('n.'),
                context: toSimp(`The word "${word}" is used in context.`)
            };
        }
    } catch (e) { }
    
    return {
        meaning: toSimp(word),
        pos: toSimp('n.'),
        context: toSimp(`The word "${word}" is used in context.`)
    };
}

function pickFallbackDistractors(word, allWords) {
    const lowerWord = word.toLowerCase();
    const candidates = [...allWords];
    const fallback = [];
    while (fallback.length < 3 && candidates.length > 0) {
        const idx = crypto.randomInt(0, candidates.length);
        const candidate = candidates[idx];
        if (candidate !== lowerWord && !fallback.includes(candidate)) {
            fallback.push(candidate);
        }
        candidates.splice(idx, 1);
    }
    return fallback;
}

async function prepareWordFields(targetUser, word, fallbackWords) {
    const def = await fetchWordDefinition(word);
    let distractors = null;
    let example = isContextUsableForWord(word, def.context) ? def.context : '';
    let cnMeaning = '';

    if (!example) {
        example = await generateExampleWithAI(word, def.meaning) || '';
    }

    if (example) {
        distractors = await generateDistractorsWithContext(word, example);
    }

    if (!distractors || distractors.length < 3) {
        if (example) {
            distractors = await generateDistractorsWithCollocation(word, example);
        }
    }

    if (!distractors || distractors.length < 3) {
        const fallback = pickFallbackDistractors(word, fallbackWords);
        if (distractors) {
            distractors = [...distractors, ...fallback].slice(0, 3);
        } else {
            distractors = fallback;
        }
    }

    cnMeaning = await translateToCN(def.meaning);
    if (!cnMeaning) {
        cnMeaning = '';
    }

    const wordFields = {
        user: targetUser,
        Word: toSimp(word),
        Meaning: def.meaning,
        CN_Meaning: cnMeaning || '',
        Distractors: Array.isArray(distractors) ? distractors.join(',') : '',
        Status: 'Pending',
        record_time: Date.now()
    };
    if (def.pos) wordFields.POS = def.pos;
    if (example) wordFields.Context = example;

    return { wordFields, distractors, cnMeaning };
}

async function addWords(targetUser, words) {
    console.log('addWords request:', targetUser, words);
    let count = 0;
    const errors = [];
    const { pool: distPool } = await getDistractorPool();
    const fallbackWords = [...new Set(Object.values(distPool).map(r => r.word?.toLowerCase()).filter(Boolean))];

    const prepared = await Promise.all(words.map(async word => {
        try {
            return { word, ok: true, ...(await prepareWordFields(targetUser, word, fallbackWords)) };
        } catch (e) {
            console.log(`闁告垵妫楅ˇ顒佸緞鏉堫偉袝 ${word}: ${e.message}`);
            return { word, ok: false, error: `${word}: ${e.message}` };
        }
    }));

    for (const item of prepared) {
        if (!item.ok) {
            errors.push(item.error);
            continue;
        }
        try {
            await addRecord(WORD_TABLE, item.wordFields);
            count++;
            console.log(`闁瑰瓨鍔曟慨娑㈠礃濞嗗繐寮? ${item.word}, 妤犵偛寮舵竟鍫㈡嫚? ${item.distractors.join(', ')}, 濞戞搩鍘介弸? ${item.cnMeaning?.substring(0, 15)}...`);
        } catch (e) {
            console.log(`闁告劖鐟ラ崣鍡樺緞鏉堫偉袝 ${item.word}: ${e.message}`);
            errors.push(`${item.word}: ${e.message}`);
        }
    }
    
    if (count > 0) {
        rebuildQuestionCacheForUser(targetUser).catch(() => {});
    }

    if (errors.length > 0) {
        return { count, errors, error: `闂侇喓鍔岄崹搴ㄥ础閺囷紕妲ゆ繛锝堫嚙婵偞寰勬潏顐バ? ${errors.join('; ')}` };
    }
    
    return { count, success: true };
}

async function updateMultiDefinition(targetUser, words) {
    console.log('updateMultiDefinition called:', targetUser, words);
    const records = await getRecords(WORD_TABLE);
    console.log('getAllStats records', records.length);
    const userRecords = records.filter(r => userMatches(r.fields.user, targetUser) && words.includes(r.fields.Word));
    console.log('getAllStats user records', userRecords.length);
    for (const record of userRecords) {
        console.log('getAllStats user record', record.record_id, record.fields.Word);
        await updateRecord(WORD_TABLE, record.record_id, { multi_definition: [OPT_MULTI_DEF_YES] });
    }
}

async function getWord(userId, word) {
    const records = await getRecords(WORD_TABLE);
    const record = records.find(r => userMatches(r.fields.user, userId) && r.fields.Word?.toLowerCase() === word.toLowerCase());
    if (!record) return null;
    return {
        word: record.fields.Word,
        meaning: record.fields.Meaning || '',
        cnMeaning: record.fields.CN_Meaning || '',
        pos: record.fields.POS || '',
        context: record.fields.Context || '',
        distractors: record.fields.Distractors || '',
        status: record.fields.Status || 'Pending',
        qualityFlags: record.fields.Quality_Flags || '',
        qualityNote: record.fields.Quality_Note || '',
        record_id: record.record_id
    };
}

function mapWordRecord(record) {
    return {
        word: record.fields.Word || '',
        meaning: record.fields.Meaning || '',
        cnMeaning: record.fields.CN_Meaning || '',
        pos: record.fields.POS || '',
        context: record.fields.Context || '',
        distractors: record.fields.Distractors || '',
        status: record.fields.Status || 'Pending',
        qualityFlags: record.fields.Quality_Flags || '',
        qualityNote: record.fields.Quality_Note || '',
        user: record.fields.user || '',
        record_id: record.record_id
    };
}

async function getWordByRecordId(recordId) {
    const records = await getRecords(WORD_TABLE);
    const record = records.find(r => r.record_id === recordId);
    return record ? mapWordRecord(record) : null;
}

async function updateWord(userId, word, fields) {
    const records = await getRecords(WORD_TABLE);
    const record = fields.recordId
        ? records.find(r => r.record_id === fields.recordId && (!userId || userMatches(r.fields.user, userId)))
        : records.find(r => userMatches(r.fields.user, userId) && r.fields.Word?.toLowerCase() === word.toLowerCase());
    if (!record) return { error: 'Word not found' };
    const updateFields = {};
    if (fields.word !== undefined) updateFields.Word = fields.word;
    if (fields.meaning !== undefined) updateFields.Meaning = fields.meaning;
    if (fields.cnMeaning !== undefined) updateFields.CN_Meaning = fields.cnMeaning;
    if (fields.pos !== undefined) updateFields.POS = fields.pos;
    if (fields.context !== undefined) updateFields.Context = fields.context;
    if (fields.distractors !== undefined) updateFields.Distractors = fields.distractors;
    if (fields.status !== undefined) updateFields.Status = fields.status;
    if (fields.qualityFlags !== undefined) updateFields.Quality_Flags = fields.qualityFlags;
    if (fields.qualityNote !== undefined) updateFields.Quality_Note = fields.qualityNote;
    await updateRecord(WORD_TABLE, record.record_id, updateFields);
    return { success: true };
}

async function getReviewWords(userId) {
    const records = await getRecords(WORD_TABLE);
    return records
        .filter(r => !userId || userMatches(r.fields.user, userId))
        .filter(r => getFieldValue(r.fields.Quality_Flags).trim() || getFieldValue(r.fields.Quality_Note).trim())
        .filter(r => !isMasteredStatus(r.fields.Status))
        .map(mapWordRecord);
}

async function markWordForReview(recordId, flags, note) {
    await updateRecord(WORD_TABLE, recordId, {
        Quality_Flags: flags || 'manual_review',
        Quality_Note: note || ''
    });
    return { success: true };
}

async function clearWordReview(recordId) {
    await updateRecord(WORD_TABLE, recordId, {
        Quality_Flags: '',
        Quality_Note: ''
    });
    return { success: true };
}

async function rebuildUserWordStatus(userId) {
    // Recalculate status from current word and assessment records.
    const allWords = await getRecords(WORD_TABLE);
    const userWords = allWords.filter(r => userMatches(r.fields?.user, userId));
    const testRecords = await getRecords(TEST_TABLE);
    const userTests = testRecords.filter(r => userMatches(r.fields?.user, userId));

    // Count submitted real-test answers by word.
    const wordCorrectMap = {};
    for (const t of userTests) {
        const word = getFieldValue(t.fields?.word);
        const isCorrect = getFieldValue(t.fields?.is_correct);
        if (!word) continue;
        if (!wordCorrectMap[word]) wordCorrectMap[word] = { correct: 0, total: 0 };
        wordCorrectMap[word].total++;
        if (isCorrect === 'optHGT7gYf' || isCorrect === '\u6b63\u786e' || isCorrect === true || isCorrect === 'true') {
            wordCorrectMap[word].correct++;
        }
    }

    let updated = 0;
    for (const wordRecord of userWords) {
        const word = getFieldValue(wordRecord.fields?.Word);
        if (!word) continue;
        const stats = wordCorrectMap[word];
        const newStatus = (stats && stats.correct > 0) ? 'Mastered' : 'Pending';
        const currentStatus = getFieldValue(wordRecord.fields?.Status);
        if (currentStatus !== newStatus) {
            const updateFields = { Status: newStatus };
            if (newStatus === 'Mastered') {
                updateFields.remember_time = Date.now();
            }
            await updateRecord(WORD_TABLE, wordRecord.record_id, updateFields);
            updated++;
        }
    }
    console.log(`rebuildUserWordStatus: user= updated=`);
    return updated;
}

async function deleteUserTestData(userId, days = null) {
    // Delete generated test records for a user, optionally limited by age.
    const testRecords = await getRecords(TEST_TABLE);
    let userTests = testRecords.filter(r => {
        const belongsToUser = userMatches(r.fields?.user, userId);
        return belongsToUser && isTestAssessment(getFieldValue(r.fields?.test_id));
    });

    // Apply optional age filter before deleting records.
    if (days !== null && days > 0) {
        cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;
        const beforeCount = userTests.length;
        userTests = userTests.filter(r => {
            const t = r.fields?.test_time;
            return t && t >= cutoffTime;
        });
        console.log(`deleteUserTestData: user= before= days= selected=`);
    } else {
        console.log(`deleteUserTestData: user= selected=`);
    }

    if (userTests.length === 0) {
        return { success: true, deleted: 0, rebuilt: 0 };
    }

    const token = await getToken();
    const recordIds = userTests.map(r => r.record_id);
    let deleted = 0;

    for (let i = 0; i < recordIds.length; i += 500) {
        const batch = recordIds.slice(i, i + 500);
        await new Promise((resolve, reject) => {
            const body = JSON.stringify({ records: batch });
            const req = https.request({
                hostname: 'open.feishu.cn',
                path: `/open-apis/bitable/v1/apps/${TEST_TABLE.appToken}/tables/${TEST_TABLE.tableId}/records/batch_delete`,
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Content-Type': 'application/json'
                }
            }, (res) => {
                const chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => {
                    const result = JSON.parse(Buffer.concat(chunks).toString());
                    console.log(`batch_delete result: code=${result.code}, msg=${result.msg}, deleted_in_batch=${batch.length}`);
                    if (result.code === 0) deleted += batch.length;
                    else console.error(`batch_delete failed:`, JSON.stringify(result));
                    resolve(result);
                });
            });
            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }

    console.log('deleteUserTestData: user=' + userId + ' deleted=' + deleted);
    return { success: true, deleted, rebuilt: 0 };
}

async function rebuildUserStats(userId) {
    const testRecords = await getRecords(TEST_TABLE);
    const userTests = testRecords.filter(r => {
        const belongsToUser = userMatches(r.fields?.user, userId);
        return belongsToUser && isRealAssessment(getFieldValue(r.fields?.test_id));
    });

    // Count completed real assessment records.
    let correctCount = 0;
    let totalQuestions = 0;
    let lastTestTime = null;

    for (const t of userTests) {
        const testId = getFieldValue(t.fields?.test_id);
        const isCorrect = getFieldValue(t.fields?.is_correct);
        const time = t.fields?.test_time;

        if (testId) testIds.add(testId);
        totalQuestions++;
        if (isCorrect === 'optHGT7gYf' || isCorrect === '\u6b63\u786e' || isCorrect === true || isCorrect === 'true') {
            correctCount++;
        }
        if (time && (!lastTestTime || time > lastTestTime)) {
            lastTestTime = time;
        }
    }

    const accuracyRate = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

    // Sync aggregate stats rows for this user.
    const statsRecords = await getRecords(STATS_TABLE);
    const userStats = statsRecords.filter(r => userMatches(r.fields?.user, userId));

    for (const stat of userStats) {
        await updateRecord(STATS_TABLE, stat.record_id, {
            total_tests: testIds.size,
            correct_count: correctCount,
            accuracy_rate: accuracyRate,
            last_test_time: lastTestTime || null
        });
        console.log(`rebuildUserStats user=${userId} totalQuestions=${totalQuestions} accuracy=${accuracyRate}%`);
    }
}

async function deleteWord(userId, word) {
    const records = await getRecords(WORD_TABLE);
    const record = records.find(r => userMatches(r.fields.user, userId) && r.fields.Word?.toLowerCase() === word.toLowerCase());
    if (!record) return { error: 'Word not found' };
    const token = await getToken();
    await new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'open.feishu.cn',
            path: `/open-apis/bitable/v1/apps/${WORD_TABLE.appToken}/tables/${WORD_TABLE.tableId}/records/${record.record_id}`,
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
        }, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
        });
        req.on('error', reject);
        req.end();
    });
    return { success: true };
}

module.exports = { registerUser, loginUser, requestAuthOtp, loginWithOtp, verifyParentOtp, generateQuiz, submitAnswers, createReviewRound, getActiveReviewRound, submitReviewRound, deferReviewRound, getReviewSummary, getStats, addWord, getAllUsers, getAllStats, getUserLearningSettings, updateUserLearningSettings, getQuestionCacheStatus, rebuildQuestionCacheForUser, deleteQuestionCacheRows, validateWords, addWords, updateMultiDefinition, getWord, updateWord, deleteWord, deleteUserTestData, getWordByRecordId, getReviewWords, markWordForReview, clearWordReview, searchRecords, getRecords, updateRecord, getToken };
