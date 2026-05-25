require('dotenv').config();
const { updateWord, searchRecords } = require('./feishu');
const https = require('https');

const WORD_TABLE = { appToken: process.env.FEISHU_APP_TOKEN, tableId: process.env.FEISHU_WORD_TABLE_ID };

function translateToCN(text) {
    return new Promise((resolve, reject) => {
        if (!text || !text.trim()) {
            resolve('');
            return;
        }
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

function getStringValue(val) {
    if (typeof val === 'string') return val;
    if (Array.isArray(val)) return val[0] || '';
    if (typeof val === 'object' && val !== null) return val.text || val.value || '';
    return String(val || '');
}

async function fixChineseMeaning() {
    console.log('开始修复中文释义...\n');
    const records = await searchRecords(WORD_TABLE);
    console.log(`总记录数: ${records.length}`);
    
    let fixed = 0;
    let skipped = 0;
    let errorCn = 0;
    
    for (const record of records) {
        const cnMeaningRaw = record.fields.CN_Meaning;
        const cnMeaning = getStringValue(cnMeaningRaw);
        const word = record.fields.Word;
        const recordId = record.record_id;
        
        const cnStr = cnMeaning.trim();
        console.log(`检查: ${word} -> CN_Meaning: "${cnStr}" (${typeof cnMeaningRaw})`);
        
        if (cnStr.includes('请提供要翻译的文本')) {
            const meaning = record.fields.Meaning;
            console.log(`  发现错误: ${word} - ${meaning?.substring(0, 30)}...`);
            
            try {
                const newCn = await translateToCN(meaning);
                if (newCn && newCn.trim() && !newCn.includes('请提供')) {
                    await updateWord(recordId, { CN_Meaning: newCn });
                    console.log(`  -> ${newCn}`);
                } else {
                    await updateWord(recordId, { CN_Meaning: '' });
                    console.log(`  -> 留空`);
                }
                fixed++;
            } catch (e) {
                console.log(`  失败: ${e.message}`);
            }
            
            await new Promise(r => setTimeout(r, 500));
        } else {
            if (cnStr) {
                skipped++;
            } else {
                errorCn++;
            }
        }
    }
    
    console.log(`\n完成: 修复 ${fixed}, 有效跳过 ${skipped}, 无中文 ${errorCn}`);
}

fixChineseMeaning().then(() => process.exit(0)).catch(e => {
    console.error('错误:', e);
    process.exit(1);
});