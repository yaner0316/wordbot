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

async function addField(fieldName) {
    const token = await getToken();
    const res = await request('POST', `/open-apis/bitable/v1/apps/${WORD_TABLE.appToken}/tables/${WORD_TABLE.tableId}/fields`, {
        field_name: fieldName,
        type: 1
    }, token);
    return res;
}

async function listFields() {
    const token = await getToken();
    const res = await request('GET', `/open-apis/bitable/v1/apps/${WORD_TABLE.appToken}/tables/${WORD_TABLE.tableId}/fields`, null, token);
    return res.data?.items || [];
}

async function main() {
    console.log('检查现有字段...\n');
    const fields = await listFields();
    console.log('现有字段:');
    fields.forEach(f => console.log(`  - ${f.field_name} (${f.type})`));
    
    const hasCN = fields.some(f => f.field_name === 'CN_Meaning');
    if (hasCN) {
        console.log('\nCN_Meaning 字段已存在');
    } else {
        console.log('\n添加 CN_Meaning 字段...');
        const result = await addField('CN_Meaning');
        if (result.code === 0) {
            console.log('添加成功!');
        } else if (result.error?.code === '99991642') {
            console.log('字段已存在或同名');
        } else {
            console.log('添加失败:', result.msg);
        }
    }
}

main().catch(console.error);