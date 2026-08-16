require('dotenv').config();

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
const WORD_TABLE = { appToken: 'BWhIb2hjaaDQHdsNhWRcPluBncg', tableId: 'tblyMh69dws6ty6n' };

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

async function getRecords() {
    const token = await getToken();
    const res = await request('GET', `/open-apis/bitable/v1/apps/${WORD_TABLE.appToken}/tables/${WORD_TABLE.tableId}/records?page_size=5`, null, token);
    return res.data?.items || [];
}

async function main() {
    console.log('璇诲彇鍓?鏉¤褰?..\n');
    const records = await getRecords();
    
    for (const r of records) {
        console.log(`\n鍗曡瘝: ${r.fields.Word}`);
        console.log('鎵�鏈夊瓧娈?', Object.keys(r.fields));
        console.log('CN_Meaning:', r.fields.CN_Meaning);
        console.log('cnMeaning:', r.fields.cnMeaning);
        console.log('meaning:', r.fields.Meaning?.substring(0, 30));
    }
}

main().catch(console.error);