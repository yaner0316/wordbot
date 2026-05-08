const https = require('https');

const APP_ID = 'cli_a97e125f0ab89cb5';
const APP_SECRET = 'pppKJAybbiNqKIDB9hlvshTnXGPg7OVH';

function postRequest(path, body, token = null) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const headers = {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
        };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        const options = {
            hostname: 'open.feishu.cn',
            path: path,
            method: 'POST',
            headers: headers
        };
        const req = https.request(options, (res) => {
            let chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const result = Buffer.concat(chunks).toString();
                resolve(JSON.parse(result));
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function getToken() {
    const result = await postRequest('/open-apis/auth/v3/tenant_access_token/internal', {
        app_id: APP_ID,
        app_secret: APP_SECRET
    });
    return result.tenant_access_token;
}

async function createBitable(token) {
    const result = await postRequest('/open-apis/bitable/v1/apps', {
        name: '英语词汇考核表'
    }, token);
    return result;
}

async function addFields(token, appToken, tableId) {
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
        try {
            await postRequest(`/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields`, field, token);
        } catch (e) {}
    }
}

async function main() {
    try {
        console.log('获取访问令牌...');
        const token = await getToken();
        console.log('创建多维表格...');
        const bitable = await createBitable(token);
        console.log('表格创建结果:', JSON.stringify(bitable, null, 2));

        if (bitable.code === 0 && bitable.data && bitable.data.app) {
            const appToken = bitable.data.app.token;
            const tableId = bitable.data.app.default_table_id;
            console.log('App Token:', appToken);
            console.log('Table ID:', tableId);
            console.log('添加字段...');
            await addFields(token, appToken, tableId);
            console.log('完成!');
        }
    } catch (e) {
        console.error('错误:', e.message);
    }
}

main();
