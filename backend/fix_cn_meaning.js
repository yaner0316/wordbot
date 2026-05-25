require('dotenv').config();
const { getRecords, updateRecord } = require('./feishu');

const WORD_TABLE = { appToken: process.env.FEISHU_APP_TOKEN, tableId: process.env.FEISHU_WORD_TABLE_ID };

function translateToCN(text) {
    return new Promise((resolve, reject) => {
        if (!text || !text.trim()) {
            resolve('');
            return;
        }
        const https = require('https');
        const encoded = encodeURIComponent(text.substring(0, 500));
        const url = `https://api.mymemory.translated.net/get?q=${encoded}&langpair=en|zht`;
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve(json.responseData?.translatedText || '');
                } catch (e) { resolve(''); }
            });
        }).on('error', () => resolve(''));
    });
}

function getFieldValue(val) {
    if (typeof val === 'string') return val;
    if (Array.isArray(val)) return val[0] || '';
    if (typeof val === 'object' && val !== null) return val.text || val.value || '';
    return String(val || '');
}

async function fixChineseMeaning() {
    console.log('开始修复中文释义...\n');
    const records = await getRecords(WORD_TABLE);
    console.log(`总记录数: ${records.length}`);
    
    let fixed = 0;
    let skipped = 0;
    
    for (const record of records) {
        const cnMeaningRaw = record.fields.CN_Meaning;
        const cnMeaning = getFieldValue(cnMeaningRaw);
        const word = record.fields.Word;
        const recordId = record.record_id;
        
        const cnStr = cnMeaning.trim();
        
        if (cnStr.includes('请提供要翻译的文本')) {
            const meaning = getFieldValue(record.fields.Meaning);
            console.log(`发现错误: ${word} -> "${cnStr}"`);
            console.log(`  英文释义: ${meaning?.substring(0, 50)}...`);
            
            try {
                const newCn = await translateToCN(meaning);
                console.log(`  翻译结果: ${newCn || '(空)'}`);
                
                await updateRecord(WORD_TABLE, recordId, { CN_Meaning: newCn || '' });
                fixed++;
                console.log(`  已更新`);
            } catch (e) {
                console.log(`  失败: ${e.message}`);
            }
            
            await new Promise(r => setTimeout(r, 500));
        } else {
            skipped++;
        }
    }
    
    console.log(`\n完成: 修复 ${fixed}, 跳过 ${skipped}`);
}

fixChineseMeaning().then(() => process.exit(0)).catch(e => {
    console.error('错误:', e);
    process.exit(1);
});