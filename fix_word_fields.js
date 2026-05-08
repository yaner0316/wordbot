const XLSX = require('xlsx');
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

async function updateRecord(recordId, fields) {
    const token = await getToken();
    return request('PUT', `/open-apis/bitable/v1/apps/${WORD_TABLE.appToken}/tables/${WORD_TABLE.tableId}/records/${recordId}`, { fields }, token);
}

async function main() {
    console.log('读取Excel文件...');
    const workbook = XLSX.readFile('单词机器人-数据 副本_生产-单词表.xlsx');
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const excelData = XLSX.utils.sheet_to_json(worksheet);
    
    const excelMap = {};
    excelData.forEach(row => {
        const word = row['单词'];
        if (word) {
            excelMap[word.toLowerCase()] = {
                status: row['状态'],
                multiDef: row['是否多义词']
            };
        }
    });
    
    console.log(`Excel中有 ${excelData.length} 条记录`);
    console.log(`已建立 ${Object.keys(excelMap).length} 个单词映射`);
    
    console.log('\n获取飞书表格数据...');
    const records = await getRecords();
    console.log(`飞书表格有 ${records.length} 条记录`);
    
    console.log('\n检查前5条记录的字段:');
    for (let i = 0; i < Math.min(5, records.length); i++) {
        const r = records[i];
        const fields = r.fields;
        console.log(`\n单词: ${fields.Word}`);
        console.log('字段:', Object.keys(fields).join(', '));
        if (fields.Status !== undefined) console.log('Status:', JSON.stringify(fields.Status));
        if (fields.multi_definition !== undefined) console.log('multi_definition:', JSON.stringify(fields.multi_definition));
    }
    
    console.log('\n\n开始更新字段...');
    let updated = 0;
    let skipped = 0;
    
    for (const record of records) {
        const word = record.fields.Word;
        if (!word) {
            skipped++;
            continue;
        }
        
        const wordLower = word.toLowerCase();
        const excelInfo = excelMap[wordLower];
        
        if (!excelInfo) {
            console.log(`跳过: ${word} (Excel中未找到)`);
            skipped++;
            continue;
        }
        
        const updateFields = {};
        let needUpdate = false;
        
        if (excelInfo.status === '已记住') {
            updateFields.Status = 'Mastered';
            needUpdate = true;
        } else if (excelInfo.status === '未记住') {
            updateFields.Status = 'Pending';
            needUpdate = true;
        }
        
        if (excelInfo.multiDef === '是') {
            updateFields.multi_definition = true;
            needUpdate = true;
        } else if (excelInfo.multiDef === '否') {
            updateFields.multi_definition = false;
            needUpdate = true;
        }
        
        if (needUpdate) {
            await updateRecord(record.record_id, updateFields);
            updated++;
            if (updated <= 10) {
                console.log(`更新: ${word} -> Status: ${updateFields.Status || '(不变)'}, multi_definition: ${updateFields.multi_definition !== undefined ? updateFields.multi_definition : '(不变)'}`);
            }
        } else {
            skipped++;
        }
    }
    
    console.log(`\n更新完成!`);
    console.log(`已更新: ${updated} 条`);
    console.log(`跳过: ${skipped} 条`);
}

main().catch(console.error);
