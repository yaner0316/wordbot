const { execSync } = require('child_process');
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
    }
    return res;
}

function searchWithMmx(word) {
    try {
        const query = `"${word}" use in a sentence example`;
        const result = execSync(`mmx search "${query}"`, { encoding: 'utf8', timeout: 10000 });
        return result;
    } catch (e) {
        return null;
    }
}

function extractSentence(text, word) {
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
    for (const s of sentences) {
        const clean = s.trim();
        if (clean.toLowerCase().includes(word.toLowerCase()) && clean.length > 30 && clean.length < 200) {
            return clean;
        }
    }
    return null;
}

async function fetchExample(word) {
    const searchResult = searchWithMmx(word);
    if (searchResult) {
        const sentence = extractSentence(searchResult, word);
        if (sentence) return sentence;
    }
    return null;
}

async function main() {
    console.log('补全单词例句（使用 MiniMax 搜索）...\n');
    
    const records = await getRecords();
    console.log(`共 ${records.length} 条记录\n`);
    
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    
    for (const record of records) {
        const word = record.fields.Word;
        if (!word) continue;
        
        const context = record.fields.Context;
        if (context && context.trim()) {
            skipped++;
            continue;
        }
        
        console.log(`获取: ${word}`);
        
        const example = await fetchExample(word);
        
        if (example) {
            await updateRecord(record.record_id, { Context: example });
            console.log(`  例句: ${example.substring(0, 60)}...`);
            updated++;
        } else {
            console.log(`  获取失败，跳过`);
            failed++;
        }
        
        await new Promise(r => setTimeout(r, 1000));
    }
    
    console.log(`\n完成！更新 ${updated} 条，跳过 ${skipped} 条，失败 ${failed} 条`);
}

main().catch(console.error);
