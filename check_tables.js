const https = require('https');

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

async function main() {
    const token = await getToken();
    
    const APP_TOKEN = 'BWhIb2hjaaDQHdsNhWRcPluBncg';
    const TABLE_ID = 'tblyMh69dws6ty6n';
    
    console.log('获取单词表记录...');
    const res = await request('GET', '/open-apis/bitable/v1/apps/' + APP_TOKEN + '/tables/' + TABLE_ID + '/records?page_size=500', null, token);
    
    const items = res.data?.items || [];
    console.log('记录数:', items.length);
    
    const userStats = {};
    items.forEach(r => {
        const u = r.fields?.user || 'unknown';
        if (!userStats[u]) userStats[u] = { total: 0, mastered: 0 };
        userStats[u].total++;
        if (r.fields?.Status === 'Mastered') userStats[u].mastered++;
    });
    
    console.log('\n用户统计:');
    for (const [u, s] of Object.entries(userStats)) {
        console.log(u + ': 总' + s.total + ' 已掌握' + s.mastered);
    }
}

main();
