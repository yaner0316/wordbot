const https = require('https');

const STATS_TABLE = { appToken: 'Mbh7bK7Jrah7XMsV9lhceE7cnyh', tableId: 'tblQBYKzcQuz8sSq' };

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
    const res = await request('POST', '/open-apis/auth/v3/tenant_access_token/internal', {
        app_id: 'cli_a97e125f0ab89cb5', app_secret: 'pppKJAybbiNqKIDB9hlvshTnXGPg7OVH'
    });
    return res.tenant_access_token;
}

async function addRecord(token, fields) {
    return request('POST', `/open-apis/bitable/v1/apps/${STATS_TABLE.appToken}/tables/${STATS_TABLE.tableId}/records`, { fields }, token);
}

async function main() {
    const token = await getToken();
    
    await addRecord(token, {
        'user': 'yusi',
        'total_words': 37,
        'mastered_words': 5,
        'pending_words': 32,
        'total_tests': 2,
        'correct_count': 10,
        'accuracy_rate': '50.0%',
        'last_test_time': Date.now()
    });
    
    console.log('yusi 统计记录已创建');
}

main();
