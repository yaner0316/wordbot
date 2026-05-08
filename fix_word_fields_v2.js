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
    const res = await request('PUT', `/open-apis/bitable/v1/apps/${WORD_TABLE.appToken}/tables/${WORD_TABLE.tableId}/records/${recordId}`, { fields }, token);
    if (res.code !== 0) {
        console.log(`更新失败 ${recordId}:`, res.msg);
    }
    return res;
}

async function main() {
    console.log('=== 修复单词表字段 ===\n');
    
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
    
    console.log('3. 检查当前字段值:');
    const statusCounts = {};
    const multiCounts = {};
    yusiRecords.forEach(r => {
        const status = r.fields.Status;
        const multi = r.fields.multi_definition;
        statusCounts[status] = (statusCounts[status] || 0) + 1;
        multiCounts[multi] = (multiCounts[multi] || 0) + 1;
    });
    console.log('   Status值分布:', statusCounts);
    console.log('   multi_definition值分布:', multiCounts);
    
    console.log('\n4. 开始更新字段...');
    let updated = 0;
    let matched = 0;
    let notMatched = 0;
    
    for (const record of yusiRecords) {
        const word = record.fields.Word;
        if (!word) continue;
        
        const wordLower = word.toLowerCase();
        const excelInfo = excelMap[wordLower];
        
        if (!excelInfo) {
            notMatched++;
            continue;
        }
        
        matched++;
        const updateFields = {};
        let needUpdate = false;
        
        if (excelInfo.status === '已记住') {
            if (record.fields.Status !== 'Mastered') {
                updateFields.Status = 'Mastered';
                needUpdate = true;
            }
        } else if (excelInfo.status === '未记住') {
            if (record.fields.Status !== 'Pending') {
                updateFields.Status = 'Pending';
                needUpdate = true;
            }
        }
        
        if (excelInfo.multiDef === '是') {
            if (record.fields.multi_definition !== true) {
                updateFields.multi_definition = true;
                needUpdate = true;
            }
        } else if (excelInfo.multiDef === '否') {
            if (record.fields.multi_definition !== false) {
                updateFields.multi_definition = false;
                needUpdate = true;
            }
        }
        
        if (needUpdate) {
            await updateRecord(record.record_id, updateFields);
            updated++;
            if (updated <= 5) {
                console.log(`   更新 ${word}:`, JSON.stringify(updateFields));
            }
        }
    }
    
    console.log(`\n更新完成!`);
    console.log(`   匹配到Excel: ${matched} 条`);
    console.log(`   Excel中未找到: ${notMatched} 条`);
    console.log(`   实际更新: ${updated} 条`);
    
    console.log('\n5. 验证更新结果...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    const newRecords = await getRecords();
    const newYusi = newRecords.filter(r => r.fields.user === 'yusi');
    
    const newStatusCounts = {};
    const newMultiCounts = {};
    newYusi.forEach(r => {
        const status = r.fields.Status;
        const multi = r.fields.multi_definition;
        newStatusCounts[status] = (newStatusCounts[status] || 0) + 1;
        newMultiCounts[multi] = (newMultiCounts[multi] || 0) + 1;
    });
    
    console.log('   更新后Status分布:', newStatusCounts);
    console.log('   更新后multi_definition分布:', newMultiCounts);
}

main().catch(console.error);
