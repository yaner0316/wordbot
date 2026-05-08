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

async function getRecords(appToken, tableId) {
    return request('GET', '/open-apis/bitable/v1/apps/' + appToken + '/tables/' + tableId + '/records?page_size=500', null, await getToken());
}

async function addRecord(appToken, tableId, fields) {
    return request('POST', '/open-apis/bitable/v1/apps/' + appToken + '/tables/' + tableId + '/records', { fields }, await getToken());
}

async function main() {
    console.log('检查单词表...');
    const res = await getRecords('BWhIb2hjaaDQHdsNhWRcPluBncg', 'tblyMh69dws6ty6n');
    console.log('记录数:', res.data?.items?.length || 0);
    if (res.data?.items?.[0]) {
        console.log('第一条:', JSON.stringify(res.data.items[0].fields));
    }
    
    console.log('\n检查干扰项表...');
    const res2 = await getRecords('GskxbMxMgaDPFRsgqS4cdWvdndb', 'tbl3EgurgOTXdM3V');
    console.log('记录数:', res2.data?.items?.length || 0);
    
    if (res.data?.items?.length === 0) {
        console.log('\n写入测试...');
        await addRecord('BWhIb2hjaaDQHdsNhWRcPluBncg', 'tblyMh69dws6ty6n', { 'Word': 'test', 'user': 'yusi', 'Status': ['Pending'] });
        console.log('已写入测试记录');
    }
}

main();
