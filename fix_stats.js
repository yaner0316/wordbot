const https = require('https');

const APP_ID = 'cli_a97e125f0ab89cb5';
const APP_SECRET = 'pppKJAybbiNqKIDB9hlvshTnXGPg7OVH';
const APP_TOKEN = 'Mbh7bK7Jrah7XMsV9lhceE7cnyh';
const TABLE_ID = 'tblQBYKzcQuz8sSq';

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

async function getRecords(token) {
    const res = await request('GET', `/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records?page_size=500`, null, token);
    return res.data?.items || [];
}

async function updateRecord(token, recordId, fields) {
    return request('PUT', `/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/${recordId}`, { fields }, token);
}

async function main() {
    const token = await getToken();
    const records = await getRecords(token);
    const user = records.find(r => r.fields.user === 'yusi');
    
    if (user) {
        await updateRecord(token, user.record_id, {
            'total_tests': 1,
            'correct_count': 5
        });
        console.log('已更新: 测试次数=1, 正确次数=5');
    } else {
        console.log('未找到yusi记录');
    }
}

main();
