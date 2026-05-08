require('dotenv').config();

const https = require('https');

const APP_ID = process.env.FEISHU_APP_ID || 'cli_a97e125f0ab89cb5';
const APP_SECRET = process.env.FEISHU_APP_SECRET || 'pppKJAybbiNqKIDB9hlvshTnXGPg7OVH';
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
const WORD_TABLE = { appToken: 'BWhIb2hjaaDQHdsNhWRcPluBncg', tableId: 'tblyMh69dws6ty6n' };

// 飞书 API 请求封装
function feishuRequest(method, path, body, token) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const headers = { 'Content-Type': 'application/json' };
        if (data) headers['Content-Length'] = Buffer.byteLength(data);
        if (token) headers['Authorization'] = 'Bearer ' + token;
        const req = https.request({ hostname: 'open.feishu.cn', path, method, headers }, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

// 获取飞书 Token
async function getToken() {
    const res = await feishuRequest('POST', '/open-apis/auth/v3/tenant_access_token/internal', { app_id: APP_ID, app_secret: APP_SECRET });
    return res.tenant_access_token;
}

// 查找单词记录
async function findWord(word) {
    const token = await getToken();
    const res = await feishuRequest('GET', `/open-apis/bitable/v1/apps/${WORD_TABLE.appToken}/tables/${WORD_TABLE.tableId}/records?page_size=500`, null, token);
    const records = res.data?.items || [];
    return records.find(r => r.fields.Word?.toLowerCase() === word.toLowerCase());
}

// 更新记录
async function updateRecord(recordId, fields) {
    const token = await getToken();
    const res = await feishuRequest('PUT', `/open-apis/bitable/v1/apps/${WORD_TABLE.appToken}/tables/${WORD_TABLE.tableId}/records/${recordId}`, { fields }, token);
    return res.code === 0;
}

// MiniMax API 调用
function callMiniMaxAPI(prompt) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({
            model: 'MiniMax-M2.7',
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
                    resolve(result.choices?.[0]?.message?.content);
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

// 测试主流程
async function testWord(word) {
    console.log(`\n========== 测试单词: ${word} ==========\n`);

    // 1. 查找记录
    console.log('1. 查找记录...');
    const record = await findWord(word);
    if (!record) {
        console.log(`   单词 ${word} 不存在`);
        return;
    }
    console.log(`   找到记录: ${record.record_id}`);
    console.log(`   当前状态: ${record.fields.Status || '无'}`);

    // 2. 翻译
    console.log('\n2. 翻译...');
    const translatePrompt = `翻译成中文（只返回翻译结果）：${record.fields.Meaning || word}`;
    try {
        const cnMeaning = await callMiniMaxAPI(translatePrompt);
        console.log(`   英文释义: ${record.fields.Meaning}`);
        console.log(`   中文释义: ${cnMeaning}`);
    } catch (e) {
        console.log(`   翻译失败: ${e.message}`);
        return;
    }

    // 3. 生成例句
    console.log('\n3. 生成例句...');
    const examplePrompt = `为单词 "${word}" 生成一个英文例句，返回JSON：{"example": "例句"}`;
    try {
        const exampleResult = await callMiniMaxAPI(examplePrompt);
        const match = exampleResult.match(/"example"\s*:\s*"([^"]+)"/);
        const example = match ? match[1] : null;
        console.log(`   例句: ${example || '生成失败'}`);
    } catch (e) {
        console.log(`   例句生成失败: ${e.message}`);
    }

    // 4. 生成干扰词
    console.log('\n4. 生成干扰词...');
    const distPrompt = `为单词 "${word}" 生成3个含义相近的英文干扰词，返回JSON：{"distractors": ["word1", "word2", "word3"]}`;
    try {
        const distResult = await callMiniMaxAPI(distPrompt);
        const match = distResult.match(/"distractors"\s*:\s*\[(.*?)\]/s);
        if (match) {
            const words = match[1].match(/"([^"]+)"/g);
            if (words) {
                const distractors = words.map(w => w.replace(/"/g, ''));
                console.log(`   干扰词: ${distractors.join(', ')}`);
            }
        }
    } catch (e) {
        console.log(`   干扰词生成失败: ${e.message}`);
    }

    // 5. 更新状态为 Mastered
    console.log('\n5. 更新状态为 Mastered...');
    const success = await updateRecord(record.record_id, { Status: 'Mastered' });
    if (success) {
        console.log('   ✓ 状态已更新为 Mastered');
    } else {
        console.log('   ✗ 状态更新失败');
    }

    console.log('\n========== 测试完成 ==========');
}

// 执行测试
const word = process.argv[2] || 'accept';
testWord(word);