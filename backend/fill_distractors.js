const https = require('https');
const crypto = require('crypto');

const APP_ID = 'cli_a97e125f0ab89cb5';
const APP_SECRET = 'pppKJAybbiNqKIDB9hlvshTnXGPg7OVH';

const WORD_TABLE = { appToken: 'BWhIb2hjaaDQHdsNhWRcPluBncg', tableId: 'tblyMh69dws6ty6n' };
const DIST_TABLE = { appToken: 'GskxbMxMgaDPFRsgqS4cdWvdndb', tableId: 'tbl3EgurgOTXdM3V' };

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

async function getRecords(table) {
    const token = await getToken();
    const res = await request('GET', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records?page_size=500`, null, token);
    return res.data?.items || [];
}

async function updateRecord(table, recordId, fields) {
    const token = await getToken();
    const res = await request('PUT', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records/${recordId}`, { fields }, token);
    if (res.code !== 0) {
        console.log('更新失败:', res.msg);
    }
    return res;
}

async function fetchRelatedWords(word) {
    try {
        const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${word.toLowerCase()}`;
        const data = await requesthttp(url);
        
        if (data && data[0]) {
            const synonyms = [];
            for (const meaning of data[0].meanings || []) {
                for (const def of meaning.definitions || []) {
                    if (def.synonyms) {
                        synonyms.push(...def.synonyms);
                    }
                }
            }
            return [...new Set(synonyms)].slice(0, 5);
        }
    } catch (e) { }
    return [];
}

async function main() {
    console.log('开始补全干扰词...\n');
    
    const wordRecords = await getRecords(WORD_TABLE);
    const existingDistractors = new Set();
    
    const distRecords = await getRecords(DIST_TABLE);
    for (const r of distRecords) {
        if (r.fields.Word) existingDistractors.add(r.fields.Word.toLowerCase());
    }
    
    console.log(`单词表: ${wordRecords.length} 条记录`);
    console.log(`已有干扰词: ${existingDistractors.size} 个\n`);
    
    let updated = 0;
    let skipped = 0;
    
    for (const record of wordRecords) {
        const word = record.fields.Word;
        if (!word) continue;
        
        const distRecord = distRecords.find(r => r.fields.Word?.toLowerCase() === word.toLowerCase());
        
        if (distRecord && distRecord.fields.Distractors) {
            const existing = distRecord.fields.Distractors.split(',').map(d => d.trim()).filter(d => d);
            if (existing.length >= 3) {
                skipped++;
                continue;
            }
        }
        
        console.log(`处理: ${word}`);
        
        const related = await fetchRelatedWords(word);
        
        let distractors;
        if (related.length >= 3) {
            distractors = related.slice(0, 3);
        } else {
            const candidates = [...existingDistractors].filter(w => w.toLowerCase() !== word.toLowerCase());
            const shuffled = candidates.sort(() => Math.random() - 0.5);
            distractors = shuffled.slice(0, 3);
        }
        
        if (distractors.length < 3) {
            distractors = ['sample', 'example', 'instance', 'case', 'figure'].filter(d => d !== word.toLowerCase()).slice(0, 3);
        }
        
        if (distRecord) {
            const existing = distRecord.fields.Distractors ? distRecord.fields.Distractors.split(',').map(d => d.trim()).filter(d => d) : [];
            const combined = [...new Set([...existing, ...distractors])].slice(0, 5);
            await updateRecord(DIST_TABLE, distRecord.record_id, { Distractors: combined.join(',') });
            console.log(`  更新干扰词: ${combined.join(', ')}`);
        } else {
            await request('POST', `/open-apis/bitable/v1/apps/${DIST_TABLE.appToken}/tables/${DIST_TABLE.tableId}/records`, {
                fields: {
                    Word: word,
                    Distractors: distractors.join(','),
                    Meaning: record.fields.Meaning || '',
                    POS: record.fields.POS || ''
                }
            }, await getToken());
            console.log(`  新增干扰词: ${distractors.join(', ')}`);
        }
        
        updated++;
        await new Promise(r => setTimeout(r, 200));
    }
    
    console.log(`\n完成！更新 ${updated} 条，跳过 ${skipped} 条`);
}

main().catch(console.error);
