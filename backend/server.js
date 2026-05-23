const express = require('express');
const cors = require('cors');
const { generateQuiz, submitAnswers, getStats, addWord, getAllUsers, getAllStats, validateWords, addWords, updateMultiDefinition, getWord, updateWord, deleteWord } = require('./feishu');

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/quiz', async (req, res) => {
    try {
        const { user } = req.body;
        if (!user) return res.status(400).json({ error: '缺少用户ID' });
        const data = await generateQuiz(user);
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/submit', async (req, res) => {
    try {
        const { user, testId, answers } = req.body;
        console.log(`submit API: user="${user}", testId="${testId}"`);
        if (!user || !testId || !answers) return res.status(400).json({ error: '缺少参数' });
        const data = await submitAnswers(user, testId, answers);
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
        const { userId, word } = req.query;
        if (!userId || !word) return res.status(400).json({ error: '缺少参数' });
        const data = await getWord(userId, word);
        res.json(data || { exists: false });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/word', async (req, res) => {
    try {
        const { userId, word, meaning, cnMeaning, pos, context, distractors, status } = req.body;
        if (!userId || !word) return res.status(400).json({ error: '缺少参数' });
        const data = await updateWord(userId, word, { meaning, cnMeaning, pos, context, distractors, status });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`后端服务运行在 http://0.0.0.0:${PORT}`);
});
