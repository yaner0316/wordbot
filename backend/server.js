const express = require('express');
const path = require('path');
const { TEST_TABLE, WORD_TABLE, OPTION_IDS } = require('./config');
const { registerUser, loginUser, requestAuthOtp, loginWithOtp, verifyParentOtp, generateQuiz, submitAnswers, createReviewRound, getActiveReviewRound, submitReviewRound, deferReviewRound, getReviewSummary, getStats, addWord, getAllUsers, getAllStats, getUserLearningSettings, updateUserLearningSettings, getQuestionCacheStatus, rebuildQuestionCacheForUser, deleteQuestionCacheRows, validateWords, addWords, updateMultiDefinition, getWord, updateWord, deleteWord, deleteUserTestData, getWordByRecordId, getReviewWords, markWordForReview, clearWordReview, searchRecords, getRecords, backfillTranslations } = require('./feishu');
const { createApp } = require('./http-app');
const { getRuntimeHealth } = require('./runtime-health');
const {
    ASSESSMENT_MODE,
    filterAssessmentRecords,
    getAssessmentMode,
    normalizeAssessmentMode,
} = require('./assessment-mode');
const { parseStoredAnswer } = require('./mastery-evidence');

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
    const raw = getFieldVal(v);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return raw.split(/\n|,/).map(s => s.trim()).filter(Boolean);
    }
};


const questionCacheRebuildJobs = new Map();

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
const app = createApp({
    submitAnswers,
    registerUser,
    loginUser,
    requestAuthOtp,
    loginWithOtp,
    verifyParentOtp,
    createReviewRound,
    getActiveReviewRound,
    submitReviewRound,
    deferReviewRound,
    getReviewSummary,
    getRuntimeHealth,
});

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
            let question = '';
            if (qType === 1) question = wi.context || word;
            else if (qType === 2) question = wi.meaning || word;
            else if (qType === 3) question = wi.cnMeaning || wi.meaning || word;
            else question = word;
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

app.post('/api/admin/addWord', async (req, res) => {
    try {
        const { targetUser, word, meaning, pos, context } = req.body;
        if (!targetUser || !word || !meaning) {
            return res.status(400).json({ error: '缺少参数' });
        }
        const result = await addWord(targetUser, { Word: word, Meaning: meaning, POS: pos, Context: context });
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/validateWords', async (req, res) => {
    try {
        const { words } = req.body;
        if (!words || !Array.isArray(words)) {
            return res.status(400).json({ error: '缺少words参数' });
        }
        const result = await validateWords(words);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/addWords', async (req, res) => {
    try {
        const { targetUser, words } = req.body;
        if (!targetUser || !words || !Array.isArray(words) || words.length === 0) {
            return res.status(400).json({ error: '缺少参数' });
        }
        const result = await addWords(targetUser, words);
        res.json(result);
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

app.get('/api/word', async (req, res) => {
    try {
        const { userId, word, recordId } = req.query;
        if (recordId) {
            const data = await getWordByRecordId(recordId);
            return res.json(data || { exists: false });
        }
        if (!userId || !word) return res.status(400).json({ error: '缺少参数' });
        const data = await getWord(userId, word);
        res.json(data || { exists: false });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/word', async (req, res) => {
    try {
        const { userId, word, recordId, meaning, cnMeaning, pos, context, distractors, status, qualityFlags, qualityNote } = req.body;
        if (!recordId && (!userId || !word)) return res.status(400).json({ error: '缺少参数' });
        const data = await updateWord(userId, word, { recordId, meaning, cnMeaning, pos, context, distractors, status, qualityFlags, qualityNote });
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
        const data = await markWordForReview(recordId, flags, note);
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/reviewWords/clear', async (req, res) => {
    try {
        const { recordId } = req.body;
        if (!recordId) return res.status(400).json({ error: '缺少recordId' });
        const data = await clearWordReview(recordId);
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/word', async (req, res) => {
    try {
        const { userId, word } = req.query;
        if (!userId || !word) return res.status(400).json({ error: '缺少参数' });
        const data = await deleteWord(userId, word);
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

app.post('/api/admin/backfill', async (req, res) => {
    try {
        const { userId } = req.body;
        const result = await backfillTranslations(userId || null);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
const PORT = process.env.DEPLOY_RUN_PORT || process.env.PORT || 5000;

function startServer(port = PORT) {
    return app.listen(port, '0.0.0.0', () => {
        console.log(`后端服务运行在 http://0.0.0.0:${port}`);
    });
}

if (require.main === module) {
    startServer();
}

module.exports = { app, startServer };
