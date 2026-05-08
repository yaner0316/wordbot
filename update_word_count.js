const https = require('https');

const WORD_TABLE = { appToken: 'BWhIb2hjaaDQHdsNhWRcPluBncg', tableId: 'tblyMh69dws6ty6n' };
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
    const res = await request('POST', '/open-apis/auth/v3/tenant_access_token/internal', { app_id: 'cli_a97e125f0ab89cb5', app_secret: 'pppKJAybbiNqKIDB9hlvshTnXGPg7OVH' });
    return res.tenant_access_token;
}

async function getRecords(token, table) {
    const res = await request('GET', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records?page_size=500`, null, token);
    return res.data?.items || [];
}

async function updateRecord(token, table, recordId, fields) {
    return request('PUT', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records/${recordId}`, { fields }, token);
}

async function main() {
    const token = await getToken();
    
    const wordRecords = await getRecords(token, WORD_TABLE);
    const totalWords = wordRecords.length;
    const mastered = wordRecords.filter(r => r.fields.Status === 'Mastered').length;
    
    console.log(`单词总数: ${totalWords}, 已掌握: ${mastered}, 待复习: ${totalWords - mastered}`);
    
    const statsRecords = await getRecords(token, STATS_TABLE);
    const yusiStats = statsRecords.find(r => r.fields.user === 'yusi');
    
    if (yusiStats) {
        await updateRecord(token, STATS_TABLE, yusiStats.record_id, {
            'total_words': totalWords,
            'mastered_words': mastered,
            'pending_words': totalWords - mastered
        });
        console.log('统计已更新');
    }
}

main();
