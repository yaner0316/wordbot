const https = require('https');

const APP_ID = 'cli_a97e125f0ab89cb5';
const APP_SECRET = 'pppKJAybbiNqKIDB9hlvshTnXGPg7OVH';

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
    const res = await request('POST', '/open-apis/auth/v3/tenant_access_token/internal', {
        app_id: APP_ID, app_secret: APP_SECRET
    });
    return res.tenant_access_token;
}

async function addField(table, fieldName) {
    const token = await getToken();
    const res = await request('POST', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/fields`, {
        field_name: fieldName,
        type: 1
    }, token);
    if (res.code === 0) {
        console.log(`✓ ${fieldName} 添加成功`);
    } else if (res.error?.code === '99991642') {
        console.log(`- ${fieldName} 已存在`);
    } else {
        console.log(`${fieldName}:`, JSON.stringify(res));
    }
}

async function main() {
    await addField(WORD_TABLE, 'multi_definition');
    console.log('完成');
}

main().catch(console.error);
