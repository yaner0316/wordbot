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

async function main() {
    const token = await getToken();
    
    console.log('查询所有表格...');
    const apps = ['BWhIb2hjaaDQHdsNhWRcPluBncg', 'GskxbMxMgaDPFRsgqS4cdWvdndb', 'FyyPb1urFacfn7sGSjpca2UwnHe', 'Mbh7bK7Jrah7XMsV9lhceE7cnyh'];
    
    for (const appToken of apps) {
        const res = await request('GET', '/open-apis/bitable/v1/apps/' + appToken + '/tables', null, token);
        console.log('\nApp:', appToken);
        console.log('Tables:', JSON.stringify(res.data?.items || []));
    }
}

main();
