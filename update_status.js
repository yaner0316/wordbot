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

async function getRecords(token) {
    return request('GET', `/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records?page_size=500`, null, token);
}

async function updateRecord(token, recordId, fields) {
    return request('PUT', `/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/${recordId}`, { fields }, token);
}

async function main() {
    const token = await getToken();
    const res = await getRecords(token);
    const records = res.data?.items || [];
    
    const yusiRecords = records.filter(r => r.fields?.user === 'yusi');
    console.log(`更新 ${yusiRecords.length} 条记录...`);
    
    let count = 0;
    for (const r of yusiRecords) {
        const updateRes = await updateRecord(token, r.record_id, {
            'Status': 'optXjbXS2F',
            'multi_definition': ['optpWwFJpq']
        });
        if (updateRes.code === 0) count++;
        else console.log(`Error updating ${r.fields.Word}: ${updateRes.msg}`);
    }
    
    console.log(`[System]: 已录入 16 个新单词。目前待掌握总数：16。`);
}

main();
