const https = require('https');

const APP_ID = process.env.FEISHU_APP_ID;
if (!APP_ID) {
    console.error('错误：缺少 FEISHU_APP_ID 环境变量');
    process.exit(1);
}
const APP_SECRET = process.env.FEISHU_APP_SECRET;
if (!APP_SECRET) {
    throw new Error('FEISHU_APP_SECRET is required');
}
const TEST_TABLE = { appToken: 'FyyPb1urFacfn7sGSjpca2UwnHe', tableId: 'tbl6Nx0kJWjr7qQZ' };

function request(method, path, body, token) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const headers = { 'Content-Type': 'application/json' };
        if (data) headers['Content-Length'] = Buffer.byteLength(data);
        if (token) headers['Authorization'] = 'Bearer ' + token;
        const req = https.request({ hostname: 'open.feishu.cn', path, method, headers }, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
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

async function main() {
    const token = await getToken();
    const res = await request('GET', `/open-apis/bitable/v1/apps/${TEST_TABLE.appToken}/tables/${TEST_TABLE.tableId}/fields`, null, token);
    
    if (res.data && res.data.items) {
        res.data.items.forEach(f => {
            console.log(`${f.field_name} (type: ${f.type}):`);
            if (f.property && f.property.options) {
                f.property.options.forEach(o => console.log(`  - ${o.name}: ${o.id}`));
            }
        });
    }
}

main().catch(console.error);
