const XLSX = require('xlsx');
const https = require('https');

const WORD_TABLE = { appToken: 'BWhIb2hjaaDQHdsNhWRcPluBncg', tableId: 'tblyMh69dws6ty6n' };

const STATUS_MAP = {
    'Pending': 'optXjbXS2F',
    'Mastered': 'optF5P0W3O'
};

const MULTI_MAP = {
    '是': ['opthB7bmkB'],
    '否': ['optpWwFJpq']
};

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
    const res = await request('PUT', `/open-apis/bitable/v1/apps/${WORD_TABLE.appToken}/tables/${WORD_TABLE.tableId}/records/${recordId}`, { fields }, token);
    if (res.code !== 0 && res.code !== undefined) {
        console.log(`更新失败 ${recordId}:`, res.msg, res.code);
        return false;
    }
    return true;
}

async function main() {
    console.log('=== 使用正确的选项ID更新字段 ===\n');
    
    console.log('1. 读取Excel文件...');
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
    
    console.log(`   Excel中有 ${excelData.length} 条记录`);
    console.log(`   已建立 ${Object.keys(excelMap).length} 个单词映射\n`);
    
    console.log('2. 获取飞书表格数据...');
    const records = await getRecords();
    const yusiRecords = records.filter(r => r.fields.user === 'yusi');
    console.log(`   飞书表格yusi用户有 ${yusiRecords.length} 条记录\n`);
    
    console.log('3. 检查映射关系:');
    console.log('   Status:');
    console.log('     已记住 -> optF5P0W3O');
    console.log('     未记住 -> optXjbXS2F');
    console.log('   multi_definition:');
    console.log('     是 -> [opthB7bmkB]');
    console.log('     否 -> [optpWwFJpq]\n');
    
    console.log('4. 开始更新字段...');
    let updated = 0;
    let matched = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const record of yusiRecords) {
        const word = record.fields.Word;
        if (!word) {
            skipped++;
            continue;
        }
        
        const wordLower = word.toLowerCase();
        const excelInfo = excelMap[wordLower];
        
        if (!excelInfo) {
            skipped++;
            continue;
        }
        
        matched++;
        const updateFields = {};
        let needUpdate = false;
        
        if (excelInfo.status === '已记住') {
            const targetId = STATUS_MAP['Mastered'];
            if (record.fields.Status !== targetId) {
                updateFields.Status = targetId;
                needUpdate = true;
            }
        } else if (excelInfo.status === '未记住') {
            const targetId = STATUS_MAP['Pending'];
            if (record.fields.Status !== targetId) {
                updateFields.Status = targetId;
                needUpdate = true;
            }
        }
        
        if (excelInfo.multiDef === '是') {
            const targetArr = MULTI_MAP['是'];
            if (JSON.stringify(record.fields.multi_definition) !== JSON.stringify(targetArr)) {
                updateFields.multi_definition = targetArr;
                needUpdate = true;
            }
        } else if (excelInfo.multiDef === '否') {
            const targetArr = MULTI_MAP['否'];
            if (JSON.stringify(record.fields.multi_definition) !== JSON.stringify(targetArr)) {
                updateFields.multi_definition = targetArr;
                needUpdate = true;
            }
        }
        
        if (needUpdate) {
            const success = await updateRecord(record.record_id, updateFields);
            if (success) {
                updated++;
                if (updated <= 10) {
                    console.log(`   ✓ 更新 ${word}:`, JSON.stringify(updateFields));
                }
            } else {
                errors++;
            }
            await new Promise(r => setTimeout(r, 50));
        }
    }
    
    console.log(`\n更新完成!`);
    console.log(`   匹配到Excel: ${matched} 条`);
    console.log(`   跳过: ${skipped} 条`);
    console.log(`   成功更新: ${updated} 条`);
    console.log(`   更新失败: ${errors} 条`);
    
    console.log('\n5. 等待数据同步...\n');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('6. 验证更新结果...');
    const newRecords = await getRecords();
    const newYusi = newRecords.filter(r => r.fields.user === 'yusi');
    
    const statusCounts = {};
    const multiCounts = {};
    newYusi.forEach(r => {
        const status = r.fields.Status;
        const multi = r.fields.multi_definition;
        statusCounts[status] = (statusCounts[status] || 0) + 1;
        const multiKey = JSON.stringify(multi);
        multiCounts[multiKey] = (multiCounts[multiKey] || 0) + 1;
    });
    
    console.log('   Status分布:');
    Object.entries(statusCounts).forEach(([k, v]) => {
        const name = k === 'optF5P0W3O' ? '(Mastered)' : k === 'optXjbXS2F' ? '(Pending)' : '(未知)';
        console.log(`     ${k} ${name}: ${v}`);
    });
    
    console.log('   multi_definition分布:');
    Object.entries(multiCounts).forEach(([k, v]) => {
        const name = k.includes('opthB7bmkB') ? '(是)' : k.includes('optpWwFJpq') ? '(否)' : '(未知)';
        console.log(`     ${k} ${name}: ${v}`);
    });
}

main().catch(console.error);
