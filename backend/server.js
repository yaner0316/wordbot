const express = require('express');
const cors = require('cors');
const { generateQuiz, submitAnswers, getStats, addWord, getAllUsers, getAllStats, validateWords, addWords, updateMultiDefinition, getWord, updateWord, deleteWord, searchRecords, getRecords } = require('./feishu');

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

app.get('/api/history/:user', async (req, res) => {
    try {
        const TEST_TABLE = { appToken: 'FyyPb1urFacfn7sGSjpca2UwnHe', tableId: 'tbl6Nx0kJWjr7qQZ' };
        const WORD_TABLE = { appToken: 'BWhIb2hjaaDQHdsNhWRcPluBncg', tableId: 'tblyMh69dws6ty6n' };
        
        const records = await searchRecords(
            TEST_TABLE,
            { conjunction: "and", conditions: [{ field_name: "user", operator: "is", value: [req.params.user] }] }
        );
        console.log('Total records for user:', records.length);
        if (records.length > 0) {
            console.log('First record test_time:', getFieldVal(records[0].fields.test_time));
        }
        const userRecords = records;
        
        const wordRecords = await getRecords(WORD_TABLE);
        const userWordRecords = wordRecords.filter(r => getFieldVal(r.fields.user) === req.params.user);
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
                testMap[testId] = { testId, time, questions: [], correct: 0, total: 0 };
            }
            const isCorrect = getFieldVal(rec.fields.is_correct) === 'optHGT7gYf';
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
                yourAnswer: getFieldVal(rec.fields.your_answer),
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
