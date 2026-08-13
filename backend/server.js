require('./startup-env');

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { createSessionStore, normalizeUser } = require('./session-auth');
const { requireAdminToken, requireUserSession, setSessionCookie, sessionStore } = require('./auth-middleware');
const { TEST_TABLE, WORD_TABLE, OPTION_IDS, registerUser, loginUser, verifyParentLogin, setParentCredentials, resetChildPassword, generateQuiz, submitAnswers, getActiveFormalQuizChallenge, updateQuizSessionProgress, prebuildWrongQuestionCache, createReviewRound, getActiveReviewRound, submitReviewRound, deferReviewRound, getReviewSummary, getStats, getAssessmentsForUser, addWord, getAllUsers, getAllStats, getUserLearningSettings, updateUserLearningSettings, getQuestionCacheStatus, getQuestionCacheDiagnostics, rebuildQuestionCacheForUser, deleteQuestionCacheRows, validateWords, addWords, updateMultiDefinition, getWord, updateWord, deleteWord, deleteUserTestData, getWordByRecordId, listUserWords, getReviewWords, markWordForReview, clearWordReview, searchRecords, getRecords, getQuizHistory, backfillTranslations } = require('./data-source');
const { createApp } = require('./http-app');
const { getQuestionGenerationWorkerHealth, getRuntimeHealth } = require('./runtime-health');
const {
    ASSESSMENT_MODE,
    filterAssessmentRecords,
    getAssessmentMode,
    normalizeAssessmentMode,
} = require('./assessment-mode');
const { parseStoredAnswer } = require('./mastery-evidence');
const supabase = require('./supabase-client');

function createDefaultQuestionGenerationRuntime(options) {
    return require('./question-generation-bootstrap').createDefaultQuestionGenerationRuntime(options);
}

const getFieldVal = (v) => {
    if (!v) return '';
    if (typeof v === 'object') {
        if (Array.isArray(v)) return v.length > 0 ? getFieldVal(v[0]) : '';
        if (v.text !== undefined) return v.text;
        if (v.name !== undefined) return v.name;
        return JSON.stringify(v);
    }
    if (typeof v === 'string') {
        try {
            const parsed = JSON.parse(v);
            if (Array.isArray(parsed)) return parsed.length > 0 ? getFieldVal(parsed[0]) : '';
            if (parsed.text !== undefined) return parsed.text;
            if (parsed.name !== undefined) return parsed.name;
            return String(parsed);
        } catch (e) {}
        return v;
    }
    return String(v);
};

const normalizeUserKey = (value) => String(getFieldVal(value) || '').trim().toLowerCase();
const sameUser = (left, right) => {
    const a = normalizeUserKey(left);
    const b = normalizeUserKey(right);
    return Boolean(a && b && a === b);
};

const parseOptions = (v) => {
    if (!v) return [];
    if (Array.isArray(v)) return v.map(getFieldVal).filter(Boolean);
    const raw = typeof v === 'string' ? v.trim() : getFieldVal(v).trim();
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.map(getFieldVal).filter(Boolean);
        if (typeof parsed === 'string') return parseOptions(parsed);
    } catch (e) {}
    return raw.split(/\n|,/).map(s => s.trim()).filter(Boolean);
};


const questionCacheRebuildJobs = new Map();
const DEFAULT_ACTIVE_REBUILD_USERS = ['Draggy', 'qiuqiu', 'test_user', 'yusi'];

function getActiveRebuildUsers(allUsers) {
    const configured = String(process.env.WORDBOT_ACTIVE_USERS || '')
        .split(',')
        .map(user => user.trim())
        .filter(Boolean);
    const allowed = new Set((configured.length ? configured : DEFAULT_ACTIVE_REBUILD_USERS).map(normalizeUserKey));
    return allUsers.filter(user => allowed.has(normalizeUserKey(user)));
}


function getCacheReadyCountForLevel(status, level) {
    return Number(status?.byLevel?.[level]?.ready || 0);
}

function questionCacheJobKey(userId) {
    return normalizeUserKey(userId) || String(userId || '');
}

function startQuestionCacheRebuild(userId) {
    const jobKey = questionCacheJobKey(userId);
    const current = questionCacheRebuildJobs.get(jobKey);
    if (current?.status === 'running') {
        return { started: false, alreadyRunning: true, userId, startedAt: current.startedAt };
    }
    const job = { status: 'running', startedAt: Date.now() };
    questionCacheRebuildJobs.set(jobKey, job);
    rebuildQuestionCacheForUser(userId)
        .then(result => {
            questionCacheRebuildJobs.set(jobKey, {
                ...job,
                status: 'completed',
                finishedAt: Date.now(),
                result,
            });
            console.log(`question cache rebuild completed user=${userId} count=${result?.count ?? 0}`);
        })
        .catch(error => {
            questionCacheRebuildJobs.set(jobKey, {
                ...job,
                status: 'failed',
                finishedAt: Date.now(),
                error: error.message,
            });
            console.error(`question cache rebuild failed user=${userId}: ${error.message}`);
        });
    return { started: true, userId, startedAt: job.startedAt };
}
// sessionStore 和 setSessionCookie 已从 auth-middleware 导入，无需重复声明

function requestedUser(req) {
    return normalizeUser(req.body?.userId || req.body?.targetUser || req.query?.userId || req.query?.user || '');
}

const ADMIN_TOKEN_PROTECTED_PATHS = new Set(['/users', '/stats', '/questionCache/rebuildAll', '/questionCache/rebuildAll/status', '/questionCache/diagnostics', '/reviewWords', '/reviewWords/mark', '/reviewWords/clear', '/cleanup', '/backfill', '/backfill/status']);
function tokensMatch(left, right) {
    const a = Buffer.from(String(left || ''));
    const b = Buffer.from(String(right || ''));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireServerAdminToken(req, res, next) {
    const configured = String(process.env.WORDBOT_ADMIN_TOKEN || '');
    if (!configured && process.env.NODE_ENV !== 'production') return next();
    if (!configured) return res.status(503).json({ error: 'Admin token is not configured' });
    if (!tokensMatch(configured, req.get('x-wordbot-admin-token'))) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    return next();
}

function assessmentDiagnosticField(row, key) {
    return row?.[key] !== undefined ? row[key] : row?.fields?.[key];
}

// 使用统一的 auth-middleware 中的 requireAdminToken 和 requireUserSession
// 保留此处的 tokensMatch 函数用于兼容性
const questionGenerationServerStates = new WeakMap();
const QUESTION_GENERATION_HEALTH_PAGE_SIZE = 1000;
const CLAIMABLE_JOB_STATUSES = new Set(['pending', 'retry_wait']);
const LEASED_JOB_STATUSES = new Set(['generating', 'validating', 'repairing']);
const VALID_GENERATION_WORD = /^[a-z]+([ '-][a-z]+)*$/i;

function throwHealthQueryError(error) {
    if (error) throw new Error('QUESTION_GENERATION_HEALTH_QUERY_FAILED');
}

async function loadHealthRowsById(queryFactory) {
    const rows = [];
    let cursor = '';
    while (true) {
        let query = queryFactory();
        if (cursor) query = query.gt('id', cursor);
        const { data, error } = await query.order('id', { ascending: true }).limit(QUESTION_GENERATION_HEALTH_PAGE_SIZE);
        throwHealthQueryError(error);
        const page = Array.isArray(data) ? data : [];
        rows.push(...page);
        if (page.length < QUESTION_GENERATION_HEALTH_PAGE_SIZE) break;
        const nextCursor = String(page[page.length - 1]?.id || '');
        if (!nextCursor || nextCursor === cursor) throw new Error('QUESTION_GENERATION_HEALTH_PAGINATION_FAILED');
        cursor = nextCursor;
    }
    return rows;
}

function isDueUnderClaimRules(job, nowMs) {
    const status = String(job?.status || '');
    if (CLAIMABLE_JOB_STATUSES.has(status)) {
        const nextAttemptMs = Date.parse(String(job?.next_attempt_at || ''));
        return Number.isFinite(nextAttemptMs) && nextAttemptMs <= nowMs;
    }
    if (!LEASED_JOB_STATUSES.has(status)) return false;
    if (job?.lease_expires_at === null || job?.lease_expires_at === undefined || job?.lease_expires_at === '') return true;
    const leaseExpiresMs = Date.parse(String(job.lease_expires_at));
    return Number.isFinite(leaseExpiresMs) && leaseExpiresMs <= nowMs;
}

function isWordEligibleForJob(word, job) {
    if (!word || String(word.id) !== String(job?.word_id)) return false;
    if (String(word.user_id) !== String(job?.user_id)) return false;
    if (String(word.question_generation_version) !== String(job?.word_version)) return false;
    if (word.mastery_status === null || word.mastery_status === undefined || word.mastery_status === 'mastered') return false;
    const spelling = String(word.word || '').replace(/^ +| +$/g, '');
    const spellingMatch = spelling.match(VALID_GENERATION_WORD);
    return spelling.toLowerCase() !== 'genaine' && spellingMatch?.[0] === spelling;
}

function createQuestionGenerationEligibleDueCounter({ client = supabase, now = () => new Date().toISOString() } = {}) {
    return async function countQuestionGenerationEligibleDueJobs() {
        const nowValue = now();
        const nowMs = Date.parse(String(nowValue || ''));
        if (!Number.isFinite(nowMs)) throw new Error('QUESTION_GENERATION_HEALTH_CLOCK_INVALID');
        const nowIso = new Date(nowMs).toISOString();
        const dueFilter = [
            `and(status.in.(pending,retry_wait),next_attempt_at.lte.${nowIso})`,
            `and(status.in.(generating,validating,repairing),or(lease_expires_at.is.null,lease_expires_at.lte.${nowIso}))`,
        ].join(',');
        const candidateJobs = await loadHealthRowsById(() => client
            .from('question_generation_jobs')
            .select('id,user_id,word_id,word_version,status,next_attempt_at,lease_expires_at')
            .or(dueFilter));
        const dueJobs = candidateJobs.filter(job => isDueUnderClaimRules(job, nowMs));
        if (dueJobs.length === 0) return 0;

        const wordIds = [...new Set(dueJobs.map(job => String(job.word_id || '')).filter(Boolean))];
        const words = [];
        for (let offset = 0; offset < wordIds.length; offset += QUESTION_GENERATION_HEALTH_PAGE_SIZE) {
            const ids = wordIds.slice(offset, offset + QUESTION_GENERATION_HEALTH_PAGE_SIZE);
            const { data, error } = await client
                .from('words')
                .select('id,user_id,question_generation_version,mastery_status,word')
                .in('id', ids)
                .order('id', { ascending: true })
                .limit(QUESTION_GENERATION_HEALTH_PAGE_SIZE);
            throwHealthQueryError(error);
            words.push(...(Array.isArray(data) ? data : []));
        }
        const wordsById = new Map(words.map(word => [String(word.id), word]));
        return dueJobs.reduce((count, job) => (
            count + (isWordEligibleForJob(wordsById.get(String(job.word_id)), job) ? 1 : 0)
        ), 0);
    };
}

async function getServerRuntimeHealth(state) {
    const health = getRuntimeHealth();
    const runtime = state?.runtime || null;
    let database = { ok: true };
    if (health.dataSource === 'supabase' && process.env.SUPABASE_URL) {
        try {
            const probes = await Promise.all([
                supabase.from('users').select('id').limit(1),
                supabase.from('question_generation_jobs').select('id').limit(1),
            ]);
            const failed = probes.find(result => result?.error);
            if (failed?.error) database = { ok: false, error: failed.error.message };
            else database = { ok: true };
        } catch (error) {
            database = { ok: false, error: error.message };
        }
    }
    let eligibleDueCount = 'unknown';
    if (state?.workerConfigured && typeof state.getQuestionGenerationEligibleDueCount === 'function') {
        try {
            eligibleDueCount = await state.getQuestionGenerationEligibleDueCount();
        } catch (_) {
            eligibleDueCount = 'unknown';
        }
    }
    const observed = typeof runtime?.worker?.getObservability === 'function'
        ? runtime.worker.getObservability()
        : {};
    const workerHealth = getQuestionGenerationWorkerHealth({
        configured: state
            ? state.workerConfigured
            : String(process.env.DATA_SOURCE || 'supabase').toLowerCase() !== 'feishu',
        running: Boolean(runtime?.worker?.isRunning()),
        lastError: state?.workerLastError || '',
        startedAt: observed.startedAt || state?.workerStartedAt,
        lastAttemptAt: observed.lastAttemptAt || state?.workerLastAttemptAt,
        lastClaimAt: observed.lastClaimAt || state?.workerLastClaimAt,
        lastSuccessAt: observed.lastSuccessAt || state?.workerLastSuccessAt,
        lastCompletionAt: observed.lastCompletionAt || state?.workerLastCompletionAt,
        eligibleDueCount,
        now: state?.workerHealthNow?.() || new Date().toISOString(),
        stallAfterMs: state?.workerStallAfterMs,
    });
    return {
        ...health,
        ok: health.ok && database.ok && workerHealth.ok,
        database,
        questionGenerationWorker: workerHealth,
    };
}

function stopServerWorker(server) {
    const state = questionGenerationServerStates.get(server);
    const worker = state?.runtime?.worker;
    if (!worker || typeof worker.stop !== 'function') return Promise.resolve();
    if (state.stopPromise) return state.stopPromise;
    const stopping = Promise.resolve()
        .then(() => worker.stop())
        .finally(() => {
            if (state.runtime?.worker === worker) state.runtime = null;
        });
    state.stopPromise = stopping;
    return stopping;
}

function closeServerHttp(server, callback) {
    const state = questionGenerationServerStates.get(server);
    if (!server.listening) {
        if (typeof callback === 'function') callback();
        return;
    }
    const close = state?.originalClose || server.close.bind(server);
    close(callback);
}

function installWorkerAwareClose(server) {
    const state = questionGenerationServerStates.get(server);
    const originalClose = server.close.bind(server);
    state.originalClose = originalClose;
    server.close = function workerAwareClose(callback) {
        void stopServerWorker(server).then(
            () => closeServerHttp(server, callback),
            error => {
                if (typeof callback === 'function') {
                    callback(error);
                    return;
                }
                process.nextTick(() => server.emit('error', error));
            }
        );
        return server;
    };
}

async function shutdownServer(server) {
    if (!server || typeof server.close !== 'function') {
        throw new Error('HTTP_SERVER_REQUIRED');
    }
    await stopServerWorker(server);
    await new Promise((resolve, reject) => {
        if (!server.listening) {
            resolve();
            return;
        }
        closeServerHttp(server, error => error ? reject(error) : resolve());
    });
}

function installShutdownSignalHandlers(server, { processObject = process } = {}) {
    if (!processObject || typeof processObject.once !== 'function') throw new Error('PROCESS_OBJECT_REQUIRED');
    let shuttingDown = false;
    const handleSignal = () => {
        if (shuttingDown) return;
        shuttingDown = true;
        shutdownServer(server).catch(error => {
            console.error('[shutdown] failed:', error.message);
            processObject.exitCode = 1;
        });
    };
    processObject.once('SIGTERM', handleSignal);
    processObject.once('SIGINT', handleSignal);
    return () => {
        processObject.removeListener('SIGTERM', handleSignal);
        processObject.removeListener('SIGINT', handleSignal);
    };
}

const app = createApp({
    submitAnswers,
    getActiveFormalQuizChallenge,
    updateQuizSessionProgress,
    prebuildWrongQuestionCache,
    registerUser,
    loginUser,
    verifyParentLogin,
    setParentCredentials,
    resetChildPassword,
    createReviewRound,
    getActiveReviewRound,
    submitReviewRound,
    deferReviewRound,
    getReviewSummary,
    getRuntimeHealth: () => getServerRuntimeHealth(),
    onUserLogin: ({ res, result }) => setSessionCookie(res, result, 'user'),
    onParentLogin: ({ res, result }) => setSessionCookie(res, result, 'parent'),
});

// 应用统一的安全中间件
// 前端直接调用的端点只需要 session 验证（用户操作自己的数据）
const SESSION_ONLY_ADMIN_PATHS = new Set([
    '/userSettings',           // 学习设置（家长访问自己孩子）
    '/questionCache/rebuild',  // 重建缓存（前端自动触发）
    '/questionCache/status',   // 缓存状态查询
    '/validateWords',          // 验证单词
    '/addWords',               // 添加单词
    '/words',                  // 词库列表
]);
app.use('/api/admin', (req, res, next) => {
    if (SESSION_ONLY_ADMIN_PATHS.has(req.path)) {
        return requireUserSession(req, res, next);
    }
    // 其他 admin 端点需要 admin token
    return requireAdminToken(req, res, next);
});
app.use('/api/word', requireUserSession);
app.use('/api/quiz', requireUserSession);
app.use('/api/submit', requireUserSession);
app.use('/api/stats', requireUserSession);
app.use('/api/history', requireUserSession);
app.use('/api/reviews', requireUserSession);

// 提供前端静态文件（Expo Web 构建产物）
const publicDir = path.join(__dirname, '..');
app.use(express.static(publicDir));

app.post('/api/quiz', async (req, res) => {
    try {
        const { user, level, mode } = req.body;
        if (!user) return res.status(400).json({ error: '缺少用户ID' });
        const data = await generateQuiz(
            user,
            level || null,
            normalizeAssessmentMode(mode || ASSESSMENT_MODE.REAL)
        );
        if (data.error) return res.status(503).json({
            error: data.error,
            code: data.code,
            source: data.source,
            diagnostics: data.diagnostics,
        });
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/stats/:user', async (req, res) => {
    try {
        const data = await getStats(req.params.user);
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/history/:user', async (req, res) => {
    try {
        const mode = normalizeAssessmentMode(req.query.mode || ASSESSMENT_MODE.REAL);
        if (typeof getQuizHistory === 'function') {
            return res.json({ history: await getQuizHistory(req.params.user, mode), source: 'supabase' });
        }
        const allRecords = await getRecords(TEST_TABLE);
        const records = filterAssessmentRecords(
            allRecords.filter(r => sameUser(r.fields.user, req.params.user)),
            mode
        );
        console.log('Total records for user:', records.length);
        if (records.length > 0) {
            console.log('First record test_time:', getFieldVal(records[0].fields.test_time));
        }
        const userRecords = records;
        
        const wordRecords = await getRecords(WORD_TABLE);
        const userWordRecords = wordRecords.filter(r => sameUser(r.fields.user, req.params.user));
        const wordMap = {};
        for (const w of userWordRecords) {
            const wn = getFieldVal(w.fields.Word);
            wordMap[wn.toLowerCase()] = {
                context: getFieldVal(w.fields.Context),
                meaning: getFieldVal(w.fields.Meaning),
                cnMeaning: getFieldVal(w.fields.CN_Meaning)
            };
        }
        
        const testMap = {};
        for (const rec of userRecords) {
            const testId = getFieldVal(rec.fields.test_id);
            const time = Number(rec.fields.test_time) || 0;
            const qType = Number(rec.fields.question_type) || 1;
            const word = getFieldVal(rec.fields.word);
            if (!testMap[testId]) {
                testMap[testId] = {
                    testId,
                    mode: getAssessmentMode(testId),
                    time,
                    questions: [],
                    correct: 0,
                    total: 0
                };
            }
            const isCorrect = getFieldVal(rec.fields.is_correct) === OPTION_IDS.IS_CORRECT;
            const wi = wordMap[word.toLowerCase()] || {};
            const savedContext = getFieldVal(rec.fields.context);
            let question = '';
            if (qType === 1) question = savedContext || wi.context || word;
            else if (qType === 2) question = savedContext || wi.meaning || word;
            else if (qType === 3) question = savedContext || wi.cnMeaning || wi.meaning || word;
            else question = savedContext || word;
            testMap[testId].questions.push({
                word,
                question,
                type: qType,
                options: parseOptions(rec.fields.options),
                yourAnswer: parseStoredAnswer(getFieldVal(rec.fields.your_answer)).option,
                confidence: parseStoredAnswer(getFieldVal(rec.fields.your_answer)).confidence,
                correctAnswer: getFieldVal(rec.fields.correct_answer),
                isCorrect
            });
            testMap[testId].total++;
            if (isCorrect) testMap[testId].correct++;
        }
        
        const history = Object.values(testMap).sort((a, b) => b.time - a.time);
        res.json({ history });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/users', async (req, res) => {
    try {
        const users = await getAllUsers();
        res.json({ users });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/stats', async (req, res) => {
    try {
        const stats = await getAllStats();
        res.json({ stats });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/userSettings', async (req, res) => {
    try {
        const { userId } = req.query;
        if (!userId) return res.status(400).json({ error: '缺少userId' });
        const settings = await getUserLearningSettings(userId);
        res.json({ settings });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/admin/userSettings', async (req, res) => {
    try {
        const { userId, learningLevel } = req.body;
        if (!userId || !learningLevel) return res.status(400).json({ error: '缺少参数' });
        const result = await updateUserLearningSettings(userId, learningLevel);
        if (!result.success && result.error === 'cooldown') {
            return res.status(409).json(result);
        }
        if (result.success) {
            const canonicalUserId = result.settings?.userId || userId;
            const selectedLevel = result.settings?.learningLevel || learningLevel;
            let shouldRebuild = result.settings?.questionCacheStatus === 'building';
            if (!shouldRebuild) {
                const cacheStatus = await getQuestionCacheStatus(canonicalUserId);
                shouldRebuild = Boolean(cacheStatus?.configured) && getCacheReadyCountForLevel(cacheStatus, selectedLevel) < 10;
            }
            if (shouldRebuild) startQuestionCacheRebuild(canonicalUserId);
        }
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/game/state/:user', async (req, res) => {
    try {
        if (typeof getGameState !== 'function') return res.status(503).json({ error: 'Game state storage is unavailable.' });
        res.json({ state: await getGameState(req.params.user) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/game/state/:user', async (req, res) => {
    try {
        if (typeof saveGameState !== 'function') return res.status(503).json({ error: 'Game state storage is unavailable.' });
        res.json({ state: await saveGameState(req.params.user, req.body || {}) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
app.get('/api/admin/questionCache/status', async (req, res) => {
    try {
        const { userId } = req.query;
        if (!userId) return res.status(400).json({ error: '缺少userId' });
        const status = await getQuestionCacheStatus(userId);
        res.json({ status });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/questionCache/rebuild', async (req, res) => {
    try {
        const { userId, flush, type } = req.body;
        if (!userId) return res.status(400).json({ error: '缺少userId' });
        let flushed = null;
        if (flush) {
            flushed = await deleteQuestionCacheRows(userId, type != null ? Number(type) : null);
        }
        const result = startQuestionCacheRebuild(userId);
        res.status(202).json({ ...result, flushed });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/questionCache/rebuildAll', async (req, res) => {
    try {
        const { flush } = req.body;
        const users = getActiveRebuildUsers(await getAllUsers());
        const results = [];
        for (const userId of users) {
            let flushed = null;
            if (flush) {
                flushed = await deleteQuestionCacheRows(userId, null);
            }
            const result = startQuestionCacheRebuild(userId);
            results.push({ ...result, userId, flushed });
        }
        res.status(202).json({ total: users.length, results });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/questionCache/rebuildAll/status', async (req, res) => {
    const entries = [...questionCacheRebuildJobs.entries()].map(([key, job]) => ({
        userId: key,
        ...job,
        error: job.error || undefined,
    }));
    res.json({ jobs: entries });
});

app.get('/api/admin/questionCache/diagnostics', async (req, res) => {
    try {
        const { userId } = req.query;
        const data = await getQuestionCacheDiagnostics(userId || null);
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/history/diagnostics', requireServerAdminToken, async (req, res) => {
    try {
        const userId = String(req.query.userId || '').trim();
        if (!userId) return res.status(400).json({ error: 'Missing userId' });
        const [assessments, history] = await Promise.all([
            getAssessmentsForUser(userId),
            getQuizHistory(userId, ASSESSMENT_MODE.REAL),
        ]);
        const rows = Array.isArray(assessments) ? assessments : [];
        const groups = Array.isArray(history) ? history : [];
        res.json({
            userId,
            assessmentRows: rows.length,
            submittedRows: rows.filter(row => {
                const value = assessmentDiagnosticField(row, 'is_correct');
                return value !== null && value !== undefined;
            }).length,
            realRows: rows.filter(row => getAssessmentMode(assessmentDiagnosticField(row, 'test_id')) === ASSESSMENT_MODE.REAL).length,
            testRows: rows.filter(row => getAssessmentMode(assessmentDiagnosticField(row, 'test_id')) === ASSESSMENT_MODE.TEST).length,
            historyTests: groups.length,
            historyQuestions: groups.reduce((total, group) => total + (Array.isArray(group?.questions) ? group.questions.length : 0), 0),
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/addWord', async (req, res) => {
    try {
        const { targetUser, word, meaning, pos, POS, partsOfSpeech, context, level } = req.body;
        if (!targetUser || !word || !meaning) {
            return res.status(400).json({ error: '缺少参数' });
        }
        const result = await addWord(targetUser, {
            Word: word,
            Meaning: meaning,
            POS: partsOfSpeech || POS || pos,
            Context: context,
            Level: level,
        });
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/validateWords', async (req, res) => {
    try {
        const { targetUser, words } = req.body;
        if (!words || !Array.isArray(words)) {
            return res.status(400).json({ error: '缺少words参数' });
        }
        const result = await validateWords(targetUser || null, words);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/addWords', async (req, res) => {
    try {
        const { targetUser, words, confirmNewMeanings = false, skipDuplicateWords = false } = req.body;
        if (!targetUser || !words || !Array.isArray(words) || words.length === 0) {
            return res.status(400).json({ error: '缺少参数' });
        }
        const result = await addWords(targetUser, words, {
            confirmNewMeanings: Boolean(confirmNewMeanings),
            skipDuplicateWords: Boolean(skipDuplicateWords),
        });
        const needsConfirmation = result?.code === 'DUPLICATE_WORD_CONFIRMATION_REQUIRED' ||
            result?.code === 'NEW_MEANING_REQUIRES_MEANING';
        const statusCode = needsConfirmation ? 409 : (result?.success === false ? 422 : 200);
        res.status(statusCode).json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/updateMulti', async (req, res) => {
    try {
        const { targetUser, words } = req.body;
        if (!targetUser || !words || !Array.isArray(words)) {
            return res.status(400).json({ error: '缺少参数' });
        }
        await updateMultiDefinition(targetUser, words);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/words', async (req, res) => {
    try {
        const userId = String(req.query.userId || '').trim();
        if (!userId) return res.status(400).json({ error: '缺少userId参数' });
        const page = Number(req.query.page || 1);
        const pageSize = Number(req.query.pageSize || 20);
        const status = String(req.query.status || '').trim();
        const result = await listUserWords(userId, { page, pageSize, status: status || undefined });
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/word', async (req, res) => {
    try {
        const { userId, word, recordId } = req.query;
        const effectiveUserId = userId || req.wordbotSession?.user || '';
        if (recordId) {
            const data = await getWordByRecordId(recordId, effectiveUserId);
            return res.json(data || { exists: false });
        }
        if (!effectiveUserId || !word) return res.status(400).json({ error: '缺少参数' });
        const data = await getWord(effectiveUserId, word);
        res.json(data || { exists: false });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/word', async (req, res) => {
    try {
        const { userId, word, recordId, meaning, cnMeaning, pos, context, distractors, status, qualityFlags, qualityNote } = req.body;
        const effectiveUserId = userId || req.wordbotSession?.user || '';
        if (!recordId && (!effectiveUserId || !word)) return res.status(400).json({ error: '缺少参数' });
        const data = await updateWord(effectiveUserId, word, { recordId, meaning, cnMeaning, pos, context, distractors, status, qualityFlags, qualityNote });
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/reviewWords', async (req, res) => {
    try {
        const data = await getReviewWords(req.query.userId || '');
        res.json({ words: data });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/reviewWords/mark', async (req, res) => {
    try {
        const { recordId, flags, note } = req.body;
        if (!recordId) return res.status(400).json({ error: '缺少recordId' });
        const data = await markWordForReview(recordId, flags, note, req.wordbotSession?.user || '');
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/reviewWords/clear', async (req, res) => {
    try {
        const { recordId } = req.body;
        if (!recordId) return res.status(400).json({ error: '缺少recordId' });
        const data = await clearWordReview(recordId, req.wordbotSession?.user || '');
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/word', async (req, res) => {
    try {
        const { userId = '', word = '', recordId = '' } = req.query;
        const effectiveUserId = userId || req.wordbotSession?.user || '';
        if (!recordId && (!effectiveUserId || !word)) return res.status(400).json({ error: '缺少参数' });
        const data = await deleteWord(effectiveUserId, word, { recordId });
        if (data?.code === 'WORD_DELETE_BLOCKED_BY_FORMAL_HISTORY') return res.status(409).json(data);
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 清理用户测试数据（支持按天数清理，days=3 表示只删除最近3天的记录）
app.post('/api/admin/cleanup', express.json(), async (req, res) => {
    try {
        const { user, days } = req.body;
        if (!user) return res.status(400).json({ error: '请指定用户' });
        const result = await deleteUserTestData(user, days);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const backfillJobs = new Map();

function startBackfill(userId) {
    const key = userId || '__all__';
    const current = backfillJobs.get(key);
    if (current?.status === 'running') {
        return { started: false, alreadyRunning: true, userId: userId || null, startedAt: current.startedAt };
    }
    const job = { status: 'running', startedAt: Date.now() };
    backfillJobs.set(key, job);
    backfillTranslations(userId || null)
        .then(result => {
            backfillJobs.set(key, { ...job, status: 'completed', finishedAt: Date.now(), result });
            console.log(`backfill completed user=${key}`, JSON.stringify(result));
        })
        .catch(error => {
            backfillJobs.set(key, { ...job, status: 'failed', finishedAt: Date.now(), error: error.message });
            console.error(`backfill failed user=${key}: ${error.message}`);
        });
    return { started: true, userId: userId || null, startedAt: job.startedAt };
}

app.post('/api/admin/backfill', async (req, res) => {
    try {
        const { userId } = req.body;
        const result = startBackfill(userId || null);
        res.status(202).json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/backfill/status', async (req, res) => {
    const { userId } = req.query;
    const key = userId || '__all__';
    const job = backfillJobs.get(key);
    res.json(job || { status: 'not_started' });
});
const PORT = process.env.DEPLOY_RUN_PORT || process.env.PORT || 5000;

function createServerApp(state) {
    const serverApp = express();
    serverApp.get('/api/health', async (req, res) => {
        const health = await getServerRuntimeHealth(state);
        res.status(health.ok ? 200 : 503).json(health);
    });
    serverApp.use(app);
    return serverApp;
}

function startServer(port = PORT, options = {}) {
    const enableQuestionGenerationWorker = options.enableQuestionGenerationWorker
        ?? String(process.env.DATA_SOURCE || 'supabase').trim().toLowerCase() !== 'feishu';
    const runtimeFactory = options.runtimeFactory || createDefaultQuestionGenerationRuntime;
    const state = {
        workerConfigured: enableQuestionGenerationWorker,
        runtime: null,
        workerLastError: '',
        workerStartedAt: null,
        workerLastAttemptAt: null,
        workerLastClaimAt: null,
        workerLastSuccessAt: null,
        workerLastCompletionAt: null,
        workerHealthNow: options.workerHealthNow || (() => new Date().toISOString()),
        workerStallAfterMs: options.workerStallAfterMs,
        getQuestionGenerationEligibleDueCount: null,
        stopPromise: null,
        originalClose: null,
    };
    state.getQuestionGenerationEligibleDueCount = options.getQuestionGenerationEligibleDueCount
        || createQuestionGenerationEligibleDueCounter({
            client: options.questionGenerationHealthClient || supabase,
            now: state.workerHealthNow,
        });
    const server = createServerApp(state).listen(port, '0.0.0.0', () => {
        console.log(`后端服务运行在 http://0.0.0.0:${port}`);
    });
    questionGenerationServerStates.set(server, state);
    installWorkerAwareClose(server);
    if (enableQuestionGenerationWorker) {
        try {
            const runtime = runtimeFactory({
                onError: error => {
                    state.workerLastAttemptAt = state.workerHealthNow();
                    state.workerLastError = 'question_generation_worker_failed';
                    console.error('[question_generation_worker]', state.workerLastError);
                },
                onSuccess: summary => {
                    const completedAt = state.workerHealthNow();
                    state.workerLastError = '';
                    state.workerLastAttemptAt = completedAt;
                    state.workerLastSuccessAt = completedAt;
                    if (Number(summary?.claimed) > 0) state.workerLastClaimAt = completedAt;
                    if (Number(summary?.completed) > 0) state.workerLastCompletionAt = completedAt;
                },
            });
            state.runtime = runtime;
            if (runtime.worker.start()) state.workerStartedAt = state.workerHealthNow();
        } catch (error) {
            state.workerLastError = 'question_generation_worker_start_failed';
            console.error('[question_generation_worker]', state.workerLastError);
        }
    }
    return server;
}

if (require.main === module) {
    const server = startServer();
    installShutdownSignalHandlers(server);
}

module.exports = {
    app,
    installShutdownSignalHandlers,
    shutdownServer,
    startServer,
};
