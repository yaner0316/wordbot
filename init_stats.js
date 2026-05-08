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

async function addRecord(token, fields) {
    return request('POST', `/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records`, { fields }, token);
}

async function main() {
    const token = await getToken();
    const res = await addRecord(token, {
        'user': 'yusi',
        'total_words': 37,
        'mastered_words': 5,
        'pending_words': 32,
        'total_tests': 2,
        'correct_count': 10,
        'accuracy_rate': 50.0
    });
    
    if (res.code === 0) {
        console.log('yusi 统计记录已创建');
    } else {
        console.log('错误:', res.msg);
    }
}

main();
