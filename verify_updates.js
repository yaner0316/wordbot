const https = require('https');

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
            res.on('end', () => {
                try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
                catch { resolve({}); }
            });
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

async function getRecords() {
    const token = await getToken();
    const res = await request('GET', `/open-apis/bitable/v1/apps/${WORD_TABLE.appToken}/tables/${WORD_TABLE.tableId}/records?page_size=500`, null, token);
    return res.data?.items || [];
}

async function main() {
    console.log('验证更新后的数据...\n');
    const records = await getRecords();
    
    const yusiRecords = records.filter(r => r.fields.user === 'yusi');
    console.log(`yusi用户总记录数: ${yusiRecords.length}`);
    
    const mastered = yusiRecords.filter(r => r.fields.Status === 'Mastered');
    const pending = yusiRecords.filter(r => r.fields.Status === 'Pending');
    
    console.log(`已掌握(Mastered): ${mastered.length}`);
    console.log(`待复习(Pending): ${pending.length}`);
    
    console.log('\n已掌握单词示例(前10个):');
    mastered.slice(0, 10).forEach(r => {
        console.log(`- ${r.fields.Word}`);
    });
    
    console.log('\n待复习单词示例(前10个):');
    pending.slice(0, 10).forEach(r => {
        console.log(`- ${r.fields.Word}`);
    });
    
    console.log('\n多义词统计:');
    const multiDefTrue = yusiRecords.filter(r => r.fields.multi_definition === true);
    const multiDefFalse = yusiRecords.filter(r => r.fields.multi_definition === false);
    console.log(`是(True): ${multiDefTrue.length}`);
    console.log(`否(False): ${multiDefFalse.length}`);
    
    console.log('\n检查一条完整记录:');
    const sample = yusiRecords[0];
    console.log('字段:', JSON.stringify(sample.fields, null, 2));
}

main().catch(console.error);
