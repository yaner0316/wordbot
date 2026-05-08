const https = require('https');
const http = require('http');

const WORD_TABLE_APP_TOKEN = 'BWhIb2hjaaDQHdsNhWRcPluBncg';
const WORD_TABLE_ID = 'tblyMh69dws6ty6n';
const DISTRACTOR_APP_TOKEN = 'GskxbMxMgaDPFRsgqS4cdWvdndb';
const DISTRACTOR_TABLE_ID = 'tbl3EgurgOTXdM3V';

const TRAD_TO_SIMP = {
    '為': '为', '與': '与', '過': '过', '來': '来', '時': '时',
    '們': '们', '這': '这', '個': '个', '學': '学', '國': '国',
    '會': '会', '對': '对', '麼': '么', '沒': '没', '種': '种',
    '經': '经', '開': '开', '現': '现', '長': '长', '業': '业',
    '發': '发', '見': '见', '關': '关', '電': '电', '網': '网',
    '場': '场', '間': '间', '題': '题', '處': '处', '應': '应',
    '進': '进', '動': '动', '運': '运', '營': '营', '變': '变',
    '選': '选', '門': '门', '術': '术', '環': '环', '條件': '条件',
    '說': '说', '認': '认', '論': '论', '無': '无', '機': '机',
    '東': '东', '車': '车', '員': '员', '義': '义', '達': '达',
    '區': '区', '書': '书', '報': '报', '資': '资', '總': '总',
    '產': '产', '價': '价', '結': '结', '覺': '觉', '廣': '广',
    '幾': '几', '萬': '万', '參': '参', '華': '华', '標': '标',
    '錯': '错', '雖': '虽', '義': '义', '親': '亲', '聽': '听',
    '從': '从', '樣': '样', '線': '线', '風': '风', '護': '护',
    '準': '准', '備': '备', '導': '导', '創': '创', '復': '复',
    '極': '极', '務': '务', '確': '确', '單': '单', '觀': '观',
    '類': '类', '統': '统', '據': '据', '層': '层', '歷': '历',
    '決': '决', '質': '质', '號': '号', '護': '护', '試': '试',
    '連': '连', '龍': '龙', '隊': '队', '農': '农', '導': '导',
    '異': '异', '餘': '余', '體': '体', '島': '岛', '藥': '药',
    '鄉': '乡', '錶': '表', '鍾': '钟', '錢': '钱', '録': '录',
    '陽': '阳', '陰': '阴', '隊': '队', '雜': '杂', '雙': '双',
    '難': '难', '離': '离', '電': '电', '靈': '灵', '顧': '顾',
    '顯': '显', '風': '风', '餘': '余', '嚴': '严', '聽': '听',
    '驗': '验', '競': '竞', '護': '护', '繼': '继', '續': '续',
    '聯': '联', '職': '职', '鐵': '铁', '歸': '归', '寶': '宝',
    '懸': '悬', '證': '证', '織': '织', '護': '护', '譯': '译',
    '競': '竞', '贊': '赞', '輸': '输', '辦': '办', '醜': '丑',
    '鎮': '镇', '鐵': '铁', '鑰': '钥', '長': '长', '門': '门',
    '閉': '闭', '開': '开', '間': '间', '關': '关', '陽': '阳',
    '陳': '陈', '隨': '随', '際': '际', '陸': '陆', '階': '阶',
    '電': '电', '靈': '灵', '電': '电', '預': '预', '餘': '余',
    '顯': '显', '風': '风', '養': '养', '餘': '余', '鹼': '碱',
    '點': '点', '響': '响', '覺': '觉', '護': '护', '讓': '让',
    '謊': '谎', '證': '证', '譽': '誉', '讀': '读', '護': '护',
    '變': '变', '計': '计', '認': '认', '誤': '误', '誇': '夸',
    '論': '论', '設': '设', '許': '许', '訴': '诉', '詞': '词',
    '試': '试', '謝': '谢', '謬': '谬', '護': '护', '譯': '译'
};

function toSimplified(text) {
    if (!text) return text;
    let result = text;
    for (const [trad, simp] of Object.entries(TRAD_TO_SIMP)) {
        result = result.replace(new RegExp(trad, 'g'), simp);
    }
    return result;
}

function request(method, path, body, token) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const headers = { 'Content-Type': 'application/json' };
        if (data) headers['Content-Length'] = Buffer.byteLength(data);
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const req = https.request({ hostname: 'open.feishu.cn', path, method, headers }, (res) => {
            let chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

function httpGet(url, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        const req = protocol.get(url, (res) => {
            if (res.statusCode >= 400) { resolve(null); return; }
            let chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
                catch (e) { resolve(null); }
            });
        });
        req.on('error', () => resolve(null));
        req.setTimeout(timeout, () => { req.destroy(); resolve(null); });
    });
}

async function getFeishuToken() {
    const res = await request('POST', '/open-apis/auth/v3/tenant_access_token/internal', {
        app_id: 'cli_a97e125f0ab89cb5',
        app_secret: 'pppKJAybbiNqKIDB9hlvshTnXGPg7OVH'
    });
    return res.tenant_access_token;
}

async function getRecords(token, appToken, tableId) {
    const res = await request('GET', `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=500`, null, token);
    return res.data?.items || [];
}

async function addRecord(token, appToken, tableId, fields) {
    return request('POST', `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`, { fields }, token);
}

async function loadDistractorPool(token) {
    const records = await getRecords(token, DISTRACTOR_APP_TOKEN, DISTRACTOR_TABLE_ID);
    const pool = {};
    for (const r of records) {
        if (r.fields.Word) {
            pool[r.fields.Word.toLowerCase()] = {
                pos: r.fields.POS,
                distractors: r.fields.Distractors ? r.fields.Distractors.split(',').map(s => s.trim().toLowerCase()) : []
            };
        }
    }
    return pool;
}

function getPOSFromSuffix(word) {
    if (word.endsWith('tion') || word.endsWith('sion') || word.endsWith('ment') || word.endsWith('ness')) return 'n';
    if (word.endsWith('ly') && word.length > 5) return 'adv';
    if (word.endsWith('ing') || word.endsWith('ed')) return 'v';
    if (word.endsWith('ful') || word.endsWith('less') || word.endsWith('ous') || word.endsWith('ive') || word.endsWith('al') || word.endsWith('ent') || word.endsWith('ant')) return 'adj';
    return 'n';
}

async function fetchEnglishInfo(word) {
    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`;
    const data = await httpGet(url);
    if (!data || !data[0]) return null;
    const entry = data[0];
    const meanings = entry.meanings || [];
    if (meanings.length === 0) return null;
    const firstMeaning = meanings[0];
    const definitions = firstMeaning.definitions || [];
    if (definitions.length === 0) return null;
    const def = definitions[0];
    return {
        pos: firstMeaning.partOfSpeech || 'n',
        definition: def.definition || '',
        example: def.example || ''
    };
}

async function fetchChineseMeaning(word) {
    try {
        const url = new URL('https://api.mymemory.translated.net/get');
        url.searchParams.set('q', word);
        url.searchParams.set('langpair', 'en|zh-CN');
        const data = await httpGet(url.toString());
        if (data && data.responseStatus === 200 && data.responseData) {
            return toSimplified(data.responseData.translatedText || '');
        }
    } catch (e) {}
    return '';
}

async function fetchWordInfo(word, existingPool) {
    const existing = existingPool[word.toLowerCase()];
    if (existing && existing.distractors && existing.distractors.length >= 3) {
        const enInfo = await fetchEnglishInfo(word);
        const chineseMeaning = await fetchChineseMeaning(word);
        return {
            meaning: chineseMeaning || (enInfo?.definition || word),
            pos: existing.pos || enInfo?.pos || getPOSFromSuffix(word),
            distractors: existing.distractors,
            source: 'existing_pool'
        };
    }
    
    const enInfo = await fetchEnglishInfo(word);
    if (!enInfo) {
        return { meaning: '', pos: getPOSFromSuffix(word), distractors: [], source: 'fallback' };
    }
    
    const chineseMeaning = await fetchChineseMeaning(word);
    return {
        meaning: chineseMeaning || enInfo.definition,
        pos: enInfo.pos,
        distractors: [],
        source: chineseMeaning ? 'mymemory' : 'dictionaryapi'
    };
}

const FALLBACK_DISTRACTORS = {
    v: ['receive', 'obtain', 'acquire', 'achieve', 'attain', 'gain', 'grasp', 'capture', 'comprehend', 'master'],
    n: ['instance', 'example', 'case', 'sample', 'specimen', 'model', 'pattern', 'item', 'aspect', 'feature'],
    adj: ['attractive', 'appealing', 'charming', 'elegant', 'graceful', 'beautiful', 'striking', 'impressive', 'distinguished'],
    adv: ['quickly', 'slowly', 'carefully', 'gently', 'suddenly', 'completely', 'absolutely', 'thoroughly', 'precisely']
};

function selectDistractors(pos, existingDistractors) {
    const pool = existingDistractors.length >= 3 ? existingDistractors : (FALLBACK_DISTRACTORS[pos] || FALLBACK_DISTRACTORS.n);
    return pool.sort(() => Math.random() - 0.5).slice(0, 4);
}

function generateContext(word, example) {
    if (example) {
        const filled = example.replace(new RegExp(word, 'gi'), '___');
        if (filled.includes('___')) return filled;
    }
    const templates = {
        v: [`The speaker asked the audience to ___ the main point.`, `You need to ___ the opportunity while it lasts.`, `We must ___ our efforts to succeed.`],
        n: [`This ___ plays a crucial role in the theory.`, `The concept of ___ is essential for understanding.`, `We examined the ___ from multiple perspectives.`],
        adj: [`It was an ___ decision that surprised everyone.`, `The ___ approach proved most effective.`, `This is an ___ matter requiring careful attention.`],
        adv: [`She completed the task ___ and efficiently.`, `The experiment was conducted ___ as planned.`, `He responded ___ to the unexpected question.`]
    };
    const pos = getPOSFromSuffix(word);
    const pool = templates[pos] || templates.n;
    return pool[Math.floor(Math.random() * pool.length)].replace('___', word);
}

async function autoImportWords(userId, words) {
    const token = await getFeishuToken();
    const distractorPool = await loadDistractorPool(token);
    const now = Date.now();
    const results = { success: 0, failed: 0 };
    
    for (const word of words) {
        try {
            console.log(`处理: ${word}...`);
            
            const info = await fetchWordInfo(word, distractorPool);
            const pos = info.pos || getPOSFromSuffix(word);
            const context = generateContext(word, info.example);
            const distractors = selectDistractors(pos, info.distractors);
            
            await addRecord(token, WORD_TABLE_APP_TOKEN, WORD_TABLE_ID, {
                'user': userId, 'Word': word, 'Status': 'Pending', 'record_time': now, 'Error_Count': 0
            });
            
            await addRecord(token, DISTRACTOR_APP_TOKEN, DISTRACTOR_TABLE_ID, {
                'Word': word, 'POS': pos, 'Meaning': info.meaning || word,
                'Distractors': distractors.join(','), 'Context': context, 'Translation': info.meaning
            });
            
            results.success++;
            console.log(`  ✓ [${info.source}] 词性: ${pos} | 释义: ${info.meaning || '(无)'}`);
            console.log(`  ✓ 干扰项: ${distractors.join(', ')}`);
        } catch (e) {
            results.failed++;
            console.log(`  ✗ ${word}: ${e.message}`);
        }
    }
    
    console.log(`\n[System]: 已录入 ${results.success} 个新单词。失败: ${results.failed}。`);
}

const words = process.argv.slice(2);
if (words.length > 0) {
    autoImportWords('yusi', words);
} else {
    console.log('用法: node auto_import.js word1 word2 word3 ...');
}
