const https = require('https');

const APP_ID = 'cli_a97e125f0ab89cb5';
const APP_SECRET = 'pppKJAybbiNqKIDB9hlvshTnXGPg7OVH';
const APP_TOKEN = 'BWhIb2hjaaDQHdsNhWRcPluBncg';
const TABLE_ID = 'tblyMh69dws6ty6n';

function request(method, path, body, token) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const headers = { 'Content-Type': 'application/json' };
        if (data) headers['Content-Length'] = Buffer.byteLength(data);
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const req = https.request({ hostname: 'open.feishu.cn', path, method, headers }, (res) => {
            let chunks = [];
            res.on('data', chunk => chunks.push(chunk));
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

async function addField(token, field) {
    const res = await request('POST', `/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/fields`, field, token);
    if (res.code === 0) {
        console.log(`✓ ${field.field_name}`);
    } else {
        console.log(`✗ ${field.field_name}: ${res.msg}`);
    }
    return res;
}

async function main() {
    const token = await getToken();
    const fields = [
        { field_name: 'user', type: 1 },
        { field_name: 'Word', type: 1 },
        { field_name: 'Status', type: 3, property: { options: [{ name: 'Pending' }, { name: 'Mastered' }] } },
        { field_name: 'record_time', type: 5 },
        { field_name: 'Error_Count', type: 2 },
        { field_name: 'Last_Tested', type: 5 },
        { field_name: 'multi_definition', type: 4, property: { options: [{ name: '是' }, { name: '否' }] } },
        { field_name: 'remember_time', type: 5 },
        { field_name: 'sample_sentence', type: 1 }
    ];
    
    for (const field of fields) {
        await addField(token, field);
    }
    console.log('\n完成');
}

main();
