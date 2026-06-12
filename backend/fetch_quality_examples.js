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
            res.on('end', () => {
                try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
                catch { resolve(null); }
            });
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

async function updateRecord(recordId, fields) {
    const token = await getToken();
    const res = await request('PUT', `/open-apis/bitable/v1/apps/${WORD_TABLE.appToken}/tables/${WORD_TABLE.tableId}/records/${recordId}`, { fields }, token);
    return res.code === 0;
}

async function getRecordByWord(word) {
    const token = await getToken();
    const res = await request('GET', `/open-apis/bitable/v1/apps/${WORD_TABLE.appToken}/tables/${WORD_TABLE.tableId}/records?page_size=500`, null, token);
    const records = res.data?.items || [];
    return records.find(r => r.fields.Word?.toLowerCase() === word.toLowerCase());
}

function requesthttp(url) {
    return new Promise((resolve, reject) => {
        const req = https.request(url, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks).toString()));
        });
        req.on('error', reject);
        req.end();
    });
}

async function fetchFromFreeDictionary(word) {
    try {
        const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${word.toLowerCase()}`;
        const data = await requesthttp(url);
        if (!data) return [];
        
        const json = JSON.parse(data);
        const examples = [];
        
        if (json[0]) {
            for (const meaning of json[0].meanings || []) {
                for (const def of meaning.definitions || []) {
                    if (def.example) {
                        examples.push(def.example.replace(/"/g, ''));
                    }
                }
            }
        }
        
        return examples.slice(0, 5);
    } catch (e) {
        return [];
    }
}

function searchWithMmx(query) {
    try {
        const result = execSync(`mmx search "${query}"`, { encoding: 'utf8', timeout: 15000 });
        return result;
    } catch (e) {
        return null;
    }
}

function extractSentences(text, word) {
    const sentences = [];
    const parts = text.split(/[.!?]+/);
    
    for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.length > 30 && 
            trimmed.length < 200 && 
            trimmed.toLowerCase().includes(word.toLowerCase()) &&
            /[a-z][.!?][\s]/.test(trimmed)) {
            sentences.push(trimmed.trim());
        }
    }
    
    return [...new Set(sentences)].slice(0, 5);
}

async function evaluateWithMiniMax(word, meaning, sentence) {
    const prompt = `评估例句：${sentence}

单词：${word}
释义：${meaning}

返回JSON：{"score":1-20,"pass":true/false,"reason":"原因"}`;

    try {
        const escapedPrompt = prompt.replace(/"/g, '\\"');
        const result = execSync(`mmx text chat --message "${escapedPrompt}" --output json`, { encoding: 'utf8', timeout: 20000 });
        
        const lines = result.split('\n');
        for (const line of lines) {
            if (line.includes('score') || line.includes('pass')) {
                const jsonMatch = line.match(/\{[\s\S]*?\}/);
                if (jsonMatch) {
                    return JSON.parse(jsonMatch[0]);
                }
            }
        }
        
        const jsonMatch = result.match(/\{[\s\S]*?\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
    } catch (e) {
        console.log(`    评估超时，不使用此例句`);
    }
    
    return { score: 0, pass: false, reason: '评估超时' };
}

async function processWord(word) {
    console.log(`\n处理单词: ${word}`);
    
    const record = await getRecordByWord(word);
    if (!record) {
        console.log(`  未找到记录`);
        return false;
    }
    
    const meaning = record.fields.Meaning || '';
    console.log(`  释义: ${meaning.substring(0, 50)}...`);
    
    const candidates = [];
    
    console.log(`  1. 从 DictionaryAPI 获取例句...`);
    const apiExamples = await fetchFromFreeDictionary(word);
    candidates.push(...apiExamples);
    console.log(`     找到 ${apiExamples.length} 个例句`);
    
    console.log(`  2. 从搜索引擎获取例句...`);
    const searches = [
        `define ${word} example sentence English`,
        `use ${word} correctly in a sentence`
    ];
    
    for (const query of searches) {
        console.log(`     搜索: ${query}`);
        const result = searchWithMmx(query);
        if (result) {
            const sentences = extractSentences(result, word);
            candidates.push(...sentences);
        }
        await new Promise(r => setTimeout(r, 500));
    }
    
    const uniqueCandidates = [...new Set(candidates)].slice(0, 8);
    console.log(`  共 ${uniqueCandidates.length} 个候选例句`);
    
    if (uniqueCandidates.length === 0) {
        console.log(`  无候选例句`);
        return false;
    }
    
    let bestSentence = null;
    let bestScore = 0;
    
    for (const candidate of uniqueCandidates) {
        console.log(`\n  评估例句: ${candidate}`);
        const evaluation = await evaluateWithMiniMax(word, meaning, candidate);
        
        console.log(`    评分: ${evaluation.score}, 通过: ${evaluation.pass}, ${evaluation.reason || ''}`);
        if (evaluation.pass && evaluation.score > bestScore) {
            bestScore = evaluation.score;
            bestSentence = candidate;
        }
        
        await new Promise(r => setTimeout(r, 500));
    }
    
    if (bestSentence) {
        console.log(`  最佳例句: "${bestSentence}"`);
        const success = await updateRecord(record.record_id, { Context: bestSentence });
        if (success) {
            console.log(`  更新成功!`);
            return true;
        }
    } else {
        console.log(`  没有找到合格的例句`);
    }
    
    return false;
}

async function main() {
    const words = process.argv.slice(2);
    
    if (words.length === 0) {
        console.log('用法: node fetch_quality_examples.js word1 word2 ...');
        return;
    }
    
    console.log(`开始处理 ${words.length} 个单词...\n`);
    
    let success = 0;
    for (const word of words) {
        const result = await processWord(word);
        if (result) success++;
    }
    
    console.log(`\n完成！成功 ${success}/${words.length}`);
}

main().catch(console.error);
