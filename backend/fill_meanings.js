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

function requesthttp(url) {
    return new Promise((resolve, reject) => {
        const req = https.request(url, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
                catch { resolve(null); }
            });
        });
        req.on('error', reject);
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

async function fetchMeaning(word) {
    try {
        const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${word.toLowerCase()}`;
        const data = await requesthttp(url);
        
        if (data && data[0]) {
            const meanings = [];
            for (const meaning of data[0].meanings || []) {
                for (const def of meaning.definitions || []) {
                    meanings.push(def.definition);
                }
            }
            return meanings.slice(0, 3).join('; ');
        }
    } catch (e) { }
    return null;
}

async function main() {
    console.log('补全单词释义...\n');
    
    const records = await getRecords();
    console.log(`共 ${records.length} 条记录\n`);
    
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    
    for (const record of records) {
        const word = record.fields.Word;
        if (!word) continue;
        
        const meaning = record.fields.Meaning;
        if (meaning && meaning.trim()) {
            skipped++;
            continue;
        }
        
        console.log(`获取: ${word}`);
        
        const def = await fetchMeaning(word);
        
        if (def) {
            await updateRecord(record.record_id, { Meaning: def });
            console.log(`  释义: ${def.substring(0, 50)}...`);
            updated++;
        } else {
            console.log(`  获取失败`);
            failed++;
        }
        
        await new Promise(r => setTimeout(r, 300));
    }
    
    console.log(`\n完成！更新 ${updated} 条，跳过 ${skipped} 条，失败 ${failed} 条`);
}

main().catch(console.error);
