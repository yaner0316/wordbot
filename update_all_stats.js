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

async function getRecords(token) {
    const res = await request('GET', `/open-apis/bitable/v1/apps/${WORD_TABLE.appToken}/tables/${WORD_TABLE.tableId}/records?page_size=500`, null, token);
    return res.data?.items || [];
}

async function updateRecord(token, recordId, fields) {
    return request('PUT', `/open-apis/bitable/v1/apps/${STATS_TABLE.appToken}/tables/${STATS_TABLE.tableId}/records/${recordId}`, { fields }, token);
}

async function addRecord(token, fields) {
    return request('POST', `/open-apis/bitable/v1/apps/${STATS_TABLE.appToken}/tables/${STATS_TABLE.tableId}/records`, { fields }, token);
}

async function getStatsRecords(token) {
    const res = await request('GET', `/open-apis/bitable/v1/apps/${STATS_TABLE.appToken}/tables/${STATS_TABLE.tableId}/records?page_size=500`, null, token);
    return res.data?.items || [];
}

async function main() {
    const token = await getToken();
    const words = await getRecords(token);
    const stats = await getStatsRecords(token);
    
    const userWords = {};
    words.forEach(r => {
        const u = r.fields.user || 'unknown';
        if (!userWords[u]) userWords[u] = { total: 0, mastered: 0 };
        userWords[u].total++;
        if (r.fields.Status === 'Mastered') userWords[u].mastered++;
    });
    
    for (const [user, data] of Object.entries(userWords)) {
        const existing = stats.find(s => s.fields.user === user);
        const fields = {
            'user': user,
            'total_words': data.total,
            'mastered_words': data.mastered,
            'pending_words': data.total - data.mastered
        };
        
        if (existing) {
            await updateRecord(token, existing.record_id, fields);
            console.log(`已更新 ${user}: 总${data.total} 已掌握${data.mastered}`);
        } else {
            await addRecord(token, fields);
            console.log(`已创建 ${user}: 总${data.total} 已掌握${data.mastered}`);
        }
    }
}

main();
