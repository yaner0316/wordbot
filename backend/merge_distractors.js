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
    const res = await request('POST', '/open-apis/auth/v3/tenant_access_token/internal', { app_id: APP_ID, app_secret: APP_SECRET });
    return res.tenant_access_token;
}

async function getRecords(table) {
    const token = await getToken();
    const res = await request('GET', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records?page_size=500`, null, token);
    return res.data?.items || [];
}

async function updateRecord(table, recordId, fields) {
    const token = await getToken();
    const res = await request('PUT', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records/${recordId}`, { fields }, token);
    if (res.code !== 0) {
        console.log('更新失败:', res.msg);
    }
    return res;
}

async function addField(table, fieldName) {
    const token = await getToken();
    const res = await request('POST', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/fields`, {
        field_name: fieldName,
        type: 1
    }, token);
    if (res.code === 0 || res.error?.code === '99991642') {
        console.log(`✓ 字段 ${fieldName} 已存在或添加成功`);
    } else {
        console.log(`字段 ${fieldName}:`, JSON.stringify(res).substring(0, 100));
    }
}

async function main() {
    console.log('合并干扰词到单词表...\n');
    
    await addField(WORD_TABLE, 'Distractors');
    
    const records = await getRecords(WORD_TABLE);
    console.log(`单词表: ${records.length} 条记录\n`);
    
    let updated = 0;
    let skipped = 0;
    
    for (const record of records) {
        const word = record.fields.Word;
        if (!word) continue;
        
        const existingDist = record.fields.Distractors;
        if (existingDist && existingDist.split(',').filter(d => d.trim()).length >= 3) {
            skipped++;
            continue;
        }
        
        console.log(`处理: ${word}`);
        
        const candidates = records
            .filter(r => r.fields.Word && r.fields.Word.toLowerCase() !== word.toLowerCase())
            .map(r => r.fields.Word.toLowerCase());
        
        const shuffled = candidates.sort(() => Math.random() - 0.5);
        const newDistractors = shuffled.slice(0, 3).join(',');
        
        await updateRecord(WORD_TABLE, record.record_id, { Distractors: newDistractors });
        console.log(`  干扰词: ${newDistractors}`);
        
        updated++;
        await new Promise(r => setTimeout(r, 100));
    }
    
    console.log(`\n完成！更新 ${updated} 条，跳过 ${skipped} 条`);
}

main().catch(console.error);
