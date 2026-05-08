const https = require('https');
const crypto = require('crypto');

const USER_ID = process.argv[2] || 'yusi';
const TEST_ID = crypto.randomUUID().split('-')[0];

const WORD_TABLE = { appToken: 'BWhIb2hjaaDQHdsNhWRcPluBncg', tableId: 'tblyMh69dws6ty6n' };
const DISTRACTOR_TABLE = { appToken: 'GskxbMxMgaDPFRsgqS4cdWvdndb', tableId: 'tbl3EgurgOTXdM3V' };
const TEST_TABLE = { appToken: 'FyyPb1urFacfn7sGSjpca2UwnHe', tableId: 'tbl6Nx0kJWjr7qQZ' };
const STATS_TABLE = { appToken: 'Mbh7bK7Jrah7XMsV9lhceE7cnyh', tableId: 'tblQBYKzcQuz8sSq' };

const QUESTION_CONFIG = {
    type1Ratio: 0.6, type2Ratio: 0.2, type3Ratio: 0.2
};

const FORBIDDEN_CONTEXTS = [
    'is essential for understanding', 'plays a crucial role',
    'is very important in this context', 'from multiple perspectives',
    'commonly used in academic'
];

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
    '義': '义', '議': '议', '護': '护', '續': '续', '顯': '显',
    '導': '导', '點': '点', '讓': '让', '證': '证', '讀': '读',
    '誤': '误', '設': '设', '許': '许', '訴': '诉', '詞': '词',
    '試': '试', '謝': '谢', '謬': '谬', '幾': '几', '萬': '万',
    '參': '参', '華': '华', '標': '标', '錯': '错', '雖': '虽',
    '親': '亲', '聽': '听', '從': '从', '樣': '样', '線': '线',
    '風': '风', '準': '准', '備': '备', '創': '创', '復': '复',
    '極': '极', '務': '务', '確': '确', '單': '单', '觀': '观',
    '類': '类', '統': '统', '據': '据', '層': '层', '歷': '历',
    '決': '决', '質': '质', '號': '号', '連': '连', '龍': '龙',
    '隊': '队', '農': '农', '異': '异', '餘': '余', '體': '体',
    '島': '岛', '藥': '药', '鄉': '乡', '錶': '表', '鍾': '钟',
    '錢': '钱', '陽': '阳', '陰': '阴', '雜': '杂', '雙': '双',
    '難': '难', '離': '离', '靈': '灵', '驗': '验', '競': '竞',
    '繼': '继', '聯': '联', '職': '职', '鐵': '铁', '歸': '归',
    '寶': '宝', '懸': '悬', '織': '织', '譯': '译', '贊': '赞',
    '輸': '输', '辦': '办', '醜': '丑', '鎮': '镇', '鑰': '钥',
    '閉': '闭', '陳': '陈', '隨': '随', '際': '际', '陸': '陆',
    '階': '阶', '預': '预', '響': '响', '謊': '谎', '譽': '誉',
    '計': '计', '誇': '夸', '寫': '写', '愛': '爱', '協': '协',
    '歐': '欧', '戰': '战', '戲': '戏', '興': '兴', '積': '积',
    '敗': '败', '賽': '赛', '贏': '赢', '賣': '卖', '買': '买',
    '適合': '适合', '適': '适', '飛': '飞', '識': '识', '調': '调',
    '貝': '贝', '負': '负', '軍': '军', '軌': '轨', '軟': '软',
    '轉': '转', '載': '载', '輕': '轻', '還': '还', '達': '达',
    '蘇': '苏', '鹼': '碱', '彌': '弥', '徵': '征', '範': '范',
    '髮': '发', '麵': '面', '製': '制', '鍊': '链', '複': '复',
    '韌': '韧', '錄': '录'
};

function toSimplified(text) {
    if (!text || typeof text !== 'string') return text || '';
    let result = text;
    for (const [trad, simp] of Object.entries(TRAD_TO_SIMP)) {
        if (result.includes(trad)) result = result.split(trad).join(simp);
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

async function getToken() {
    const res = await request('POST', '/open-apis/auth/v3/tenant_access_token/internal', {
        app_id: 'cli_a97e125f0ab89cb5', app_secret: 'pppKJAybbiNqKIDB9hlvshTnXGPg7OVH'
    });
    return res.tenant_access_token;
}

async function getRecords(token, table) {
    const res = await request('GET', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records?page_size=500`, null, token);
    return res.data?.items || [];
}

async function addRecord(token, table, fields) {
    return request('POST', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records`, { fields }, token);
}

async function updateRecord(token, table, recordId, fields) {
    return request('PUT', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records/${recordId}`, { fields }, token);
}

async function getDistractorPool(token) {
    const records = await getRecords(token, DISTRACTOR_TABLE);
    const pool = {};
    for (const r of records) {
        const word = r.fields.Word;
        if (word) {
            pool[word.toLowerCase()] = {
                pos: r.fields.POS,
                meaning: r.fields.Meaning,
                distractors: r.fields.Distractors ? r.fields.Distractors.split(',').map(s => s.trim()) : [],
                context: r.fields.Context
            };
        }
    }
    return pool;
}

async function getPendingWords(token) {
    const records = await getRecords(token, WORD_TABLE);
    return records.filter(r => r.fields.user === USER_ID && r.fields.Status !== 'Mastered')
        .map(r => ({ word: r.fields.Word, record_id: r.record_id }));
}

function secureRandomSelect(arr, count) {
    if (arr.length <= count) return [...arr];
    const shuffled = [];
    const pool = [...arr];
    while (shuffled.length < count && pool.length > 0) {
        const index = crypto.randomInt(0, pool.length);
        shuffled.push(pool.splice(index, 1)[0]);
    }
    return shuffled;
}

function isContextValid(context) {
    if (!context || context === '___' || context.includes('[object Object]') || !context.includes('___')) return false;
    const lower = context.toLowerCase();
    return !FORBIDDEN_CONTEXTS.some(f => lower.includes(f.toLowerCase()));
}

function generateType1(word, info, distractors) {
    const idx = crypto.randomInt(0, 4);
    const opts = [...distractors]; opts.splice(idx, 0, word);
    const letters = ['A', 'B', 'C', 'D'];
    return { type: 1, word, context: info.context.replace(new RegExp(word, 'gi'), '___'), options: opts.map((o, i) => `${letters[i]}. ${o}`), answer: letters[idx] };
}

function generateType2(word, info, distractors) {
    const idx = crypto.randomInt(0, 4);
    const opts = [...distractors]; opts.splice(idx, 0, word);
    const letters = ['A', 'B', 'C', 'D'];
    return { type: 2, word, meaning: info.meaning || '', options: opts.map((o, i) => `${letters[i]}. ${o}`), answer: letters[idx] };
}

function generateType3(word, info, distractors) {
    const idx = crypto.randomInt(0, 4);
    const opts = [...distractors]; opts.splice(idx, 0, word);
    const letters = ['A', 'B', 'C', 'D'];
    const base = info.context.replace(new RegExp(word, 'gi'), '___');
    const lastBlank = base.lastIndexOf('___');
    return { type: 3, word, context: base.substring(0, lastBlank), suffix: base.substring(lastBlank + 3), options: opts.map((o, i) => `${letters[i]}. ${o}`), answer: letters[idx] };
}

function generateQuestions(words, pool, config) {
    const { type1Ratio, type2Ratio, type3Ratio } = config;
    const total = 10;
    const type1Count = Math.round(total * type1Ratio);
    const type2Count = Math.round(total * type2Ratio);
    const type3Count = total - type1Count - type2Count;
    
    const valid = words.filter(w => {
        const info = pool[w.word.toLowerCase()];
        return info && isContextValid(info.context) && info.distractors && info.distractors.length >= 3;
    });
    
    if (valid.length < total) console.log(`警告: 有效单词不足，当前${valid.length}个`);
    
    const selected = secureRandomSelect(valid, total * 2);
    const used = new Set();
    const questions = [];
    
    for (const w of selected) {
        if (questions.length >= total) break;
        const key = w.word.toLowerCase();
        if (used.has(key)) continue;
        used.add(key);
        
        const info = pool[key];
        const distrs = secureRandomSelect(info.distractors, 3);
        const t1r = type1Count - questions.filter(q => q.type === 1).length;
        const t2r = type2Count - questions.filter(q => q.type === 2).length;
        const t3r = type3Count - questions.filter(q => q.type === 3).length;
        
        let type;
        if (t1r > 0 && (t2r <= 0 || Math.random() < type1Ratio)) type = 1;
        else if (t2r > 0 && (t3r <= 0 || Math.random() < type2Ratio / (type2Ratio + type3Ratio))) type = 2;
        else if (t3r > 0) type = 3;
        else continue;
        
        if (type === 1) questions.push(generateType1(w.word, info, distrs));
        else if (type === 2) questions.push(generateType2(w.word, info, distrs));
        else questions.push(generateType3(w.word, info, distrs));
    }
    return questions;
}

function formatQuestions(questions) {
    let out = `【用户: ${USER_ID} | 测试ID: ${TEST_ID}】\n\n`;
    questions.forEach((q, i) => {
        out += `【${i+1}】`;
        if (q.type === 1) out += `${toSimplified(q.context)}\n${q.options.join('  ')}\n\n`;
        else if (q.type === 2) out += `请选择与"${toSimplified(q.meaning)}"对应的单词\n${q.options.join('  ')}\n\n`;
        else out += `${toSimplified(q.context)}\n${toSimplified(q.suffix)}\n${q.options.join('  ')}\n\n`;
    });
    return out;
}

async function saveTestResults(token, questions) {
    const now = Date.now();
    for (const q of questions) {
        await addRecord(token, TEST_TABLE, {
            'user': USER_ID, 'test_id': TEST_ID, 'word': q.word,
            'your_answer': '', 'correct_answer': q.answer,
            'is_correct': ['错误'], 'question_type': q.type, 'test_time': now
        });
    }
}

async function updateStats(token, answers) {
    const records = await getRecords(token, STATS_TABLE);
    const userRecord = records.find(r => r.fields.user === USER_ID);
    
    const correct = answers.filter(a => a.isCorrect).length;
    const accuracy = answers.length > 0 ? (correct / answers.length * 100).toFixed(1) + '%' : '0%';
    
    const wordRecords = await getRecords(token, WORD_TABLE);
    const userWords = wordRecords.filter(r => r.fields.user === USER_ID);
    const total = userWords.length;
    const mastered = userWords.filter(r => r.fields.Status === 'Mastered').length;
    const pending = total - mastered;
    
    const fields = {
        'user': USER_ID, 'total_words': total, 'mastered_words': mastered,
        'pending_words': pending, 'total_tests': (userRecord?.fields?.total_tests || 0) + 1,
        'correct_count': (userRecord?.fields?.correct_count || 0) + correct,
        'accuracy_rate': accuracy, 'last_test_time': Date.now()
    };
    
    if (userRecord) {
        await updateRecord(token, STATS_TABLE, userRecord.record_id, fields);
    } else {
        await addRecord(token, STATS_TABLE, fields);
    }
}

async function main() {
    const token = await getToken();
    const [words, pool] = await Promise.all([getPendingWords(token), getDistractorPool(token)]);
    const questions = generateQuestions(words, pool, QUESTION_CONFIG);
    
    console.log(formatQuestions(questions));
    console.log(`共 ${questions.length} 题 | 语境${questions.filter(q=>q.type===1).length} 释义${questions.filter(q=>q.type===2).length} 补全${questions.filter(q=>q.type===3).length}`);
    console.log(`\n答题后运行: node submit_answers.js ${USER_ID} ${TEST_ID} [答案]\n例: node submit_answers.js yusi ${TEST_ID} D,C,B,A,C,D,A,B,C,D`);
    
    await saveTestResults(token, questions);
}

main();
