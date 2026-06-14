const https = require('https');
const {
    APP_ID,
    APP_SECRET,
    TEST_TABLE,
} = require('./config');

const REQUIRED_FIELDS = [
    { field_name: 'assessment_kind', type: 1 },
    { field_name: 'source_test_id', type: 1 },
    { field_name: 'parent_review_id', type: 1 },
    { field_name: 'review_round', type: 2 },
    { field_name: 'review_status', type: 1 },
    { field_name: 'source_question_id', type: 1 },
];

function request(method, path, body, token) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const headers = { 'Content-Type': 'application/json' };
        if (data) headers['Content-Length'] = Buffer.byteLength(data);
        if (token) headers.Authorization = `Bearer ${token}`;
        const req = https.request(
            { hostname: 'open.feishu.cn', method, path, headers },
            response => {
                const chunks = [];
                response.on('data', chunk => chunks.push(chunk));
                response.on('end', () => {
                    try {
                        resolve(JSON.parse(Buffer.concat(chunks).toString()));
                    } catch (error) {
                        reject(error);
                    }
                });
            }
        );
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

async function getToken() {
    const response = await request(
        'POST',
        '/open-apis/auth/v3/tenant_access_token/internal',
        { app_id: APP_ID, app_secret: APP_SECRET }
    );
    if (response.code !== 0 || !response.tenant_access_token) {
        throw new Error(response.msg || '无法获取飞书访问令牌');
    }
    return response.tenant_access_token;
}

async function listFields(token) {
    const path = `/open-apis/bitable/v1/apps/${TEST_TABLE.appToken}` +
        `/tables/${TEST_TABLE.tableId}/fields?page_size=100`;
    const response = await request('GET', path, null, token);
    if (response.code !== 0) {
        throw new Error(response.msg || '无法读取测试表字段');
    }
    return response.data?.items || [];
}

async function createField(token, field) {
    const path = `/open-apis/bitable/v1/apps/${TEST_TABLE.appToken}` +
        `/tables/${TEST_TABLE.tableId}/fields`;
    const response = await request('POST', path, field, token);
    if (response.code !== 0) {
        throw new Error(
            `创建字段 ${field.field_name} 失败: ${response.msg || response.code}`
        );
    }
}

async function ensureReviewFields() {
    const token = await getToken();
    const existing = new Set(
        (await listFields(token)).map(field => field.field_name)
    );
    for (const field of REQUIRED_FIELDS) {
        if (existing.has(field.field_name)) {
            console.log(`已存在: ${field.field_name}`);
            continue;
        }
        await createField(token, field);
        console.log(`已创建: ${field.field_name}`);
    }
}

if (require.main === module) {
    ensureReviewFields().catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}

module.exports = {
    REQUIRED_FIELDS,
    ensureReviewFields,
};
