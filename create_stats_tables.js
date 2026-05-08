const https = require('https');

const APP_ID = 'cli_a97e125f0ab89cb5';
const APP_SECRET = 'pppKJAybbiNqKIDB9hlvshTnXGPg7OVH';

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
    const res = await request('POST', '/open-apis/auth/v3/tenant_access_token/internal', { app_id: APP_ID, app_secret: APP_SECRET });
    return res.tenant_access_token;
}

async function createBitable(token, name) {
    const res = await request('POST', '/open-apis/bitable/v1/apps', { name }, token);
    if (res.code !== 0) { console.log('创建失败:', res.msg); return null; }
    return { appToken: res.data.app.app_token, tableId: res.data.app.default_table_id };
}

async function addFields(token, appToken, tableId, fields) {
    for (const f of fields) {
        await request('POST', `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields`, f, token);
    }
}

async function main() {
    const token = await getToken();
    
    console.log('1. 创建测试记录表...');
    const testTable = await createBitable(token, '测试记录表');
    if (testTable) {
        await addFields(token, testTable.appToken, testTable.tableId, [
            { field_name: 'user', type: 1 },
            { field_name: 'test_id', type: 1 },
            { field_name: 'word', type: 1 },
            { field_name: 'your_answer', type: 1 },
            { field_name: 'correct_answer', type: 1 },
            { field_name: 'is_correct', type: 4, property: { options: [{ name: '正确' }, { name: '错误' }] } },
            { field_name: 'question_type', type: 2 },
            { field_name: 'test_time', type: 5 }
        ]);
        console.log('  测试记录表:', testTable.appToken);
    }
    
    console.log('2. 创建记忆看板...');
    const statsTable = await createBitable(token, '记忆看板');
    if (statsTable) {
        await addFields(token, statsTable.appToken, statsTable.tableId, [
            { field_name: 'user', type: 1 },
            { field_name: 'total_words', type: 2 },
            { field_name: 'mastered_words', type: 2 },
            { field_name: 'pending_words', type: 2 },
            { field_name: 'total_tests', type: 2 },
            { field_name: 'correct_count', type: 2 },
            { field_name: 'accuracy_rate', type: 2 },
            { field_name: 'last_test_time', type: 5 }
        ]);
        console.log('  记忆看板:', statsTable.appToken);
    }
    
    console.log('\n完成!请保存以下Token到.env:');
    console.log('FEISHU_TEST_TABLE_APP_TOKEN=' + (testTable?.appToken || ''));
    console.log('FEISHU_TEST_TABLE_ID=' + (testTable?.tableId || ''));
    console.log('FEISHU_STATS_APP_TOKEN=' + (statsTable?.appToken || ''));
    console.log('FEISHU_STATS_TABLE_ID=' + (statsTable?.tableId || ''));
}

main();
