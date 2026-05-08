const XLSX = require('xlsx');
const https = require('https');

function request(method, path, body, token) {
    return new Promise((resolve) => {
        const data = body ? JSON.stringify(body) : null;
        const headers = { 'Content-Type': 'application/json' };
        if (data) headers['Content-Length'] = Buffer.byteLength(data);
        if (token) headers['Authorization'] = 'Bearer ' + token;
        const req = https.request({ hostname: 'open.feishu.cn', path, method, headers }, (res) => {
            let chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
                catch (e) { resolve({}); }
            });
        });
        req.on('error', () => resolve({}));
        if (data) req.write(data);
        req.end();
    });
}

async function getToken() {
    const res = await request('POST', '/open-apis/auth/v3/tenant_access_token/internal', { app_id: 'cli_a97e125f0ab89cb5', app_secret: 'pppKJAybbiNqKIDB9hlvshTnXGPg7OVH' });
    return res.tenant_access_token;
}

async function addRecord(appToken, tableId, fields) {
    return request('POST', '/open-apis/bitable/v1/apps/' + appToken + '/tables/' + tableId + '/records', { fields }, await getToken());
}

async function main() {
    console.log('写入测试...');
    const res = await addRecord('BWhIb2hjaaDQHdsNhWRcPluBncg', 'tblyMh69dws6ty6n', { 
        'Word': 'test_word', 
        'user': 'yusi'
    });
    console.log('结果:', JSON.stringify(res));
}

main();
