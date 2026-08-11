const express = require('express');
const cors = require('cors');
const {
    FORMAL_QUIZ_REQUIRED_COUNT,
    isResumableQuizSession,
} = require('./formal-quiz-session');
const DEFAULT_CORS_ALLOWED_ORIGINS = Object.freeze([
    'https://wordbot-web.onrender.com',
]);


function isCompleteCacheOnlyFormalSession(session) {
    const questions = Array.isArray(session?.questions) ? session.questions : [];
    return questions.length === FORMAL_QUIZ_REQUIRED_COUNT
        && isResumableQuizSession(session)
        && questions.every(question => String(question?.source || '').trim().toLowerCase() === 'question_cache'
            && String(question?.cacheRecordId || '').trim());
}
function getCorsAllowedOrigins(environment = process.env) {
    const configuredOrigins = String(environment.WORDBOT_CORS_ALLOWED_ORIGINS || '')
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean);

    return new Set([
        ...DEFAULT_CORS_ALLOWED_ORIGINS,
        ...configuredOrigins,
    ]);
}

function isDevelopmentLocalOrigin(origin, environment = process.env) {
    if (environment.NODE_ENV !== 'development') return false;

    try {
        const url = new URL(origin);
        return url.protocol === 'http:'
            && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    } catch {
        return false;
    }
}

function createCorsOptions(environment = process.env) {
    const allowedOrigins = getCorsAllowedOrigins(environment);

    return {
        credentials: true,
        origin(origin, callback) {
            const allowed = Boolean(origin)
                && (allowedOrigins.has(origin) || isDevelopmentLocalOrigin(origin, environment));
            callback(null, allowed ? origin : false);
        },
    };
}

const CLIENT_ERROR_PATTERNS = [
    /缺少参数/,
    /答案必须是数组/,
    /答案数量必须与题目数量一致/,
    /答案只能是 0 到 3/,
    /未找到测试记录/,
    /考试不属于当前用户/,
    /考试提交状态不完整/,
];

function isClientError(error) {
    return CLIENT_ERROR_PATTERNS.some(pattern => pattern.test(error.message));
}

function errorCodeForStatus(status) {
    return status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST';
}

function addErrorContract(req, res, next) {
    const sendJson = res.json.bind(res);
    res.json = body => {
        if (body && body.error && !body.code) {
            return sendJson({
                ...body,
                code: errorCodeForStatus(res.statusCode),
            });
        }
        return sendJson(body);
    };
    next();
}

function hasWrongAnswers(result) {
    return Array.isArray(result?.results) && result.results.some(item => item && item.correct === false);
}

function startReviewPrebuild({ createReviewRound, user, testId, result }) {
    if (typeof createReviewRound !== 'function' || !hasWrongAnswers(result)) return;
    try {
        Promise.resolve(createReviewRound({
            userId: user,
            sourceTestId: testId,
            parentReviewId: '',
        })).catch(error => {
            console.warn('review prebuild failed:', error.message);
        });
    } catch (error) {
        console.warn('review prebuild failed:', error.message);
    }
}
function startNextReviewPrebuild({ createReviewRound, user, reviewId, result }) {
    if (typeof createReviewRound !== 'function') return;
    if (!Array.isArray(result?.remainingRecordIds) || result.remainingRecordIds.length === 0) return;
    if (!result?.sourceTestId) return;
    try {
        Promise.resolve(createReviewRound({
            userId: user,
            sourceTestId: result.sourceTestId,
            parentReviewId: reviewId,
        })).catch(error => {
            console.warn('review next-round prebuild failed:', error.message);
        });
    } catch (error) {
        console.warn('review next-round prebuild failed:', error.message);
    }
}
function startWrongQuestionCachePrebuild({ prebuildWrongQuestionCache, user, testId, result }) {
    if (typeof prebuildWrongQuestionCache !== 'function' || !Array.isArray(result?.results) || result.results.length === 0) return;
    try {
        Promise.resolve(prebuildWrongQuestionCache({
            userId: user,
            testId,
            result,
        })).catch(error => {
            console.warn('question variant prebuild failed:', error.message);
        });
    } catch (error) {
        console.warn('wrong-question cache prebuild failed:', error.message);
    }
}
function createApp({
    submitAnswers,
    registerUser,
    loginUser,
    verifyParentLogin,
    setParentCredentials,
    resetChildPassword,
    getActiveFormalQuizChallenge,
    createReviewRound,
    prebuildWrongQuestionCache,
    getActiveReviewRound,
    submitReviewRound,
    deferReviewRound,
    getReviewSummary,
    getRuntimeHealth,
    onUserLogin,
    onParentLogin,
    corsEnvironment = process.env,
}) {
    if (typeof submitAnswers !== 'function') {
        throw new Error('createApp requires submitAnswers');
    }

    const app = express();
    app.use(cors(createCorsOptions(corsEnvironment)));
    app.use(express.json());
    app.use(addErrorContract);

    if (typeof registerUser === 'function') {
        app.post('/api/auth/register', async (req, res) => {
            try {
                const { username, password } = req.body;
                res.json(await registerUser({ username, password }));
            } catch (error) {
                res.status(400).json({ error: error.message });
            }
        });
    }

    if (typeof loginUser === 'function') {
        app.post('/api/auth/login', async (req, res) => {
            try {
                const { identifier, username, password } = req.body;
                const result = await loginUser({ username: identifier || username, password });
                if (typeof onUserLogin === 'function') await onUserLogin({ req, res, result });
                res.json(result);
            } catch (error) {
                res.status(400).json({ error: error.message });
            }
        });
    }
    if (typeof verifyParentLogin === 'function') {
        app.post('/api/auth/parent/login', async (req, res) => {
            try {
                const { user, parentUsername, password } = req.body;
                const result = await verifyParentLogin({ user, parentUsername, password });
                if (typeof onParentLogin === 'function') await onParentLogin({ req, res, result });
                res.json(result);
            } catch (error) {
                res.status(400).json({ error: error.message });
            }
        });
    }

    if (typeof setParentCredentials === 'function') {
        app.post('/api/auth/parent/setup', async (req, res) => {
            try {
                const { user, childPassword, parentUsername, parentPassword, currentParentUsername, currentParentPassword } = req.body;
                res.json(await setParentCredentials({ user, childPassword, parentUsername, parentPassword, currentParentUsername, currentParentPassword }));
            } catch (error) {
                res.status(400).json({ error: error.message });
            }
        });
    }

    if (typeof resetChildPassword === 'function') {
        app.post('/api/auth/parent/reset-child-password', async (req, res) => {
            try {
                const { user, parentUsername, parentPassword, newPassword } = req.body;
                res.json(await resetChildPassword({ user, parentUsername, parentPassword, newPassword }));
            } catch (error) {
                res.status(400).json({ error: error.message });
            }
        });
    }

    if (typeof getActiveFormalQuizChallenge === 'function') {
        app.get('/api/quiz/session', async (req, res) => {
            try {
                const { user } = req.query;
                if (!user) return res.status(400).json({ error: '缂哄皯鐢ㄦ埛ID' });
                const session = await getActiveFormalQuizChallenge(user);
                if (!isCompleteCacheOnlyFormalSession(session)) return res.json({ active: false });
                const questions = session.questions;
                const readyCount = questions.length;
                res.json({
                    active: true,
                    testId: session.test_id,
                    source: 'question_cache',
                    mode: 'real',
                    partialFormalChallenge: readyCount < FORMAL_QUIZ_REQUIRED_COUNT,
                    readyCount,
                    requiredCount: FORMAL_QUIZ_REQUIRED_COUNT,
                    diagnostics: {
                        fallbackUsed: false,
                        resumed: true,
                        requiredCount: FORMAL_QUIZ_REQUIRED_COUNT,
                        readyCount,
                        finalQuestionCount: readyCount,
                    },
                    questions,
                    progress: session.progress,
                });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
    }

    if (typeof updateQuizSessionProgress === 'function') {
        app.post('/api/quiz/session/progress', async (req, res) => {
            try {
                const { user, testId, currentQuestion, answers } = req.body;
                if (!user || !testId || !Array.isArray(answers)) {
                    return res.status(400).json({ error: '缂哄皯鍙傛暟' });
                }
                const session = await updateQuizSessionProgress(user, testId, { currentQuestion, answers });
                res.json({ saved: Boolean(session), testId });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
    }

    app.get('/api/health', async (req, res) => {
        const health = typeof getRuntimeHealth === 'function'
            ? await getRuntimeHealth()
            : { ok: true, service: 'wordbot-backend' };
        res.status(health.ok ? 200 : 503).json(health);
    });

    app.post('/api/submit', async (req, res) => {
        try {
            const { user, testId, answers } = req.body;
            if (!user || !testId) {
                return res.status(400).json({ error: '缺少参数' });
            }
            if (!Array.isArray(answers)) {
                return res.status(400).json({ error: '答案必须是数组' });
            }

            const data = await submitAnswers(user, testId, answers);
            startReviewPrebuild({ createReviewRound, user, testId, result: data });
            startWrongQuestionCachePrebuild({ prebuildWrongQuestionCache, user, testId, result: data });
            res.json(data);
        } catch (error) {
            const status = isClientError(error) ? 400 : 500;
            res.status(status).json({ error: error.message });
        }
    });

    if (typeof createReviewRound === 'function') {
        app.post('/api/reviews', async (req, res) => {
            try {
                const { user, sourceTestId, parentReviewId = '' } = req.body;
                if (!user || !sourceTestId) {
                    return res.status(400).json({ error: '缺少参数' });
                }
                res.json(await createReviewRound({
                    userId: user,
                    sourceTestId,
                    parentReviewId,
                }));
            } catch (error) {
                const status = isClientError(error) ? 400 : 500;
                res.status(status).json({ error: error.message });
            }
        });
    }

    if (typeof getActiveReviewRound === 'function') {
        app.get('/api/reviews/active', async (req, res) => {
            try {
                const { user, sourceTestId } = req.query;
                if (!user || !sourceTestId) {
                    return res.status(400).json({ error: '缺少参数' });
                }
                res.json(await getActiveReviewRound({
                    userId: user,
                    sourceTestId,
                }) || { active: false });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
    }

    if (typeof submitReviewRound === 'function') {
        app.post('/api/reviews/:reviewId/submit', async (req, res) => {
            try {
                const { user, answers } = req.body;
                if (!user || !Array.isArray(answers)) {
                    return res.status(400).json({ error: '缺少参数' });
                }
                const result = await submitReviewRound({
                    userId: user,
                    reviewId: req.params.reviewId,
                    answers,
                });
                startNextReviewPrebuild({
                    createReviewRound,
                    user,
                    reviewId: req.params.reviewId,
                    result,
                });
                res.json(result);
            } catch (error) {
                const status = isClientError(error) ? 400 : 500;
                res.status(status).json({ error: error.message });
            }
        });
    }

    if (typeof deferReviewRound === 'function') {
        app.post('/api/reviews/:reviewId/defer', async (req, res) => {
            try {
                const { user } = req.body;
                if (!user) return res.status(400).json({ error: '缺少参数' });
                res.json(await deferReviewRound({
                    userId: user,
                    reviewId: req.params.reviewId,
                }));
            } catch (error) {
                const status = isClientError(error) ? 400 : 500;
                res.status(status).json({ error: error.message });
            }
        });
    }

    if (typeof getReviewSummary === 'function') {
        app.get('/api/reviews/summary', async (req, res) => {
            try {
                const { user, sourceTestId } = req.query;
                if (!user || !sourceTestId) {
                    return res.status(400).json({ error: '缺少参数' });
                }
                res.json(await getReviewSummary({
                    userId: user,
                    sourceTestId,
                }));
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
    }

    return app;
}

module.exports = {
    addErrorContract,
    createApp,
    errorCodeForStatus,
    createCorsOptions,
    getCorsAllowedOrigins,
    isDevelopmentLocalOrigin,
};
