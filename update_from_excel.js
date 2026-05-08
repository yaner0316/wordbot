const https = require('https');
const XLSX = require('xlsx');

const APP_ID = 'cli_a97e125f0ab89cb5';
const APP_SECRET = 'pppKJAybbiNqKIDB9hlvshTnXGPg7OVH';
const WORD_TABLE = { appToken: 'BWhIb2hjaaDQHdsNhWRcPluBncg', tableId: 'tblyMh69dws6ty6n' };
const EXCEL_PATH = 'D:/Personal/XY/word_bot/word_bot/英语词汇考核表_数据表0506.xlsx';

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

async function getRecords() {
    const token = await getToken();
    const res = await request('GET', `/open-apis/bitable/v1/apps/${WORD_TABLE.appToken}/tables/${WORD_TABLE.tableId}/records?page_size=500`, null, token);
    return res.data?.items || [];
}

async function updateRecord(recordId, fields) {
    const token = await getToken();
    const res = await request('PUT', `/open-apis/bitable/v1/apps/${WORD_TABLE.appToken}/tables/${WORD_TABLE.tableId}/records/${recordId}`, { fields }, token);
    if (res.code !== 0) {
        console.log(`  更新失败: ${res.msg}`);
        return false;
    }
    return true;
}

function readExcel() {
    try {
        const workbook = XLSX.readFile(EXCEL_PATH);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        
        const examples = [];
        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            const example = row[16];
            if (example && typeof example === 'string') {
                examples.push(example.trim());
            } else {
                examples.push(null);
            }
        }
        return examples;
    } catch (e) {
        console.error('读取Excel失败:', e.message);
        return null;
    }
}

async function main() {
    console.log('从Excel更新例句...\n');
    
    const examples = readExcel();
    if (!examples) {
        console.log('无法读取Excel文件');
        return;
    }
    
    console.log(`Excel中例句数量: ${examples.length}`);
    
    const records = await getRecords();
    console.log(`飞书记录数量: ${records.length}\n`);
    
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    
    for (let i = 0; i < Math.min(records.length, examples.length); i++) {
        const record = records[i];
        const word = record.fields.Word;
        const example = examples[i];
        
        if (example && example.trim()) {
            console.log(`更新 ${word}: ${example.substring(0, 50)}...`);
            await updateRecord(record.record_id, { Context: example });
            updated++;
        } else {
            console.log(`清空 ${word} 的例句`);
            await updateRecord(record.record_id, { Context: '' });
            updated++;
        }
        
        await new Promise(r => setTimeout(r, 100));
    }
    
    console.log(`\n完成！共处理 ${updated} 条`);
}

main().catch(console.error);
