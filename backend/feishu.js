const https = require('https');
const crypto = require('crypto');

const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const AI_PROVIDER = (process.env.AI_PROVIDER || (DEEPSEEK_API_KEY ? 'deepseek' : (OPENAI_API_KEY ? 'openai' : 'minimax'))).toLowerCase();

const WORD_TABLE = { appToken: 'BWhIb2hjaaDQHdsNhWRcPluBncg', tableId: 'tblyMh69dws6ty6n' };
const DIST_TABLE = { appToken: 'GskxbMxMgaDPFRsgqS4cdWvdndb', tableId: 'tbl3EgurgOTXdM3V' };
const TEST_TABLE = { appToken: 'FyyPb1urFacfn7sGSjpca2UwnHe', tableId: 'tbl6Nx0kJWjr7qQZ' };
const STATS_TABLE = { appToken: 'Mbh7bK7Jrah7XMsV9lhceE7cnyh', tableId: 'tblQBYKzcQuz8sSq' };
const STATUS_PENDING = 'Pending';
const STATUS_MASTERED = 'Mastered';
const STATUS_PENDING_LEGACY = 'optXjbXS2F';
const STATUS_MASTERED_LEGACY = 'optF5P0W3O';

function normalizeStatus(status) {
    if (Array.isArray(status)) return normalizeStatus(status[0]);
    if (!status) return STATUS_PENDING;
    if (typeof status === 'object') {
        return normalizeStatus(getFieldValue(status));
    }
    const value = String(status).trim();
    const lower = value.toLowerCase();
    if (lower === STATUS_MASTERED.toLowerCase() || value === STATUS_MASTERED_LEGACY || value === '已掌握') return STATUS_MASTERED;
    if (lower === STATUS_PENDING.toLowerCase() || value === STATUS_PENDING_LEGACY || value === '待复习') return STATUS_PENDING;
    return STATUS_PENDING;
}

function isMasteredStatus(status) {
    return normalizeStatus(status) === STATUS_MASTERED;
}

function getFieldValue(value) {
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return value.length > 0 ? getFieldValue(value[0]) : '';
    if (typeof value === 'object') {
        if (value.text !== undefined) return String(value.text);
        if (value.name !== undefined) return String(value.name);
        if (value.value !== undefined) return String(value.value);
        if (value.id !== undefined) return String(value.id);
        return JSON.stringify(value);
    }
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed) || (parsed && typeof parsed === 'object')) {
                return getFieldValue(parsed);
            }
        } catch (e) {}
        return value;
    }
    return String(value);
}

function isCorrectField(value) {
    const normalized = getFieldValue(value).trim();
    return normalized === 'optHGT7gYf' || normalized === '正确' || normalized.toLowerCase() === 'true';
}

function hasSubmittedAnswer(record) {
    return record?.fields?.is_correct !== undefined && record?.fields?.is_correct !== null;
}

const TRAD_TO_SIMP = {
    '為':'为','與':'与','過':'过','來':'来','時':'时','們':'们','這':'这',
    '個':'个','學':'学','國':'国','會':'会','對':'对','麼':'么','沒':'没',
    '種':'种','經':'经','開':'开','現':'现','長':'长','業':'业','發':'发',
    '見':'见','關':'关','電':'电','網':'网','場':'场','間':'间','題':'题',
    '處':'处','應':'应','進':'进','動':'动','運':'运','營':'营','變':'变',
    '選':'选','門':'门','術':'术','環':'环','說':'说','認':'认','論':'论',
    '無':'无','機':'机','義':'义','議':'议','護':'护','續':'续','顯':'显',
    '導':'导','點':'点','讓':'让','證':'证','讀':'读','誤':'误','設':'设',
    '許':'许','訴':'诉','詞':'词','試':'试','謝':'谢','幾':'几','萬':'万',
    '參':'参','華':'华','標':'标','錯':'错','雖':'虽','親':'亲','聽':'听',
    '從':'从','樣':'样','線':'线','風':'风','準':'准','備':'备','創':'创',
    '極':'极','務':'务','確':'确','單':'单','觀':'观','類':'类','統':'统',
    '據':'据','層':'层','歷':'历','決':'决','質':'质','號':'号','連':'连',
    '龍':'龙','隊':'队','農':'农','異':'异','餘':'余','體':'体','島':'岛',
    '藥':'药','鄉':'乡','錢':'钱','陽':'阳','陰':'阴','雜':'杂','雙':'双',
    '難':'难','離':'离','靈':'灵','驗':'验','競':'竞','繼':'继','聯':'联',
    '職':'职','鐵':'铁','歸':'归','寶':'宝','懸':'悬','織':'织','譯':'译',
    '贊':'赞','輸':'输','辦':'办','鎮':'镇','閉':'闭','陳':'陈','隨':'随',
    '際':'际','陸':'陆','階':'阶','預':'预','響':'响','謊':'谎','譽':'誉',
    '計':'计','誇':'夸','寫':'写','愛':'爱','協':'协','歐':'欧','戰':'战',
    '戲':'戏','興':'兴','積':'积','敗':'败','賽':'赛','贏':'赢','賣':'卖',
    '買':'买','適':'适','飛':'飞','識':'识','調':'调','貝':'贝','負':'负',
    '軍':'军','軌':'轨','軟':'软','轉':'转','載':'载','輕':'轻','還':'还',
    '達':'达','蘇':'苏','彌':'弥','徵':'征','範':'范','髮':'发','麵':'面',
    '製':'制','鍊':'链','複':'复','韌':'韧','錄':'录'
};

function toSimp(text) {
    if (!text || typeof text !== 'string') return text || '';
    let r = text;
    for (const [t, s] of Object.entries(TRAD_TO_SIMP)) {
        if (r.includes(t)) r = r.split(t).join(s);
    }
    return r;
}

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

let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
    if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
    if (!APP_ID || !APP_SECRET) {
        throw new Error('FEISHU_APP_ID and FEISHU_APP_SECRET must be set');
    }
    const res = await request('POST', '/open-apis/auth/v3/tenant_access_token/internal', {
        app_id: APP_ID, app_secret: APP_SECRET
    });
    cachedToken = res.tenant_access_token;
    tokenExpiry = Date.now() + (res.expire || 7200) * 1000 - 60000;
    return cachedToken;
}

async function getRecords(table) {
    const token = await getToken();
    const allRecords = [];
    let pageToken = null;
    do {
        let url = `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records?page_size=500`;
        if (pageToken) url += `&page_token=${pageToken}`;
        const res = await request('GET', url, null, token);
        const items = res.data?.items || [];
        allRecords.push(...items);
        pageToken = res.data?.page_token;
    } while (pageToken);
    console.log(`getRecords: 共获取 ${allRecords.length} 条记录`);
    return allRecords;
}

async function searchRecords(table, filter, sort, timeout = 30000) {
    const token = await getToken();
    const allRecords = [];
    let pageToken = null;
    const body = { page_size: 500 };
    if (filter) body.filter = filter;
    if (sort) body.sort = sort;

    const startTime = Date.now();
    do {
        if (pageToken) body.page_token = pageToken;
        if (Date.now() - startTime > timeout) throw new Error('search timeout');
        const res = await request('POST', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records/search`, body, token);
        const items = res.data?.items || [];
        allRecords.push(...items);
        pageToken = res.data?.page_token;
    } while (pageToken);
    console.log(`searchRecords: 共获取 ${allRecords.length} 条记录`);
    return allRecords;
}

async function addRecord(table, fields) {
    const token = await getToken();
    console.log('写入表:', table.appToken, table.tableId);
    console.log('写入字段:', JSON.stringify(fields));
    const res = await request('POST', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records`, { fields }, token);
    console.log('API返回:', JSON.stringify(res).substring(0, 200));
    if (res.code !== 0) {
        throw new Error(`添加记录失败: ${res.msg || res.code}`);
    }
    return res;
}

async function updateRecord(table, recordId, fields) {
    const token = await getToken();
    const res = await request('PUT', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records/${recordId}`, { fields }, token);
    console.log('updateRecord返回:', JSON.stringify(res).substring(0, 200));
    if (res.code !== 0) {
        throw new Error(`更新记录失败: ${res.msg || res.code}`);
    }
    return res;
}

function secureRandom(arr, count) {
    if (arr.length <= count) return [...arr];
    const pool = [...arr];
    const result = [];
    for (let i = pool.length - 1; i > 0; i--) {
        const j = crypto.randomInt(0, i + 1);
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, count);
}

async function getDistractorPool() {
    const records = await getRecords(WORD_TABLE);
    // 按 record_id 存储，每条记录独立（多义词每个释义都是独立记录）
    const pool = {};
    // 额外维护 word -> records 索引（用于多义词识别）
    const wordIndex = {};
    // 词库统计
    let stats = { total: 0, hasCN: 0, hasDist3: 0, canType3: 0 };

    for (const r of records) {
        const w = r.fields.Word?.toLowerCase();
        if (w) {
            const cn = r.fields.CN_Meaning?.trim() || '';
            const dists = r.fields.Distractors ? r.fields.Distractors.split(',').map(s => s.trim()).filter(s => s) : [];
            const context = r.fields.Context || '';

            pool[r.record_id] = {
                word: r.fields.Word,
                meaning: r.fields.Meaning,
                CN_Meaning: cn,
                distractors: dists,
                context: context,
                rawContext: context,
                pos: r.fields.POS,
                multi_definition: r.fields.multi_definition
            };

            if (!wordIndex[w]) wordIndex[w] = [];
            wordIndex[w].push(r.record_id);

            stats.total++;
            if (cn) stats.hasCN++;
            if (dists.length >= 3) stats.hasDist3++;
            if (cn && dists.length >= 3) stats.canType3++;
        }
    }
    console.log(`词库: 总数=${stats.total}, 有中文=${stats.hasCN}, 有3个干扰词=${stats.hasDist3}, 可出type3=${stats.canType3}`);
    return { pool, wordIndex };
}

async function getPendingWords(userId) {
    const records = await getRecords(WORD_TABLE);
    return records
        .filter(r => r.fields.user === userId && !isMasteredStatus(r.fields.Status))
        .map(r => ({
            record_id: r.record_id,
            word: r.fields.Word,
            meaning: r.fields.Meaning,
            pos: r.fields.POS,
            cn_meaning: r.fields.CN_Meaning,
            context: r.fields.Context,
            distractors: r.fields.Distractors,
            multi_definition: r.fields.multi_definition
        }));
}

function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getWordForms(word) {
    const key = String(word || '').toLowerCase();
    const forms = new Set([key]);
    if (key.endsWith('y')) forms.add(key.slice(0, -1) + 'ies');
    forms.add(key + 's');
    forms.add(key + 'ed');
    forms.add(key + 'ing');
    return Array.from(forms).filter(Boolean);
}

function isContextUsableForWord(word, ctx) {
    if (!ctx || typeof ctx !== 'string') return false;
    const text = ctx.trim();
    if (text === '___' || text.includes('[object Object]')) return false;
    const tokens = text.match(/[A-Za-z]+/g) || [];
    if (tokens.length < 7) return false;
    if (/^it\s+(works|worked|functions?)\s+like\s+a\s+charm\.?$/i.test(text)) return false;
    if (/^the word ".+" is used in context\.$/i.test(text)) return false;

    const forms = getWordForms(word).map(escapeRegExp).join('|');
    if (!new RegExp(`\\b(${forms})\\b`, 'i').test(text)) return false;
    const target = String(word || '').toLowerCase();
    const clueWords = tokens
        .map(t => t.toLowerCase())
        .filter(t => !getWordForms(target).includes(t))
        .filter(t => !['the','a','an','it','this','that','these','those','he','she','they','we','i','you','his','her','their','our','my','your','is','are','was','were','be','been','being','has','have','had','do','does','did','to','of','in','on','at','for','with','by','and','or','but','like'].includes(t));
    return clueWords.length >= 4;
}

function generateQuestion(word, info, distractors, type, allWords) {
    if (!distractors || distractors.length < 3) {
        distractors = secureRandom(allWords.filter(w => w !== word.toLowerCase()), 3);
    }
    const idx = crypto.randomInt(0, 4);
    const opts = [...distractors];
    opts.splice(idx, 0, word);
    const letters = ['A', 'B', 'C', 'D'];
    
    let context = info.context || '';
    context = context.replace(new RegExp(word, 'gi'), '___');
    
    if (type === 1) {
        return {
            type: 1,
            word,
            context: context,
            options: opts.map((o, i) => `${letters[i]}. ${o}`),
            answer: letters[idx]
        };
    }
    if (type === 2) {
        return {
            type: 2,
            word,
            meaning: info.meaning || '',
            options: opts.map((o, i) => `${letters[i]}. ${o}`),
            answer: letters[idx]
        };
    }
    const lastBlank = context.lastIndexOf('___');
    return {
        type: 3,
        word,
        context: context.substring(0, lastBlank),
        suffix: context.substring(lastBlank + 3),
        options: opts.map((o, i) => `${letters[i]}. ${o}`),
        answer: letters[idx]
    };
}

async function generateQuiz(userId) {
    const { pool, wordIndex } = await getDistractorPool();
    const pending = await getPendingWords(userId);

    // 按 record 过滤有效记录（每条记录代表一个释义）
    const valid = pending.filter(r => {
        const info = pool[r.record_id];
        return info && (info.distractors || []).filter(d => d).length >= 3;
    });

    if (valid.length < 2) {
        return { error: `可用单词不足，当前${valid.length}个，需要至少2个` };
    }

    // 按 word 分组，识别多义词
    const wordGroup = {};
    for (const rec of valid) {
        const w = rec.word.toLowerCase();
        if (!wordGroup[w]) wordGroup[w] = [];
        wordGroup[w].push(rec);
    }

    // 多义词判断：用 multi_definition 标志（不是按 record 数量）
    const isMultiDef = (rec) => {
        const m = rec.multi_definition;
        return m === 'opthB7bmkB' || (Array.isArray(m) && m.includes('opthB7bmkB'));
    };

    // 识别多义词（multi_definition = opthB7bmkB），按释义数升序排序
    const multiDefGroups = Object.entries(wordGroup)
        .filter(([w, recs]) => recs.length >= 2 && isMultiDef(recs[0]))
        .sort((a, b) => a[1].length - b[1].length);

    const questions = [];
    const usedRecordIds = new Set();
    const testId = crypto.randomUUID().split('-')[0];
    const letters = ['A', 'B', 'C', 'D'];

    // 1. 多义词出题：选 1 个多义词，每个释义出 1 题
    if (multiDefGroups.length > 0) {
        const candidates = multiDefGroups.slice(0, 2);  // 释义最少的前 2 个随机选
        const picked = secureRandom(candidates, 1)[0];
        const [pickedWord, pickedRecs] = picked;
        console.log(`选中多义词: ${pickedWord}, 释义数=${pickedRecs.length}`);

        for (const rec of pickedRecs) {
            if (questions.length >= 10) break;
            const info = pool[rec.record_id];
            // 判断题型：优先用中文释义
            const cn = info.CN_Meaning?.trim();
            const hasGoodCN = cn && cn.length > 0 && !cn.includes('请提供要翻译的文本');
            const qType = hasGoodCN ? 3 : (isContextUsableForWord(info.word, info.context) ? 1 : 2);
            const q = buildQuizQuestion(rec.record_id, info, qType, testId, letters);
            if (q) {
                questions.push(q);
                usedRecordIds.add(rec.record_id);
            }
        }
    }

    // 2. 剩余题数从单义词中按 6:2:2 抽
    const typeSlots = [...Array(6).fill(1), ...Array(2).fill(2), ...Array(2).fill(3)];
    const shuffledSlots = secureRandom(typeSlots, typeSlots.length);

    const remaining = valid.filter(r => !usedRecordIds.has(r.record_id));

    for (const slot of shuffledSlots) {
        if (questions.length >= 10) break;
        // 优先抽单词未被用过的（去重）
        const candidates = remaining.filter(r => {
            if (usedRecordIds.has(r.record_id)) return false;
            const w = r.word.toLowerCase();
            if (questions.some(q => q.word.toLowerCase() === w)) return false;  // 单义词去重
            const info = pool[r.record_id];
            if (slot === 1) return isContextUsableForWord(info.word, info.context);
            if (slot === 2) return !info.context?.trim() && info.meaning?.trim();
            if (slot === 3) {
                const cn = info.CN_Meaning?.trim();
                return cn && cn.length > 0 && !cn.includes('请提供要翻译的文本');
            }
            return false;
        });
        if (candidates.length === 0) continue;

        const rec = secureRandom(candidates, 1)[0];
        const info = pool[rec.record_id];
        const q = buildQuizQuestion(rec.record_id, info, slot, testId, letters);
        if (q) {
            questions.push(q);
            usedRecordIds.add(rec.record_id);
        }
    }

    console.log(`生成题目: 总=${questions.length}, type1=${questions.filter(q=>q.type===1).length}, type2=${questions.filter(q=>q.type===2).length}, type3=${questions.filter(q=>q.type===3).length}`);

    // 写入 TEST_TABLE（带 record_id 关联到 WORD_TABLE）
    for (const q of questions) {
        await addRecord(TEST_TABLE, {
            user: userId,
            test_id: testId,
            record_id: q.record_id,
            word: q.word,
            question_type: q.type,
            correct_answer: q.answer,
            options: JSON.stringify(q.options),
            test_time: Date.now()
        });
    }

    return {
        testId,
        questions: questions.map(({ testId: _, record_id: __, ...q }) => q)
    };
}

function buildQuizQuestion(recordId, info, qType, testId, letters) {
    const key = info.word.toLowerCase();
    const specificDistrs = (info.distractors || []).filter(d => d !== key);
    if (specificDistrs.length < 3) return null;
    const distrs = secureRandom(specificDistrs, 3);

    const opts = [key, ...distrs];
    for (let i = opts.length - 1; i > 0; i--) {
        const j = crypto.randomInt(0, i + 1);
        [opts[i], opts[j]] = [opts[j], opts[i]];
    }
    const finalOpts = opts.slice(0, 4);
    const correctIdx = finalOpts.indexOf(key);

    let q;
    if (qType === 1) {
        if (!isContextUsableForWord(key, info.context)) return null;
        const pattern = new RegExp(`\\b(${getWordForms(key).map(escapeRegExp).join('|')})\\b`, 'gi');
        const sentence = (info.context || '').replace(pattern, '_____');
        if (!sentence.includes('_____')) return null;
        q = { type: 1, word: key, context: sentence, options: finalOpts.map((o, i) => `${letters[i]}. ${o}`), answer: letters[correctIdx] };
    } else if (qType === 2) {
        const meaning = (info.meaning || '').split(';')[0] || info.meaning || '';
        q = { type: 2, word: key, context: meaning, options: finalOpts.map((o, i) => `${letters[i]}. ${o}`), answer: letters[correctIdx] };
    } else if (qType === 3) {
        const cnMeaning = info.CN_Meaning || '';
        q = { type: 3, word: key, context: cnMeaning, options: finalOpts.map((o, i) => `${letters[i]}. ${o}`), answer: letters[correctIdx] };
    }

    if (!q || !q.context) return null;
    q.testId = testId;
    q.record_id = recordId;
    return q;
}

async function submitAnswers(userId, testId, answers) {
    const filter = {
        conjunction: "and",
        conditions: [
            { field_name: "user", operator: "is", value: [userId] },
            { field_name: "test_id", operator: "is", value: [testId] }
        ]
    };
    const testRecords = await searchRecords(TEST_TABLE, filter);
    console.log(`submitAnswers: 找到 ${testRecords.length} 条记录`);

    if (testRecords.length === 0) return { error: '未找到测试记录' };

    const sortedRecords = testRecords.sort((a, b) => a.fields.test_time - b.fields.test_time);

    let correct = 0;
    const results = [];
    // 按 record_id 分组（新记录精确批改）
    const recordResults = {};
    // 按 word 分组（旧记录兼容批改，仅用于统计不计单词状态）
    const wordResults = {};

    const letters = ['A', 'B', 'C', 'D'];
    for (let i = 0; i < Math.min(sortedRecords.length, answers.length); i++) {
        const rec = sortedRecords[i];
        const yourAnswerIdx = answers[i];
        const yourAnswer = yourAnswerIdx !== null && yourAnswerIdx !== undefined ? letters[yourAnswerIdx] : null;
        const correctAnswer = rec.fields.correct_answer;
        console.log(`第${i+1}题 correctAnswer:`, JSON.stringify(correctAnswer));
        let answerStr = '';
        if (typeof correctAnswer === 'string') {
            try {
                const parsed = JSON.parse(correctAnswer);
                answerStr = Array.isArray(parsed) ? (parsed[0]?.text || parsed[0]) : (parsed?.text || parsed);
            } catch (e) {
                answerStr = correctAnswer;
            }
        } else if (Array.isArray(correctAnswer)) {
            answerStr = correctAnswer[0]?.text || JSON.stringify(correctAnswer);
        } else {
            answerStr = correctAnswer?.text || JSON.stringify(correctAnswer);
        }
        const isCorrect = yourAnswer === answerStr;
        if (isCorrect) correct++;

        await updateRecord(TEST_TABLE, rec.record_id, {
            your_answer: yourAnswer || '',
            is_correct: isCorrect ? ['optHGT7gYf'] : ['optbe4bsQk']
        });

        const word = rec.fields.word;
        const recordId = rec.fields.record_id;

        if (recordId) {
            // 新记录：按 record_id 精确统计
            if (!recordResults[recordId]) recordResults[recordId] = { correct: 0, total: 0, word };
            recordResults[recordId].total++;
            if (isCorrect) recordResults[recordId].correct++;
        } else {
            // 旧记录（无 record_id）：按 word 兼容统计
            if (!wordResults[word]) wordResults[word] = { correct: 0, total: 0 };
            wordResults[word].total++;
            if (isCorrect) wordResults[word].correct++;
        }

        results.push({ q: i + 1, word, recordId, your: yourAnswer, answer: answerStr, correct: isCorrect });
    }

    // 新记录：按 record_id 全部答对 → 标记该 record 为已掌握，答错 → Error_Count +1
    for (const [recordId, stats] of Object.entries(recordResults)) {
        if (stats.correct >= stats.total) {
            await updateRecord(WORD_TABLE, recordId, { Status: STATUS_MASTERED });
        } else {
            // 答错：Error_Count +1
            const current = await getRecords(WORD_TABLE);
            const rec = current.find(r => r.record_id === recordId);
            const errCount = Number(rec?.fields?.Error_Count || 0) + 1;
            await updateRecord(WORD_TABLE, recordId, { Error_Count: errCount });
        }
    }

    // 旧记录：按 word 全部答对 → 标记该 word 的所有 record 为已掌握（兼容方案）
    for (const [word, stats] of Object.entries(wordResults)) {
        if (stats.correct >= stats.total) {
            const wordRecords = (await getRecords(WORD_TABLE)).filter(r => getFieldValue(r.fields.user) === userId && getFieldValue(r.fields.Word) === word);
            for (const wr of wordRecords) {
                await updateRecord(WORD_TABLE, wr.record_id, { Status: STATUS_MASTERED });
            }
        }
    }

    const wordRecords = (await getRecords(WORD_TABLE)).filter(r => getFieldValue(r.fields.user) === userId);
    const total = wordRecords.length;
    const mastered = wordRecords.filter(r => isMasteredStatus(r.fields.Status)).length;

    const statsRecords = await getRecords(STATS_TABLE);
    const userRecord = statsRecords.find(r => r.fields.user === userId);

    const statsFields = {
        user: userId,
        total_words: total,
        mastered_words: mastered,
        pending_words: total - mastered,
        total_tests: Number((userRecord?.fields?.total_tests || 0)) + 1,
        correct_count: Number((userRecord?.fields?.correct_count || 0)) + correct,
        last_test_time: Date.now()
    };

    if (userRecord) {
        await updateRecord(STATS_TABLE, userRecord.record_id, statsFields);
    } else {
        await addRecord(STATS_TABLE, statsFields);
    }

    console.log('submitAnswers results:', JSON.stringify(results).substring(0, 500));
    // 收集本次掌握的单词（返回给前端）
    const masteredWords = [
        ...Object.entries(recordResults)
            .filter(([rid, stats]) => stats.correct >= stats.total)
            .map(([rid, stats]) => stats.word),
        ...Object.entries(wordResults)
            .filter(([word, stats]) => stats.correct >= stats.total)
            .map(([word, stats]) => word)
    ];

    return {
        results,
        correct,
        total: results.length,
        accuracy: `${((correct / results.length) * 100).toFixed(1)}%`,
        masteredWords,
        stats: { total, mastered, pending: total - mastered }
    };
}

async function getStats(userId) {
    const wordRecords = (await getRecords(WORD_TABLE)).filter(r => getFieldValue(r.fields.user) === userId);
    const total = wordRecords.length;
    const mastered = wordRecords.filter(r => isMasteredStatus(r.fields.Status)).length;

    const testRecords = await searchRecords(
        TEST_TABLE,
        { conjunction: "and", conditions: [{ field_name: "user", operator: "is", value: [userId] }] }
    );
    const submittedRecords = testRecords.filter(hasSubmittedAnswer);
    const submittedTestIds = new Set(submittedRecords.map(r => getFieldValue(r.fields.test_id)).filter(Boolean));
    const correctCount = submittedRecords.filter(r => isCorrectField(r.fields.is_correct)).length;
    const totalQuestions = submittedRecords.length;
    const lastTestTime = submittedRecords.reduce((max, r) => {
        const time = Number(r.fields.test_time) || 0;
        return time > max ? time : max;
    }, 0);
    const acc = totalQuestions > 0 ? (correctCount / totalQuestions) * 100 : 0;

    return {
        user: userId,
        totalWords: total,
        masteredWords: mastered,
        pendingWords: total - mastered,
        totalTests: submittedTestIds.size,
        totalQuestions,
        correctCount,
        accuracyRate: `${acc.toFixed(1)}%`,
        lastTestTime: lastTestTime || null
    };
}

async function addWord(targetUser, wordData) {
    const { Word, Meaning, POS, Context } = wordData;
    if (!Word || !Meaning) {
        throw new Error('单词和释义不能为空');
    }
    const fields = {
        user: targetUser,
        Word: toSimp(Word),
        Meaning: toSimp(Meaning),
        Status: STATUS_PENDING,
        record_time: Date.now()
    };
    if (POS) fields.POS = POS;
    if (Context) fields.Context = toSimp(Context);
    
    await addRecord(WORD_TABLE, fields);
    return { success: true, word: Word };
}

async function getAllUsers() {
    const records = await getRecords(WORD_TABLE);
    const userSet = new Set(records.map(r => getFieldValue(r.fields.user)).filter(u => u));
    return Array.from(userSet).sort();
}

async function getAllStats() {
    const users = await getAllUsers();
    const stats = [];
    for (const user of users) {
        const userStats = await getStats(user);
        stats.push(userStats);
    }
    return stats;
}

async function validateWords(words) {
    const errors = [];
    const multiMeanings = [];
    const { pool, wordIndex } = await getDistractorPool();

    for (const word of words) {
        const lowerWord = word.toLowerCase();
        if (!/^[a-z]+$/.test(lowerWord)) {
            errors.push(word);
            continue;
        }

        let meanings = [];

        // 通过 wordIndex 找到该 word 的所有 record_id
        const recordIds = wordIndex[lowerWord] || [];
        if (recordIds.length > 0) {
            // 已存在：汇总所有 record 的 meaning（多义词场景）
            const allMeanings = recordIds.map(rid => pool[rid].meaning).filter(m => m);
            const splitMeanings = allMeanings
                .flatMap(m => m.split(/[;,]/).map(s => s.trim()).filter(s => s));
            meanings = [...new Set(splitMeanings)];
        } else {
            const def = await fetchWordDefinition(word);
            if (def.meaning && def.meaning.includes(';')) {
                meanings = def.meaning.split(';').map(m => m.trim()).filter(m => m);
            } else if (def.meaning) {
                meanings = [def.meaning];
            }
        }

        if (meanings.length > 1) {
            multiMeanings.push({ word, meanings });
        }
    }
    
    return { errors, multiMeanings };
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

function generateDistractorsWithAI(word, meaning) {
    const prompt = `为单词 ${word} 生成3个含义相近的英文干扰词，返回JSON：{"distractors": ["word1", "word2", "word3"]}`;
    try {
        const escapedPrompt = prompt.replace(/"/g, '\\"');
        const result = execSync(`mmx text chat --message "${escapedPrompt}" --output json`, { encoding: 'utf8', timeout: 20000 });
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
    } catch (e) { }
    return null;
}

async function callMiniMaxAPI(prompt, model = 'MiniMax-M2.7', timeout = 15000) {
    return new Promise((resolve, reject) => {
        if (!MINIMAX_API_KEY) {
            reject(new Error('MINIMAX_API_KEY not set'));
            return;
        }
        const data = JSON.stringify({
            model: model,
            messages: [{ role: 'user', content: prompt }]
        });
        const options = {
            hostname: 'api.minimax.chat',
            path: '/v1/text/chatcompletion_v2',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${MINIMAX_API_KEY}`,
                'Content-Length': Buffer.byteLength(data)
            }
        };
        const req = https.request(options, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                try {
                    const result = JSON.parse(Buffer.concat(chunks).toString());
                    const content = result.choices?.[0]?.message?.content;
                    resolve(content);
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        const timer = setTimeout(() => {
            req.destroy();
            reject(new Error('timeout'));
        }, timeout);
        req.on('close', () => clearTimeout(timer));
        req.write(data);
        req.end();
    });
}

async function callOpenAIAPI(prompt, model = OPENAI_MODEL, timeout = 30000) {
    return new Promise((resolve, reject) => {
        if (!OPENAI_API_KEY) {
            reject(new Error('OPENAI_API_KEY not set'));
            return;
        }
        const data = JSON.stringify({
            model,
            messages: [
                { role: 'system', content: 'You create high-quality English vocabulary quiz content. Return strict JSON only.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.2,
            response_format: { type: 'json_object' }
        });
        const options = {
            hostname: 'api.openai.com',
            path: '/v1/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Length': Buffer.byteLength(data)
            }
        };
        const req = https.request(options, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString();
                try {
                    const result = JSON.parse(raw);
                    const content = result.choices?.[0]?.message?.content;
                    if (!content) {
                        reject(new Error(`OpenAI empty response: ${raw.substring(0, 200)}`));
                        return;
                    }
                    resolve(content);
                } catch (e) {
                    reject(new Error(`OpenAI parse failed: ${e.message}`));
                }
            });
        });
        req.on('error', reject);
        const timer = setTimeout(() => {
            req.destroy();
            reject(new Error('timeout'));
        }, timeout);
        req.on('close', () => clearTimeout(timer));
        req.write(data);
        req.end();
    });
}

async function callDeepSeekAPI(prompt, model = DEEPSEEK_MODEL, timeout = 30000) {
    return new Promise((resolve, reject) => {
        if (!DEEPSEEK_API_KEY) {
            reject(new Error('DEEPSEEK_API_KEY not set'));
            return;
        }
        const data = JSON.stringify({
            model,
            messages: [
                { role: 'system', content: 'You create high-quality English vocabulary quiz content. Return strict JSON only.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.2,
            response_format: { type: 'json_object' },
            thinking: { type: 'disabled' }
        });
        const options = {
            hostname: 'api.deepseek.com',
            path: '/v1/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                'Content-Length': Buffer.byteLength(data)
            }
        };
        const req = https.request(options, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString();
                try {
                    const result = JSON.parse(raw);
                    const content = result.choices?.[0]?.message?.content;
                    if (!content) {
                        reject(new Error(`DeepSeek empty response: ${raw.substring(0, 200)}`));
                        return;
                    }
                    resolve(content);
                } catch (e) {
                    reject(new Error(`DeepSeek parse failed: ${e.message}`));
                }
            });
        });
        req.on('error', reject);
        const timer = setTimeout(() => {
            req.destroy();
            reject(new Error('timeout'));
        }, timeout);
        req.on('close', () => clearTimeout(timer));
        req.write(data);
        req.end();
    });
}

async function callAI(prompt, options = {}) {
    const provider = options.provider || AI_PROVIDER;
    if (provider === 'deepseek') {
        try {
            return await callDeepSeekAPI(prompt, options.model || DEEPSEEK_MODEL, options.timeout || 30000);
        } catch (e) {
            console.log(`DeepSeek 调用失败，尝试其他 fallback: ${e.message}`);
            if (OPENAI_API_KEY) return callOpenAIAPI(prompt, options.model || OPENAI_MODEL, options.timeout || 30000);
            if (MINIMAX_API_KEY) return callMiniMaxAPI(prompt, undefined, options.timeout || 20000);
            throw e;
        }
    }
    if (provider === 'openai') {
        try {
            return await callOpenAIAPI(prompt, options.model || OPENAI_MODEL, options.timeout || 30000);
        } catch (e) {
            console.log(`OpenAI 调用失败，尝试 MiniMax fallback: ${e.message}`);
            if (MINIMAX_API_KEY) return callMiniMaxAPI(prompt, undefined, options.timeout || 20000);
            throw e;
        }
    }
    return callMiniMaxAPI(prompt, undefined, options.timeout || 20000);
}

function parseJsonArrayFromAI(text, key) {
    if (!text) return null;
    try {
        const jsonText = text.match(/\{[\s\S]*\}/)?.[0];
        const parsed = JSON.parse(jsonText || text);
        return Array.isArray(parsed?.[key]) ? parsed[key] : null;
    } catch (e) {
        const match = text.match(new RegExp(`"${key}"\\s*:\\s*\\[(.*?)\\]`, 's'));
        const words = match?.[1]?.match(/"([^"]+)"/g);
        return words ? words.map(w => w.replace(/"/g, '').trim()) : null;
    }
}

function cleanDistractors(word, distractors) {
    const key = String(word || '').toLowerCase();
    const seen = new Set();
    return (distractors || [])
        .map(d => String(d || '').trim().toLowerCase())
        .filter(d => /^[a-z][a-z -]*$/i.test(d))
        .filter(d => d !== key && !getWordForms(key).includes(d))
        .filter(d => {
            if (seen.has(d)) return false;
            seen.add(d);
            return true;
        })
        .slice(0, 3);
}

async function generateQualityContext(word, meaning, pos) {
    const prompt = `Create one natural English sentence for a vocabulary quiz.
Target word: "${word}"
Part of speech: "${pos || 'unknown'}"
Meaning: "${meaning || ''}"
Rules:
1. The sentence must include the exact target word "${word}" once.
2. The sentence must make the meaning of "${word}" inferable from nearby context clues.
3. Include concrete clues, consequences, or details that point to the target meaning.
4. Avoid thin fixed phrases or idioms such as "It works like a charm."
5. Avoid generic sentences like "The word ... is used in context."
6. Keep it under 22 words.
    Return strict JSON only: {"example": "sentence"}`;
    try {
        const result = await callAI(prompt);
        const examples = parseJsonArrayFromAI(result, 'examples');
        const example = examples?.[0] || result?.match(/"example"\s*:\s*"([^"]+)"/)?.[1];
        if (isContextUsableForWord(word, example)) {
            return example.replace(/\s+/g, ' ').trim();
        }
    } catch (e) { }
    return null;
}

async function generateDistractorsWithContext(word, context, meaning, pos, feedback = '') {
    const prompt = `Generate high-quality multiple-choice distractors for an English vocabulary quiz.
Target word: "${word}"
Part of speech: "${pos || 'unknown'}"
Meaning: "${meaning || ''}"
Sentence context: "${context}"
${feedback ? `Rejected previous candidates and reason: ${feedback}` : ''}

Return exactly 3 English words or short phrases.
Each distractor must:
1. Match the target word's part of speech.
2. Be semantically related to the target word or from the same conceptual domain.
3. Be plausible enough to confuse a learner who only knows the broad topic.
4. Be incorrect in this exact sentence context.
5. Not be a synonym, antonym, spelling variant, inflection, or translation of "${word}".
6. Prefer sibling-category alternatives under the same narrow category, separated by the sentence's concrete clues.
7. If a distractor could reasonably answer the same question as "${word}", reject it.
8. Do not use broader/narrower near-equivalents such as taste/preference for "fancy" or hunger/craving for "appetite".
9. Avoid broad-domain but different-category words. For "jeans", other lower-body garments are better than shirts or accessories.
10. Prefer common learner vocabulary (CEFR A1-B1). Avoid obscure or low-frequency words unless the target itself is advanced.

Examples of bad distractors:
- For "appetite", do not use hunger, craving, desire.
- For "in spite of", do not use despite or notwithstanding.
- For "fancy" meaning liking/desire, do not use appetite, taste, preference.
- For "applicant", do not use candidate, aspirant, petitioner.
- For a noun target, do not return adjectives.
- For a verb target, do not return adjectives or nouns.

Return strict JSON only: {"distractors": ["word1", "word2", "word3"]}`;
    try {
        const result = await callAI(prompt);
        const cleaned = cleanDistractors(word, parseJsonArrayFromAI(result, 'distractors'));
        if (cleaned.length >= 3) return cleaned;
    } catch (e) { }
    return null;
}

async function generateSafeDistractorsWithContext(word, context, meaning, pos, feedback = '') {
    const prompt = `Generate safe fallback multiple-choice distractors for an English vocabulary quiz.
Target word: "${word}"
Part of speech: "${pos || 'unknown'}"
Meaning: "${meaning || ''}"
Sentence context: "${context}"
${feedback ? `Rejected previous candidates and reason: ${feedback}` : ''}

Return exactly 3 English words or short phrases.
Priority:
1. Same part of speech as the target.
2. Clearly NOT synonyms, near-synonyms, translations, inflections, or reasonable answers.
3. Same narrow conceptual category as the target whenever possible.
4. Grammatically usable in the sentence if substituted, but ruled out by concrete clues in the context.
5. Prefer sibling-category words over broad-domain words.
6. Do not choose unrelated, opposite, or merely associated words.
7. Prefer common learner vocabulary (CEFR A1-B1); avoid obscure words when simpler same-category words exist.
8. It is acceptable if they are slightly less close than ideal distractors, but they must still feel like comparable choices.

Good fallback style:
- statement: question, instruction, summary
- businessman: teacher, farmer, artist
- though: because, unless, until
- jeans: shorts, skirt, trousers
- hill: mound, ridge, dune
- drawer: shelf, cabinet, cupboard
- paper as a written assignment: essay, report, article
- mobile phone: landline, pager, walkie-talkie
- course as lessons: workshop, class, lecture
- match as a sports contest: race, game, tournament
- belt as a clothing strap: tie, scarf, strap
- concert as a music event: play, lecture, exhibition

Bad examples:
- appetite: do not use hunger, craving, desire, taste, preference.
- fancy: do not use appetite, taste, preference, desire, wish.
- in spite of: do not use despite, notwithstanding, regardless.
- applicant: do not use candidate, aspirant, petitioner.
- jeans: do not use t-shirt, sweater, dress, socks, gloves, scarves, chinos, khakis, corduroys.
- hill: do not use river, forest, lake.
- bottom: do not use strap, zipper, pocket.
- course: do not use program, curriculum, syllabus when the context is ordinary learner lessons.
- match: do not use meeting, ceremony, parade.
- channel: do not use frequency, wavelength, band, station, network.

Return strict JSON only: {"distractors": ["word1", "word2", "word3"]}`;
    try {
        const result = await callAI(prompt);
        const cleaned = cleanDistractors(word, parseJsonArrayFromAI(result, 'distractors'));
        if (cleaned.length >= 3) return cleaned;
    } catch (e) { }
    return null;
}

async function evaluateQuizContent(word, context, meaning, pos, distractors) {
    const prompt = `Evaluate existing English vocabulary quiz content.
Target word: "${word}"
Part of speech: "${pos || 'unknown'}"
Meaning: "${meaning || ''}"
Sentence context: "${context || ''}"
Distractors: ${(distractors || []).join(', ')}

Judge with strict teaching-quality standards:
1. The context must naturally use the target word and provide useful clues for its meaning.
2. The context must not be generic, artificial, or unrelated to the target meaning.
3. Each distractor must match the target word's part of speech.
4. Each distractor must be semantically related to the target word or same conceptual domain.
5. Each distractor must be incorrect in this exact context.
6. Distractors must not be synonyms, antonyms, spelling variants, inflections, translations, or random unrelated words.
7. Distractors must not be near-synonyms, broader/narrower equivalents, or words that could reasonably answer the same question.
8. For abstract noun meanings like liking/desire, reject alternatives such as taste, preference, appetite, desire, wish, craving.

Return strict JSON only:
{
  "context_ok": true,
  "distractors_ok": true,
  "reasons": ["short reason"],
  "bad_distractors": ["word"]
}`;
    try {
        const result = await callAI(prompt);
        const jsonText = result.match(/\{[\s\S]*\}/)?.[0] || result;
        const parsed = JSON.parse(jsonText);
        return {
            contextOk: Boolean(parsed.context_ok),
            distractorsOk: Boolean(parsed.distractors_ok),
            reasons: Array.isArray(parsed.reasons) ? parsed.reasons : [],
            badDistractors: Array.isArray(parsed.bad_distractors) ? parsed.bad_distractors : []
        };
    } catch (e) {
        return null;
    }
}

async function evaluateSafeDistractors(word, context, meaning, pos, distractors) {
    const prompt = `Evaluate fallback distractors for an English vocabulary quiz.
Target word: "${word}"
Part of speech: "${pos || 'unknown'}"
Meaning: "${meaning || ''}"
Sentence context: "${context || ''}"
Distractors: ${(distractors || []).join(', ')}

These are fallback distractors. They do not need to be very semantically close.
They are acceptable only if:
1. They match the target word's part of speech.
2. They are clearly not synonyms, near-synonyms, translations, inflections, or reasonable answers.
3. They belong to the same narrow category or a very close sibling category.
4. They are not random, merely associated, opposite, or from a much broader/different category.
5. They would be clearly wrong in this exact context because of context clues.

Return strict JSON only:
{
  "distractors_ok": true,
  "reasons": ["short reason"],
  "bad_distractors": ["word"]
}`;
    try {
        const result = await callAI(prompt);
        const jsonText = result.match(/\{[\s\S]*\}/)?.[0] || result;
        const parsed = JSON.parse(jsonText);
        return {
            distractorsOk: Boolean(parsed.distractors_ok),
            reasons: Array.isArray(parsed.reasons) ? parsed.reasons : [],
            badDistractors: Array.isArray(parsed.bad_distractors) ? parsed.bad_distractors : []
        };
    } catch (e) {
        return null;
    }
}

async function evaluateAndRepairMeaning(word, meaning, pos, cnMeaning) {
    const prompt = `Evaluate whether an English vocabulary record's meaning matches the target word.
Target word or phrase: "${word}"
Current part of speech: "${pos || 'unknown'}"
Current English meaning: "${meaning || ''}"
Current Chinese meaning: "${cnMeaning || ''}"

Tasks:
1. Decide whether the English meaning correctly matches the most common learner-useful meaning of the target word or phrase.
2. If it is wrong, unrelated, too generic, or clearly belongs to another word, provide a corrected concise English meaning.
3. Provide a corrected part of speech and concise Simplified Chinese meaning.

Return strict JSON only:
{
  "meaning_ok": true,
  "corrected_meaning": "concise English definition",
  "corrected_pos": "noun",
  "corrected_cn_meaning": "中文释义",
  "reason": "short reason"
}`;
    try {
        const result = await callAI(prompt);
        const jsonText = result.match(/\{[\s\S]*\}/)?.[0] || result;
        const parsed = JSON.parse(jsonText);
        return {
            meaningOk: Boolean(parsed.meaning_ok),
            correctedMeaning: String(parsed.corrected_meaning || '').trim(),
            correctedPos: String(parsed.corrected_pos || '').trim(),
            correctedCNMeaning: String(parsed.corrected_cn_meaning || '').trim(),
            reason: String(parsed.reason || '').trim()
        };
    } catch (e) {
        return null;
    }
}

async function evaluateAndRepairSpelling(word, meaning, pos, cnMeaning) {
    const prompt = `Evaluate whether this English vocabulary headword has an obvious spelling typo.
Target word or phrase: "${word}"
Part of speech: "${pos || 'unknown'}"
English meaning: "${meaning || ''}"
Chinese meaning: "${cnMeaning || ''}"

Rules:
1. Only mark spelling_ok=false for clear misspellings or transposed/missing letters, such as "altutide" -> "altitude".
2. Do not change valid British/American variants, proper nouns, phrases, idioms, or learner-useful multi-word expressions.
3. Do not rewrite awkward but valid vocabulary items into a different concept.
4. If unsure, keep spelling_ok=true.

Return strict JSON only:
{
  "spelling_ok": true,
  "corrected_word": "",
  "reason": "short reason"
}`;
    try {
        const result = await callAI(prompt);
        const jsonText = result.match(/\{[\s\S]*\}/)?.[0] || result;
        const parsed = JSON.parse(jsonText);
        return {
            spellingOk: Boolean(parsed.spelling_ok),
            correctedWord: String(parsed.corrected_word || '').trim(),
            reason: String(parsed.reason || '').trim()
        };
    } catch (e) {
        return null;
    }
}

async function generateExampleWithAI(word, meaning) {
    const prompt = `为单词 ${word} 生成一个英文例句，返回JSON：{"example": "例句"}`;
    try {
        const result = await callAI(prompt);
        if (result) {
            const match = result.match(/"example"\s*:\s*"([^"]+)"/);
            if (match) return match[1];
        }
    } catch (e) { }
    return null;
}

async function translateToCN(text) {
    if (!text) return null;
    const prompt = `Translate this English vocabulary definition into concise Simplified Chinese.
Text: "${text}"
Return strict JSON only: {"translation": "中文释义"}`;
    try {
        const result = await callAI(prompt);
        if (result) {
            const jsonText = result.match(/\{[\s\S]*\}/)?.[0] || result;
            try {
                const parsed = JSON.parse(jsonText);
                return parsed.translation?.trim() || null;
            } catch (e) {
                return result.trim();
            }
        }
    } catch (e) { }
    return null;
}

async function fetchWordDefinition(word) {
    try {
        const wordLower = word.toLowerCase();
        const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${wordLower}`;
        const data = await requesthttp(url);
        
        if (data && data[0]) {
            const entry = data[0];
            const meanings = [];
            let pos = 'n.';
            let example = '';
            
            for (const meaning of entry.meanings || []) {
                if (meaning.partOfSpeech) pos = meaning.partOfSpeech;
                for (const def of meaning.definitions || []) {
                    meanings.push(def.definition);
                    if (def.example && !example) {
                        example = def.example.replace(/"/g, '');
                    }
                }
            }
            
            const meaningStr = meanings.slice(0, 3).join('; ');
            
            return {
                meaning: toSimp(meaningStr || word),
                pos: toSimp(pos),
                context: example ? example : '',
                rawContext: example || ''
            };
        }
    } catch (e) { }
    
    try {
        const wordLower = word.toLowerCase();
        const encoded = encodeURIComponent(wordLower);
        const url = `https://api.mymemory.translated.net/get?q=${encoded}&langpair=en|zht`;
        const data = await requesthttp(url);
        
        if (data && data.responseStatus === 200) {
            const translation = data.responseData?.translatedText || '';
            return {
                meaning: toSimp(translation || word),
                pos: toSimp('n.'),
                context: toSimp(`The word "${word}" is used in context.`)
            };
        }
    } catch (e) { }
    
    return {
        meaning: toSimp(word),
        pos: toSimp('n.'),
        context: toSimp(`The word "${word}" is used in context.`)
    };
}

async function addWords(targetUser, words) {
    console.log('addWords 被调用', targetUser, words);
    let count = 0;
    const errors = [];
    
    for (const word of words) {
        try {
            const def = await fetchWordDefinition(word);
            
            let distractors = null;
            let example = isContextUsableForWord(word, def.context) ? def.context : '';
            let cnMeaning = '';

            if (!example) {
                example = await generateQualityContext(word, def.meaning, def.pos) || '';
            }

            if (example) {
                distractors = await generateDistractorsWithContext(word, example, def.meaning, def.pos);
            }

            if (!distractors || distractors.length < 3) {
                const { pool } = await getDistractorPool();
                const lowerWord = word.toLowerCase();
                const allWords = [...new Set(Object.values(pool).map(r => r.word?.toLowerCase()).filter(w => w))];
                const fallback = [];
                while (fallback.length < 3 && allWords.length > 0) {
                    const idx = crypto.randomInt(0, allWords.length);
                    const candidate = allWords[idx];
                    if (candidate !== lowerWord && !fallback.includes(candidate)) {
                        fallback.push(candidate);
                    }
                    allWords.splice(idx, 1);
                }
                if (distractors) {
                    distractors = cleanDistractors(word, [...distractors, ...fallback]).slice(0, 3);
                } else {
                    distractors = fallback;
                }
            }

            cnMeaning = await translateToCN(def.meaning);
            if (!cnMeaning) {
                cnMeaning = '';
            }
            
            const wordFields = {
                user: targetUser,
                Word: toSimp(word),
                Meaning: toSimp(def.meaning),
                CN_Meaning: toSimp(cnMeaning || ''),
                Distractors: Array.isArray(distractors) ? distractors.join(',') : '',
                Status: STATUS_PENDING,
                record_time: Date.now()
            };
            if (def.pos) wordFields.POS = def.pos;
            if (example) wordFields.Context = toSimp(example);
            
            await addRecord(WORD_TABLE, wordFields);
            count++;
            console.log(`成功写入: ${word}, 例句质量=${isContextUsableForWord(word, example)}, 干扰词: ${(distractors || []).join(', ')}, 中文: ${cnMeaning?.substring(0, 15)}...`);
        } catch (e) {
            console.log(`写入失败 ${word}: ${e.message}`);
            errors.push(`${word}: ${e.message}`);
        }
        
        await new Promise(r => setTimeout(r, 1000));
    }
    
    if (errors.length > 0) {
        return { count, errors, error: `部分单词录入失败: ${errors.join('; ')}` };
    }
    
    return { count, success: true };
}

async function updateMultiDefinition(targetUser, words) {
    console.log('updateMultiDefinition called:', targetUser, words);
    const records = await getRecords(WORD_TABLE);
    console.log('总记录数:', records.length);
    const userRecords = records.filter(r => r.fields.user === targetUser && words.includes(r.fields.Word));
    console.log('匹配记录:', userRecords.length);
    for (const record of userRecords) {
        console.log('更新记录:', record.record_id, record.fields.Word);
        await updateRecord(WORD_TABLE, record.record_id, { multi_definition: ['opthB7bmkB'] });
    }
}

async function getWord(userId, word) {
    const records = await getRecords(WORD_TABLE);
    const record = records.find(r => r.fields.user === userId && r.fields.Word?.toLowerCase() === word.toLowerCase());
    if (!record) return null;
    return {
        word: record.fields.Word,
        meaning: record.fields.Meaning || '',
        cnMeaning: record.fields.CN_Meaning || '',
        pos: record.fields.POS || '',
        context: record.fields.Context || '',
        distractors: record.fields.Distractors || '',
        status: normalizeStatus(record.fields.Status),
        qualityFlags: record.fields.Quality_Flags || '',
        qualityNote: record.fields.Quality_Note || '',
        record_id: record.record_id
    };
}

function mapWordRecord(record) {
    return {
        word: record.fields.Word || '',
        meaning: record.fields.Meaning || '',
        cnMeaning: record.fields.CN_Meaning || '',
        pos: record.fields.POS || '',
        context: record.fields.Context || '',
        distractors: record.fields.Distractors || '',
        status: normalizeStatus(record.fields.Status),
        qualityFlags: record.fields.Quality_Flags || '',
        qualityNote: record.fields.Quality_Note || '',
        user: record.fields.user || '',
        record_id: record.record_id
    };
}

async function getWordByRecordId(recordId) {
    const records = await getRecords(WORD_TABLE);
    const record = records.find(r => r.record_id === recordId);
    return record ? mapWordRecord(record) : null;
}

async function updateWord(userId, word, fields) {
    const records = await getRecords(WORD_TABLE);
    const record = fields.recordId
        ? records.find(r => r.record_id === fields.recordId && (!userId || r.fields.user === userId))
        : records.find(r => r.fields.user === userId && r.fields.Word?.toLowerCase() === word.toLowerCase());
    if (!record) return { error: '单词不存在' };
    const updateFields = {};
    if (fields.word !== undefined) updateFields.Word = fields.word;
    if (fields.meaning !== undefined) updateFields.Meaning = fields.meaning;
    if (fields.cnMeaning !== undefined) updateFields.CN_Meaning = fields.cnMeaning;
    if (fields.pos !== undefined) updateFields.POS = fields.pos;
    if (fields.context !== undefined) updateFields.Context = fields.context;
    if (fields.distractors !== undefined) updateFields.Distractors = fields.distractors;
    if (fields.status !== undefined) updateFields.Status = normalizeStatus(fields.status);
    if (fields.qualityFlags !== undefined) updateFields.Quality_Flags = fields.qualityFlags;
    if (fields.qualityNote !== undefined) updateFields.Quality_Note = fields.qualityNote;
    await updateRecord(WORD_TABLE, record.record_id, updateFields);
    return { success: true };
}

async function getReviewWords(userId) {
    const records = await getRecords(WORD_TABLE);
    return records
        .filter(r => !userId || r.fields.user === userId)
        .filter(r => getFieldValue(r.fields.Quality_Flags).trim() || getFieldValue(r.fields.Quality_Note).trim())
        .filter(r => !isMasteredStatus(r.fields.Status))
        .map(mapWordRecord);
}

async function markWordForReview(recordId, flags, note) {
    await updateRecord(WORD_TABLE, recordId, {
        Quality_Flags: flags || 'manual_review',
        Quality_Note: note || ''
    });
    return { success: true };
}

async function clearWordReview(recordId) {
    await updateRecord(WORD_TABLE, recordId, {
        Quality_Flags: '',
        Quality_Note: ''
    });
    return { success: true };
}

async function deleteWord(userId, word) {
    const records = await getRecords(WORD_TABLE);
    const record = records.find(r => r.fields.user === userId && r.fields.Word?.toLowerCase() === word.toLowerCase());
    if (!record) return { error: '单词不存在' };
    const token = await getToken();
    await new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'open.feishu.cn',
            path: `/open-apis/bitable/v1/apps/${WORD_TABLE.appToken}/tables/${WORD_TABLE.tableId}/records/${record.record_id}`,
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
        }, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
        });
        req.on('error', reject);
        req.end();
    });
    return { success: true };
}

module.exports = {
    generateQuiz,
    submitAnswers,
    getStats,
    addWord,
    getAllUsers,
    getAllStats,
    validateWords,
    addWords,
    updateMultiDefinition,
    getWord,
    updateWord,
    deleteWord,
    getWordByRecordId,
    getReviewWords,
    markWordForReview,
    clearWordReview,
    searchRecords,
    getRecords,
    updateRecord,
    addRecord,
    getToken,
    generateQualityContext,
    generateDistractorsWithContext,
    generateSafeDistractorsWithContext,
    evaluateQuizContent,
    evaluateSafeDistractors,
    evaluateAndRepairMeaning,
    evaluateAndRepairSpelling,
    isContextUsableForWord,
    cleanDistractors
};
