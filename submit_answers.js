const https = require('https');

const USER_ID = process.argv[2];
const TEST_ID = process.argv[3];
const ANSWERS_RAW = process.argv.slice(4).join(' ');

function parseAnswers(input) {
    if (!input) return [];
    
    const chineseNums = '一二三四五六七八九十';
    const clean = input.replace(/\s+/g, '').toUpperCase();
    
    const answers = new Array(10).fill(null);
    
    const chineseMatch = clean.match(/第([一二三四五六七八九十]+)题答案是([A-D])/gi);
    if (chineseMatch) {
        for (const m of chineseMatch) {
            const match = m.match(/第(.+?)题答案是([A-D])/i);
            if (match) {
                let num = parseInt(match[1], 10);
                if (isNaN(num)) num = chineseNums.indexOf(match[1]) + 1;
                if (num >= 1 && num <= 10) answers[num - 1] = match[2];
            }
        }
    }
    
    const numLetterMatch = clean.match(/(?<![A-D])([1-9])([A-D])(?![A-D])/gi);
    if (numLetterMatch) {
        for (const m of numLetterMatch) {
            const match = m.match(/([1-9])([A-D])/i);
            if (match) {
                const num = parseInt(match[1], 10);
                if (answers[num - 1] === null) answers[num - 1] = match[2];
            }
        }
    }
    
    const standalone = clean.match(/[A-D]/gi) || [];
    let idx = 0;
    for (let i = 0; i < 10 && idx < standalone.length; i++) {
        if (answers[i] === null) {
            answers[i] = standalone[idx++];
        }
    }
    
    return answers.filter(a => a !== null).slice(0, 10);
}

const ANSWERS = parseAnswers(ANSWERS_RAW);

const TEST_TABLE = { appToken: 'FyyPb1urFacfn7sGSjpca2UwnHe', tableId: 'tbl6Nx0kJWjr7qQZ' };
const STATS_TABLE = { appToken: 'Mbh7bK7Jrah7XMsV9lhceE7cnyh', tableId: 'tblQBYKzcQuz8sSq' };
const WORD_TABLE = { appToken: 'BWhIb2hjaaDQHdsNhWRcPluBncg', tableId: 'tblyMh69dws6ty6n' };

function request(method, path, body, token) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const headers = { 'Content-Type': 'application/json' };
        if (data) headers['Content-Length'] = Buffer.byteLength(data);
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const req = https.request({ hostname: 'open.feishu.cn', path, method, headers }, (res) => {
            let chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

async function getToken() {
    const res = await request('POST', '/open-apis/auth/v3/tenant_access_token/internal', {
        app_id: 'cli_a97e125f0ab89cb5', app_secret: 'pppKJAybbiNqKIDB9hlvshTnXGPg7OVH'
    });
    return res.tenant_access_token;
}

async function getRecords(token, table) {
    const res = await request('GET', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records?page_size=500`, null, token);
    return res.data?.items || [];
}

async function updateRecord(token, table, recordId, fields) {
    return request('PUT', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records/${recordId}`, { fields }, token);
}

async function addRecord(token, table, fields) {
    return request('POST', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records`, { fields }, token);
}

async function main() {
    if (!USER_ID || !TEST_ID) {
        console.log('用法: node submit_answers.js <user> <test_id> <答案>');
        return;
    }
    
    console.log('解析输入:', ANSWERS_RAW);
    console.log('解析结果:', ANSWERS);
    
    const token = await getToken();
    const records = await getRecords(token, TEST_TABLE);
    const testRecords = records.filter(r => r.fields.user === USER_ID && r.fields.test_id === TEST_ID)
        .sort((a, b) => a.fields.test_time - b.fields.test_time);
    
    if (testRecords.length === 0) {
        console.log('未找到测试记录');
        return;
    }
    
    let correct = 0;
    let results = [];
    const wordMap = {};
    
    for (let i = 0; i < Math.min(testRecords.length, ANSWERS.length); i++) {
        const rec = testRecords[i];
        const yourAnswer = ANSWERS[i];
        const correctAnswer = rec.fields.correct_answer;
        const isCorrect = yourAnswer === correctAnswer;
        if (isCorrect) correct++;
        
        await updateRecord(token, TEST_TABLE, rec.record_id, {
            'your_answer': yourAnswer,
            'is_correct': isCorrect ? ['正确'] : ['错误']
        });
        
        const word = rec.fields.word;
        if (!wordMap[word]) wordMap[word] = { correct: 0, total: 0 };
        wordMap[word].total++;
        if (isCorrect) wordMap[word].correct++;
        
        results.push({ q: i + 1, word, your: yourAnswer, ok: correctAnswer, isCorrect });
    }
    
    console.log('\n========== 批改结果 ==========');
    results.forEach(r => {
        console.log(`【${r.q}】${r.word}: ${r.your} ${r.isCorrect ? '✓' : '✗ (正确答案: ' + r.ok + ')'}`);
    });
    console.log(`\n正确率: ${correct}/${results.length} (${(correct/results.length*100).toFixed(1)}%)`);
    
    console.log('\n========== 单词状态更新 ==========');
    const masteredWords = [];
    for (const [word, stats] of Object.entries(wordMap)) {
        if (stats.correct >= stats.total) {
            masteredWords.push(word);
            const wordRecords = (await getRecords(token, WORD_TABLE)).filter(r => r.fields.user === USER_ID && r.fields.Word === word);
            if (wordRecords.length > 0) {
                await updateRecord(token, WORD_TABLE, wordRecords[0].record_id, { 'Status': ['Mastered'] });
            }
        }
    }
    
    if (masteredWords.length > 0) {
        console.log('已掌握:', masteredWords.join(', '));
    } else {
        console.log('本次无单词达到掌握标准');
    }
    
    console.log('\n========== 统计更新 ==========');
    const userRecord = (await getRecords(token, STATS_TABLE)).find(r => r.fields.user === USER_ID);
    const wordRecords = (await getRecords(token, WORD_TABLE)).filter(r => r.fields.user === USER_ID);
    const total = wordRecords.length;
    const mastered = wordRecords.filter(r => r.fields.Status === 'Mastered').length;
    
    const fields = {
        'user': USER_ID,
        'total_words': total,
        'mastered_words': mastered,
        'pending_words': total - mastered,
        'total_tests': (userRecord?.fields?.total_tests || 0) + 1,
        'correct_count': (userRecord?.fields?.correct_count || 0) + correct,
        'accuracy_rate': `${((correct/results.length)*100).toFixed(1)}%`,
        'last_test_time': Date.now()
    };
    
    if (userRecord) {
        await updateRecord(token, STATS_TABLE, userRecord.record_id, fields);
    } else {
        await addRecord(token, STATS_TABLE, fields);
    }
    
    console.log(`总单词: ${total} | 已掌握: ${mastered} | 待复习: ${total - mastered}`);
}

main();
