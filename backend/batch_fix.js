require('dotenv').config();
const https = require('https');

const FEISHU_APP_TOKEN = 'BWhIb2hjaaDQHdsNhWRcPluBncg';
const WORD_TABLE_ID = 'tblyMh69dws6ty6n';

function getFieldValue(val) {
    if (val === undefined || val === null) return '';
    if (typeof val === 'string') return val;
    if (Array.isArray(val)) return val[0] || '';
    if (typeof val === 'object') return val.text || val.value || JSON.stringify(val);
    return String(val);
}

async function getRecords(tableId) {
    return new Promise((resolve, reject) => {
        const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${tableId}/records?page_size=500`;
        https.get(url, {
            headers: { 'Authorization': `Bearer ${process.env.FEISHU_TOKEN}` }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve(json.data?.items || []);
                } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

async function updateRecord(tableId, recordId, fields) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ fields });
        const options = {
            hostname: 'open.feishu.cn',
            path: `/open-apis/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${tableId}/records/${recordId}`,
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.FEISHU_TOKEN}`,
                'Content-Length': Buffer.byteLength(data)
            }
        };
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve(JSON.parse(body)));
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function deleteRecord(tableId, recordId) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'open.feishu.cn',
            path: `/open-apis/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${tableId}/records/${recordId}`,
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${process.env.FEISHU_TOKEN}` }
        };
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve(JSON.parse(body)));
        });
        req.on('error', reject);
        req.end();
    });
}

async function batchFix() {
    console.log('开始批量修复...\n');
    
    const records = await getRecords(WORD_TABLE_ID);
    console.log(`总记录数: ${records.length}`);
    
    let fixed = 0;
    let deleted = 0;
    let skipped = 0;
    
    for (const record of records) {
        const word = record.fields.Word;
        const cnMeaning = getFieldValue(record.fields.CN_Meaning);
        const recordId = record.record_id;
        
        if (word && word.toLowerCase() === 'test_word') {
            console.log(`删除测试单词: ${word}`);
            try {
                await deleteRecord(WORD_TABLE_ID, recordId);
                deleted++;
            } catch (e) {
                console.log(`  删除失败: ${e.message}`);
            }
            await new Promise(r => setTimeout(r, 300));
            continue;
        }
        
        if (cnMeaning.includes('请提供要翻译的文本')) {
            console.log(`清空CN_Meaning: ${word}`);
            try {
                await updateRecord(WORD_TABLE_ID, recordId, { CN_Meaning: '' });
                fixed++;
            } catch (e) {
                console.log(`  更新失败: ${e.message}`);
            }
            await new Promise(r => setTimeout(r, 300));
        } else {
            skipped++;
        }
    }
    
    console.log(`\n完成: 修复 ${fixed}, 删除 ${deleted}, 跳过 ${skipped}`);
}

batchFix().then(() => process.exit(0)).catch(e => {
    console.error('错误:', e);
    process.exit(1);
});