const XLSX = require('xlsx');
const https = require('https');

const APP_ID = 'cli_a97e125f0ab89cb5';
const SECRET = 'pppKJAybbiNqKIDB9hlvshTnXGPg7OVH';
const WORD_APP = 'BWhIb2hjaaDQHdsNhWRcPluBncg';
const WORD_TABLE = 'tblyMh69dws6ty6n';

function req(method, path, body, token) {
    return new Promise((resolve) => {
        const data = body ? JSON.stringify(body) : null;
        const headers = { 'Content-Type': 'application/json' };
        if (data) headers['Content-Length'] = Buffer.byteLength(data);
        if (token) headers['Authorization'] = 'Bearer ' + token;
        const r = https.request({ hostname: 'open.feishu.cn', path, method, headers }, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
                catch { resolve({}); }
            });
        });
        r.on('error', () => resolve({}));
        if (data) r.write(data);
        r.end();
    });
}

async function getToken() {
    const res = await req('POST', '/open-apis/auth/v3/tenant_access_token/internal', { app_id: APP_ID, app_secret: SECRET });
    return res.tenant_access_token;
}

async function getRecords() {
    const token = await getToken();
    const res = await req('GET', '/open-apis/bitable/v1/apps/' + WORD_APP + '/tables/' + WORD_TABLE + '/records?page_size=500', null, token);
    return res.data?.items || [];
}

async function updateRecord(recordId, fields) {
    const token = await getToken();
    return req('PUT', '/open-apis/bitable/v1/apps/' + WORD_APP + '/tables/' + WORD_TABLE + '/records/' + recordId, { fields }, token);
}

function parseExcel() {
    const wb = XLSX.readFile('单词机器人-数据 副本_生产-单词表.xlsx');
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    const map = {};
    rows.forEach(r => { map[r['单词'] || ''] = r; });
    return map;
}

async function main() {
    const excelMap = parseExcel();
    const records = await getRecords();
    console.log('更新', records.length, '条记录...');
    
    let updated = 0;
    for (const record of records) {
        const word = record.fields?.Word || '';
        const excelRow = excelMap[word];
        if (!excelRow) continue;
        
        const isMastered = excelRow['状态'] === '已记住';
        const isMulti = excelRow['是否多义词'] === '是';
        
        const fields = {
            'Status': isMastered ? 'Mastered' : 'Pending',
            'multi_definition': isMulti ? '是' : '否'
        };
        
        await updateRecord(record.record_id, fields);
        updated++;
    }
    
    console.log('完成，更新', updated, '条');
}

main();
