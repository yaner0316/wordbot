require('dotenv').config();

const https = require('https');

const APP_ID = process.env.FEISHU_APP_ID || 'cli_a97e125f0ab89cb5';
const APP_SECRET = process.env.FEISHU_APP_SECRET || 'pppKJAybbiNqKIDB9hlvshTnXGPg7OVH';
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
    const records = await getRecords();
    
    for (const r of records) {
        const word = r.fields.Word;
        const poolEntry = {
            word: word,
            CN_Meaning: r.fields.CN_Meaning || '',
            CN_Meaning_check: r.fields.CN_Meaning?.trim() || '',
            hasCN: !!(r.fields.CN_Meaning?.trim())
        };
        console.log(word, '-> CN:', JSON.stringify(poolEntry));
    }
}

main().catch(console.error);