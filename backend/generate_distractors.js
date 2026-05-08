const https = require('https');
const { execSync } = require('child_process');

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

async function getAllRecords() {
    const token = await getToken();
    const allRecords = [];
    let pageToken = null;
    
    do {
        let url = `/open-apis/bitable/v1/apps/${WORD_TABLE.appToken}/tables/${WORD_TABLE.tableId}/records?page_size=500`;
        if (pageToken) url += `&page_token=${pageToken}`;
        
        const res = await request('GET', url, null, token);
        const items = res.data?.items || [];
        allRecords.push(...items);
        pageToken = res.data?.page_token;
    } while (pageToken);
    
    return allRecords;
}

async function updateRecord(recordId, fields) {
    const token = await getToken();
    const res = await request('PUT', `/open-apis/bitable/v1/apps/${WORD_TABLE.appToken}/tables/${WORD_TABLE.tableId}/records/${recordId}`, { fields }, token);
    return res.code === 0;
}

function generateDistractors(word, meaning) {
    const prompt = `为单词 ${word} 生成3个含义相近的英文干扰词（必须是英文单词，不是中文），返回JSON：{"distractors": ["word1", "word2", "word3"]}`;

    try {
        const escapedPrompt = prompt.replace(/"/g, '\\"');
        const result = execSync(`mmx text chat --message "${escapedPrompt}" --output json`, { encoding: 'utf8', timeout: 30000 });
        
        const textMatch = result.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (textMatch) {
            const innerJson = textMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
            const distMatch = innerJson.match(/"distractors"\s*:\s*\[(.*?)\]/s);
            if (distMatch) {
                const words = distMatch[1].match(/"([^"]+)"/g);
                if (words && words.length >= 3) {
                    return words.map(w => w.replace(/"/g, ''));
                }
            }
        }
    } catch (e) {
        console.log(`  失败: ${e.message}`);
    }
    
    return null;
}

async function main() {
    console.log('读取飞书单词表...\n');
    const records = await getAllRecords();
    console.log(`共 ${records.length} 条记录\n`);
    
    let success = 0;
    let skipped = 0;
    let failed = 0;
    
    for (const record of records) {
        const word = record.fields.Word;
        const meaning = record.fields.Meaning || '';
        const existingDist = record.fields.Distractors || '';
        
        if (!word) {
            skipped++;
            continue;
        }
        
        console.log(`\n处理: ${word}`);
        console.log(`  释义: ${meaning.substring(0, 50)}...`);
        
        const distractors = generateDistractors(word, meaning);
        
        if (distractors && distractors.length >= 3) {
            const distStr = distractors.slice(0, 3).join(', ');
            console.log(`  生成干扰词: ${distStr}`);
            
            const ok = await updateRecord(record.record_id, { Distractors: distStr });
            if (ok) {
                success++;
                console.log(`  ✓ 更新成功`);
            } else {
                failed++;
                console.log(`  ✗ 更新失败`);
            }
        } else {
            failed++;
            console.log(`  ✗ 生成失败`);
        }
        
        await new Promise(r => setTimeout(r, 1500));
    }
    
    console.log(`\n========== 完成 ==========`);
    console.log(`成功: ${success}`);
    console.log(`跳过: ${skipped}`);
    console.log(`失败: ${failed}`);
}

main().catch(console.error);