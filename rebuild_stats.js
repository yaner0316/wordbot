const https = require('https');

const WORD_TABLE = { appToken: 'BWhIb2hjaaDQHdsNhWRcPluBncg', tableId: 'tblyMh69dws6ty6n' };
const STATS_TABLE = { appToken: 'Mbh7bK7Jrah7XMsV9lhceE7cnyh', tableId: 'tblQBYKzcQuz8sSq' };

function request(method, path, body, token) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const headers = { 'Content-Type': 'application/json' };
        if (data) headers['Content-Length'] = Buffer.byteLength(data);
        if (token) headers['Authorization'] = 'Bearer ' + token;
        const req = https.request({ hostname: 'open.feishu.cn', path, method, headers }, (res) => {
            let chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
                catch (e) { resolve({}); }
            });
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

async function getRecords(table) {
    const res = await request('GET', '/open-apis/bitable/v1/apps/' + table.appToken + '/tables/' + table.tableId + '/records?page_size=500', null, await getToken());
    return res.data?.items || [];
}

async function deleteRecord(table, recordId) {
    const token = await getToken();
    return request('DELETE', '/open-apis/bitable/v1/apps/' + table.appToken + '/tables/' + table.tableId + '/records/' + recordId, null, token);
}

async function addRecord(token, table, fields) {
    return request('POST', '/open-apis/bitable/v1/apps/' + table.appToken + '/tables/' + table.tableId + '/records', { fields }, token);
}

async function main() {
    console.log('清空统计表...');
    const existingStats = await getRecords(STATS_TABLE);
    for (const r of existingStats) {
        await deleteRecord(STATS_TABLE, r.record_id);
    }
    
    console.log('统计单词数...');
    const words = await getRecords(WORD_TABLE);
    const userStats = {};
    words.forEach(r => {
        const u = r.fields.user || 'unknown';
        if (!userStats[u]) userStats[u] = { total: 0, mastered: 0 };
        userStats[u].total++;
        if (r.fields.Status === 'Mastered') userStats[u].mastered++;
    });
    
    const token = await getToken();
    console.log('\n重建统计:');
    for (const [user, stats] of Object.entries(userStats)) {
        await addRecord(token, STATS_TABLE, {
            'user': user,
            'total_words': stats.total,
            'mastered_words': stats.mastered,
            'pending_words': stats.total - stats.mastered,
            'total_tests': 0,
            'correct_count': 0,
            'accuracy_rate': 0
        });
        console.log(user + ': 总' + stats.total + ' 已掌握' + stats.mastered + ' 待复习' + (stats.total - stats.mastered));
    }
}

main();
