const https = require('https');

const APP_ID = 'cli_a97e125f0ab89cb5';
const APP_SECRET = 'pppKJAybbiNqKIDB9hlvshTnXGPg7OVH';
const APP_TOKEN = 'BWhIb2hjaaDQHdsNhWRcPluBncg';
const TABLE_ID = 'tblyMh69dws6ty6n';

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
    const now = Date.now();
    const words = [
        'conduct', 'conference', 'confession', 'patriotic', 'handsome', 
        'fairy', 'inherit', 'convey', 'grace', 'dusk', 
        'course', 'instance', 'delicate', 'cushion', 'seize', 'comerical'
    ];
    
    let count = 0;
    for (const word of words) {
        const res = await addRecord(token, {
            'user': 'yusi',
            'Word': word,
            'record_time': now,
            'Error_Count': 0
        });
        if (res.code === 0) count++;
        else console.log(`Error adding ${word}: ${res.msg}`);
    }
    
    console.log(`[System]: 已录入 ${count} 个新单词。目前待掌握总数：16。`);
}

main();
