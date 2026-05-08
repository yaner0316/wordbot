const https = require('https');

const USER_ID = process.argv[2];
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

async function getRecords(token) {
    const res = await request('GET', `/open-apis/bitable/v1/apps/${STATS_TABLE.appToken}/tables/${STATS_TABLE.tableId}/records?page_size=500`, null, token);
    return res.data?.items || [];
}

async function main() {
    const token = await getToken();
    const records = await getRecords(token);
    
    if (USER_ID) {
        const user = records.find(r => String(r.fields.user) === String(USER_ID));
        if (user) {
            const f = user.fields;
            const totalTests = f.total_tests || 0;
            const correctCount = f.correct_count || 0;
            const totalQuestions = totalTests * 10;
            const acc = totalQuestions > 0 ? ((correctCount / totalQuestions) * 100).toFixed(1) + '%' : '-';
            const lastTest = f.last_test_time ? new Date(f.last_test_time).toLocaleString('zh-CN') : '-';
            console.log(`\n========== ${USER_ID} 记忆统计 ==========`);
            console.log(`总单词数: ${f.total_words || 0}`);
            console.log(`已掌握: ${f.mastered_words || 0}`);
            console.log(`待复习: ${f.pending_words || 0}`);
            console.log(`测试次数: ${totalTests}`);
            console.log(`正确次数: ${correctCount}`);
            console.log(`总正确率: ${acc}`);
            console.log(`最后测试: ${lastTest}`);
        } else {
            console.log(`未找到用户 ${USER_ID} 的记录`);
        }
    } else {
        console.log('\n========== 记忆看板 ==========');
        if (records.length === 0) {
            console.log('暂无数据');
        }
        records.forEach(r => {
            const f = r.fields;
            const user = f.user || '未知';
            const totalTests = f.total_tests || 0;
            const correctCount = f.correct_count || 0;
            const acc = totalTests > 0 ? ((correctCount / totalTests) * 100).toFixed(1) + '%' : '-';
            console.log(`${user}: ${f.total_words || 0}词 | ${f.mastered_words || 0}已掌握 | 正确率${acc}`);
        });
        console.log('\n用法: node stats.js [用户名]');
    }
}

main();
