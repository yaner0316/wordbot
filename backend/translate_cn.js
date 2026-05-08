require('dotenv').config();

const https = require('https');
const { execSync } = require('child_process');

const APP_ID = process.env.FEISHU_APP_ID || 'cli_a97e125f0ab89cb5';
const APP_SECRET = process.env.FEISHU_APP_SECRET || 'pppKJAybbiNqKIDB9hlvshTnXGPg7OVH';
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

async function getRecords() {
    const token = await getToken();
    const res = await request('GET', `/open-apis/bitable/v1/apps/${WORD_TABLE.appToken}/tables/${WORD_TABLE.tableId}/records?page_size=500`, null, token);
    return res.data?.items || [];
}

async function updateRecord(recordId, fields) {
    const token = await getToken();
    const res = await request('PUT', `/open-apis/bitable/v1/apps/${WORD_TABLE.appToken}/tables/${WORD_TABLE.tableId}/records/${recordId}`, { fields }, token);
    return res.code === 0;
}

function translateWithMiniMax(text) {
    const prompt = `翻译成中文（只返回翻译结果，不要解释）：${text}`;
    try {
        const escapedPrompt = prompt.replace(/"/g, '\\"');
        const result = execSync(`mmx text chat --message "${escapedPrompt}" --output json`, { encoding: 'utf8', timeout: 15000 });
        const textMatch = result.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (textMatch) {
            return textMatch[1].replace(/\\"/g, '"').replace(/\\n/g, ' ').trim();
        }
    } catch (e) { }
    return null;
}

async function main() {
    console.log('读取单词表...\n');
    const records = await getRecords();
    console.log(`共 ${records.length} 条记录\n`);
    
    let updated = 0;
    let skipped = 0;
    
    for (const record of records) {
        const word = record.fields.Word;
        const meaning = record.fields.Meaning || '';
        const cnMeaning = record.fields.CN_Meaning || '';
        
        if (!word) {
            skipped++;
            continue;
        }
        
        if (cnMeaning && cnMeaning.trim()) {
            console.log(`跳过 ${word}（已有中文释义）`);
            skipped++;
            continue;
        }
        
        console.log(`翻译 ${word}: ${meaning.substring(0, 30)}...`);
        console.log(`  现有CN字段: "${cnMeaning}"`);
        
        const cn = translateWithMiniMax(meaning);
        
        if (cn) {
            await updateRecord(record.record_id, { CN_Meaning: cn });
            console.log(`  → ${cn}`);
            updated++;
        } else {
            console.log(`  失败`);
        }
        
        await new Promise(r => setTimeout(r, 500));
    }
    
    console.log(`\n完成！更新 ${updated}，跳过 ${skipped}`);
}

main().catch(console.error);