const https = require('https');

const STATS_TABLE = { appToken: 'Mbh7bK7Jrah7XMsV9lhceE7cnyh', tableId: 'tblQBYKzcQuz8sSq' };

function request(method, path, body, token) {
    return new Promise((resolve, reject) => {
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
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

async function getToken() {
    const res = await request('POST', '/open-apis/auth/v3/tenant_access_token/internal', { app_id: 'cli_a97e125f0ab89cb5', app_secret: 'pppKJAybbiNqKIDB9hlvshTnXGPg7OVH' });
    return res.tenant_access_token;
}

async function addRecord(fields) {
    const token = await getToken();
    return request('POST', '/open-apis/bitable/v1/apps/' + STATS_TABLE.appToken + '/tables/' + STATS_TABLE.tableId + '/records', { fields }, token);
}

async function main() {
    await addRecord({ user: 'yusi', total_words: 190, mastered_words: 111, pending_words: 79, total_tests: 0, correct_count: 0 });
    console.log('已创建yusi统计');
    await addRecord({ user: 'qiuqiu', total_words: 144, mastered_words: 72, pending_words: 72, total_tests: 0, correct_count: 0 });
    console.log('已创建qiuqiu统计');
}

main();
