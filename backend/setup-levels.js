/**
 * 单词难度等级设置脚本
 * 1. 在 WORD_TABLE 中添加 Level 字段（select 类型，4 个选项）
 * 2. 用 MiniMax AI 批量分类所有单词
 * 3. 将分类结果写入飞书表
 */
const config = require('./config');
const https = require('https');

const { APP_ID, APP_SECRET, WORD_TABLE, MINIMAX_API_KEY } = config;
const LEVELS = ['小学', '中学', '高中', 'CET4_6_TOEFL'];

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
        app_id: APP_ID, app_secret: APP_SECRET
    });
    if (!res.tenant_access_token) throw new Error('获取 Token 失败: ' + JSON.stringify(res));
    return res.tenant_access_token;
}

async function listFields(token) {
    const path = `/open-apis/bitable/v1/apps/${WORD_TABLE.appToken}/tables/${WORD_TABLE.tableId}/fields`;
    const res = await request('GET', path, null, token);
    if (res.code !== 0) throw new Error('获取字段列表失败: ' + JSON.stringify(res));
    return res.data.items;
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

async function classifyWithAI(words) {
    if (!MINIMAX_API_KEY) throw new Error('缺少 MINIMAX_API_KEY');
    
    // 按批次并行处理，每批 30 个词
    const BATCH_SIZE = 30;
    const results = {};
    
    for (let i = 0; i < words.length; i += BATCH_SIZE) {
        const batch = words.slice(i, i + BATCH_SIZE);
        const wordList = batch.map(w => `${w.word} (${w.pos || 'unknown'})`).join('\n');
        
        const prompt = `将以下英语单词按难度分级。难度等级分为 4 级：
1. 小学 - 基础简单词汇
2. 中学 - 初中/高中常见词汇
3. 高中 - 高中高阶/大学入门词汇
4. CET4_6_TOEFL - 大学四级/六级/托福词汇

请为每个单词选择最合适的等级。
返回纯 JSON 数组格式：[{"word": "xx", "level": "CET4_6_TOEFL"}, ...]

单词列表：
${wordList}`;

        const body = JSON.stringify({
            model: 'MiniMax-M2.7',
            messages: [
                { role: 'system', content: '你是一位英语教育专家，擅长评估词汇难度等级。只返回 JSON 数组，不要额外文字。' },
                { role: 'user', content: prompt }
            ],
            max_tokens: 3000,
            temperature: 0.3
        });

        const host = process.env.MINIMAX_API_HOST || 'api.minimax.chat';
        const url = `https://${host}/v1/text/chatcompletion_v2`;
        
        const res = await requesthttp(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${MINIMAX_API_KEY}`
            }
        }, body);

        if (!res) {
            // Fallback: use simple heuristic
            for (const w of batch) {
                results[w.record_id] = guessLevel(w.word, w.meaning || '');
            }
            continue;
        }

        const text = res.choices?.[0]?.message?.content || '';
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[0]);
                for (const item of parsed) {
                    const word = item.word?.toLowerCase();
                    const found = batch.find(w => w.word.toLowerCase() === word);
                    if (found) {
                        results[found.record_id] = item.level;
                    }
                }
            } catch (e) {
                console.error(`批次 ${i} 解析 AI 结果失败:`, e.message);
            }
        }
        
        // 对 AI 未能识别的词使用启发式降级
        for (const w of batch) {
            if (!results[w.record_id]) {
                results[w.record_id] = guessLevel(w.word, w.meaning || '');
            }
        }
        
        console.log(`批次 ${Math.floor(i/BATCH_SIZE)+1} 完成: ${batch.length} 词`);
        // 避免 API 限流
        await new Promise(r => setTimeout(r, 500));
    }
    
    return results;
}

function guessLevel(word, meaning) {
    // 启发式判定
    const simpleWords = new Set([
        'cat','dog','book','pen','apple','school','teacher','student','water','food',
        'big','small','red','blue','good','bad','hot','cold','happy','sad',
        'run','walk','eat','sleep','read','write','play','talk','sing','dance',
        'man','woman','boy','girl','father','mother','brother','sister'
    ]);
    const commonWords = new Set([
        'bank','chief','debt','attach','authority','athlete','automatic','commercial',
        'conference','handsome','journalist','opponent','abandon','absorb','academic',
        'access','accident','account','achieve','acquire','adapt','adjust','admit',
        'adopt','advance','advantage','advertise','advise','affect','afford','agency',
        'agenda','agree','agriculture','aim','allow','although','amount','analyse',
        'announce','anxiety','apparent','appeal','apply','appoint','appreciate',
        'approach','appropriate','approve','argue','arise','arrange','arrest','article',
        'assess','assign','assist','assume','assure','atmosphere','attach','attempt',
        'attend','attitude','attract','authority','automatic','available','average',
        'avoid','award','aware','balance','barely','bargain','barrier','behalf',
        'behave','belief','belong','beneath','benefit','besides','betray','bitter',
        'blame','bother','boundary','brilliant','budget','burden','calculate',
        'campaign','capable','capacity','capture','career','cautious','cease',
        'celebrate','challenge','champion','character','charity','circumstance',
        'civil','claim','clarify','classify','climate','collapse','command',
        'comment','commit','communicate','community','companion','compare',
        'compete','complain','complete','complex','comply','component','compose',
        'comprehend','comprise','concentrate','concept','concern','conclude',
        'concrete','conduct','conference','confess','confident','confirm','conflict',
        'confuse','consequence','conservative','consider','consist','constant',
        'constitute','construct','consult','consume','contact','contain','contemporary',
        'contend','context','contract','contrary','contribute','controversy',
        'convenient','convention','convince','cooperate','cope','correspond',
        'counsel','count','create','credit','crime','crisis','criteria','critical',
        'cultivate','current','custom','damage','debate','decade','declare','decline',
        'defeat','defend','define','definite','deliberate','deliver','demand','deny',
        'depart','depend','depict','deposit','depress','derive','describe','deserve',
        'designate','desperate','despite','destruction','determine','device','devote',
        'diminish','diplomat','discipline','disclose','discount','discourage','display',
        'dispose','dissolve','distinct','distort','distribute','disturb','diverse',
        'document','domestic','dominate','draft','drama','drastic','duration','dynamic'
    ]);
    
    const lower = word.toLowerCase();
    const simpleWord = simpleWords.has(lower);
    const commonWord = commonWords.has(lower);
    
    // 长度越长通常越难
    const lenScore = word.length;
    
    if (simpleWord || lenScore <= 4) return '小学';
    if (commonWord && lenScore <= 7) return '中学';
    if (commonWord || lenScore <= 9) return '高中';
    return 'CET4_6_TOEFL';
}

async function addLevelField(token) {
    // 先检查 Level 字段是否已存在
    const fields = await listFields(token);
    const existingField = fields.find(f => f.field_name === 'Level');
    if (existingField) {
        console.log('Level 字段已存在，字段 ID:', existingField.field_id);
        return existingField;
    }
    
    // 创建 Level 字段（select 类型）
    const body = {
        field_name: 'Level',
        type: 3,  // select
        property: {
            options: [
                { name: '小学', color: 1 },
                { name: '中学', color: 2 },
                { name: '高中', color: 3 },
                { name: 'CET4_6_TOEFL', color: 4 }
            ]
        }
    };
    
    const path = `/open-apis/bitable/v1/apps/${WORD_TABLE.appToken}/tables/${WORD_TABLE.tableId}/fields`;
    const res = await request('POST', path, body, token);
    if (res.code !== 0) throw new Error('添加 Level 字段失败: ' + JSON.stringify(res));
    console.log('Level 字段创建成功, ID:', res.data.field.field_id);
    return res.data.field;
}

async function getWordRecords(token) {
    const allRecords = [];
    let pageToken = null;
    do {
        let url = `/open-apis/bitable/v1/apps/${WORD_TABLE.appToken}/tables/${WORD_TABLE.tableId}/records?page_size=500`;
        if (pageToken) url += `&page_token=${pageToken}`;
        const res = await request('GET', url, null, token);
        if (res.code !== 0) throw new Error('获取记录失败: ' + JSON.stringify(res));
        allRecords.push(...res.data.items);
        pageToken = res.data.has_more ? res.data.page_token : null;
    } while (pageToken);
    return allRecords;
}

function getFieldValue(value) {
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return value.length > 0 ? getFieldValue(value[0]) : '';
    if (typeof value === 'object') {
        if (value.text !== undefined) return String(value.text);
        if (value.name !== undefined) return String(value.name);
        if (value.value !== undefined) return String(value.value);
        if (value.id !== undefined) return String(value.id);
        try { const p = JSON.parse(value); return getFieldValue(p); } catch {}
        return String(value);
    }
    return String(value);
}

async function batchUpdateRecords(token, updates) {
    // 分批更新，每批 50 条
    const BATCH = 50;
    let updated = 0;
    
    for (let i = 0; i < updates.length; i += BATCH) {
        const batch = updates.slice(i, i + BATCH);
        const body = {
            records: batch.map(u => ({
                record_id: u.record_id,
                fields: u.fields
            }))
        };
        
        const path = `/open-apis/bitable/v1/apps/${WORD_TABLE.appToken}/tables/${WORD_TABLE.tableId}/records/batch_update`;
        const res = await request('POST', path, body, token);
        
        if (res.code === 0) {
            updated += batch.length;
            console.log(`已更新 ${updated}/${updates.length} 条记录`);
        } else {
            console.error(`批次 ${i} 更新失败:`, JSON.stringify(res).slice(0, 200));
        }
        
        await new Promise(r => setTimeout(r, 200));
    }
    
    return updated;
}

async function main() {
    console.log('=== 单词难度等级设置 ===\n');
    
    // 1. 获取 Token
    console.log('1. 获取飞书 Token...');
    const token = await getToken();
    console.log('   Token 获取成功\n');
    
    // 2. 添加 Level 字段
    console.log('2. 检查/创建 Level 字段...');
    await addLevelField(token);
    console.log('');
    
    // 3. 获取所有单词记录
    console.log('3. 获取单词记录...');
    const records = await getWordRecords(token);
    console.log(`   共 ${records.length} 条记录\n`);
    
    // 4. 提取单词信息
    const words = records
        .filter(r => getFieldValue(r.fields.Word))
        .map(r => ({
            record_id: r.record_id,
            word: getFieldValue(r.fields.Word),
            pos: getFieldValue(r.fields.POS),
            meaning: getFieldValue(r.fields.Meaning) || getFieldValue(r.fields.CN_Meaning)
        }));
    console.log(`4. 准备分类 ${words.length} 个单词...\n`);
    
    // 5. AI 分类
    console.log('5. MiniMax AI 分类中...');
    const levelMap = await classifyWithAI(words);
    console.log(`   完成分类: ${Object.keys(levelMap).length} 词\n`);
    
    // 统计分布
    const dist = {};
    for (const lvl of Object.values(levelMap)) {
        dist[lvl] = (dist[lvl] || 0) + 1;
    }
    console.log('   分布:', JSON.stringify(dist), '\n');
    
    // 6. 更新飞书表
    console.log('6. 写入飞书表...');
    const updates = Object.entries(levelMap).map(([record_id, level]) => ({
        record_id,
        fields: { Level: level }
    }));
    
    const updated = await batchUpdateRecords(token, updates);
    console.log(`\n=== 完成! 共更新 ${updated} 条记录 ===`);
}

main().catch(e => {
    console.error('脚本失败:', e);
    process.exit(1);
});