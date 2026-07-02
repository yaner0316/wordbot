const express = require('express');
const cors = require('cors');

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
function createApp({
    submitAnswers,
    registerUser,
    loginUser,
    verifyParentLogin,
    setParentCredentials,
    createReviewRound,
    getActiveReviewRound,
    submitReviewRound,
    deferReviewRound,
    getReviewSummary,
    getRuntimeHealth,
}) {
    if (typeof submitAnswers !== 'function') {
        throw new Error('createApp requires submitAnswers');
    }

    const app = express();
    app.use(cors());
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
                res.json(await loginUser({ username: identifier || username, password }));
            } catch (error) {
                res.status(400).json({ error: error.message });
            }
        });
    }
    if (typeof verifyParentLogin === 'function') {
        app.post('/api/auth/parent/login', async (req, res) => {
            try {
                const { user, parentUsername, password } = req.body;
                res.json(await verifyParentLogin({ user, parentUsername, password }));
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

    app.get('/api/health', (req, res) => {
        const health = typeof getRuntimeHealth === 'function'
            ? getRuntimeHealth()
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
                res.json(await submitReviewRound({
                    userId: user,
                    reviewId: req.params.reviewId,
                    answers,
                }));
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
};
