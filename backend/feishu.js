const https = require('https');
const crypto = require('crypto');

const APP_ID = process.env.FEISHU_APP_ID || 'cli_a97e125f0ab89cb5';
const APP_SECRET = process.env.FEISHU_APP_SECRET || 'pppKJAybbiNqKIDB9hlvshTnXGPg7OVH';
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;

const WORD_TABLE = { appToken: 'BWhIb2hjaaDQHdsNhWRcPluBncg', tableId: 'tblyMh69dws6ty6n' };
const DIST_TABLE = { appToken: 'GskxbMxMgaDPFRsgqS4cdWvdndb', tableId: 'tbl3EgurgOTXdM3V' };
const TEST_TABLE = { appToken: 'FyyPb1urFacfn7sGSjpca2UwnHe', tableId: 'tbl6Nx0kJWjr7qQZ' };
const STATS_TABLE = { appToken: 'Mbh7bK7Jrah7XMsV9lhceE7cnyh', tableId: 'tblQBYKzcQuz8sSq' };
const STATUS_PENDING = 'Pending';
const STATUS_MASTERED = 'Mastered';
const STATUS_PENDING_LEGACY = 'optXjbXS2F';
const STATUS_MASTERED_LEGACY = 'optF5P0W3O';

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

function normalizeStatus(status) {
    const value = getFieldValue(status).trim();
    const lower = value.toLowerCase();
    if (lower === STATUS_MASTERED.toLowerCase() || value === STATUS_MASTERED_LEGACY || value === '已掌握') return STATUS_MASTERED;
    if (lower === STATUS_PENDING.toLowerCase() || value === STATUS_PENDING_LEGACY || value === '待复习') return STATUS_PENDING;
    return STATUS_PENDING;
}

function isMasteredStatus(status) {
    return normalizeStatus(status) === STATUS_MASTERED;
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
    const pool = {};
    const wordIndex = {};
    // 词库统计
    let stats = { total: 0, hasCN: 0, hasDist3: 0, canType3: 0 };
    
    for (const r of records) {
        const w = getFieldValue(r.fields.Word).toLowerCase();
        if (w) {
            const cn = getFieldValue(r.fields.CN_Meaning).trim();
            const dists = getFieldValue(r.fields.Distractors).split(',').map(s => s.trim()).filter(s => s);
            const context = getFieldValue(r.fields.Context);
            
            pool[r.record_id] = {
                word: getFieldValue(r.fields.Word),
                pos: getFieldValue(r.fields.POS),
                meaning: getFieldValue(r.fields.Meaning),
                CN_Meaning: cn,
                distractors: dists,
                context: context,
                rawContext: context,
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
        .filter(r => getFieldValue(r.fields.user) === userId && !isMasteredStatus(r.fields.Status))
        .map(r => ({
            record_id: r.record_id,
            word: getFieldValue(r.fields.Word),
            meaning: getFieldValue(r.fields.Meaning),
            pos: getFieldValue(r.fields.POS),
            cn_meaning: getFieldValue(r.fields.CN_Meaning),
            context: getFieldValue(r.fields.Context),
            distractors: getFieldValue(r.fields.Distractors),
            multi_definition: r.fields.multi_definition
        }));
}

function isContextValid(ctx) {
    if (!ctx || ctx === '___' || ctx.includes('[object Object]')) return false;
    return true;
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
    if (/^the word ".+" is used in context\.$/i.test(ctx.trim())) return false;
    const forms = getWordForms(word).map(escapeRegExp).join('|');
    if (!new RegExp(`\\b(${forms})\\b`, 'i').test(text)) return false;
    const lower = text.toLowerCase();
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
    const { pool } = await getDistractorPool();
    const pending = await getPendingWords(userId);

    const valid = pending.filter(r => {
        const info = pool[r.record_id];
        return info && (info.distractors || []).filter(d => d).length >= 3;
    });

    if (valid.length < 2) {
        return { error: `可用单词不足，当前${valid.length}个，需要至少2个` };
    }

    const wordGroup = {};
    for (const rec of valid) {
        const w = rec.word.toLowerCase();
        if (!wordGroup[w]) wordGroup[w] = [];
        wordGroup[w].push(rec);
    }

    const isMultiDef = (rec) => {
        const m = rec.multi_definition;
        return m === 'opthB7bmkB' || (Array.isArray(m) && m.includes('opthB7bmkB'));
    };

    const multiDefGroups = Object.entries(wordGroup)
        .filter(([w, recs]) => recs.length >= 2 && recs.length <= 10 && isMultiDef(recs[0]))
        .sort((a, b) => a[1].length - b[1].length);

    const questions = [];
    const usedRecordIds = new Set();
    const testId = crypto.randomUUID().split('-')[0];
    const letters = ['A', 'B', 'C', 'D'];

    for (const [pickedWord, pickedRecs] of secureRandom(multiDefGroups.slice(0, 4), Math.min(multiDefGroups.length, 4))) {
        const multiQuestions = [];
        for (const rec of pickedRecs) {
            const info = pool[rec.record_id];
            const cn = info.CN_Meaning?.trim();
            const hasGoodCN = cn && cn.length > 0 && !cn.includes('请提供要翻译的文本');
            const qType = hasGoodCN ? 3 : (isContextUsableForWord(info.word, info.context) ? 1 : 2);
            const q = buildQuizQuestion(rec.record_id, info, qType, testId, letters);
            if (q) multiQuestions.push(q);
        }
        if (multiQuestions.length === pickedRecs.length) {
            console.log(`选中多义词: ${pickedWord}, 释义数=${pickedRecs.length}`);
            for (const q of multiQuestions) {
                questions.push(q);
                usedRecordIds.add(q.record_id);
            }
            break;
        }
    }

    const typeSlots = secureRandom([...Array(6).fill(1), ...Array(2).fill(2), ...Array(2).fill(3)], 10);
    const remaining = valid.filter(r => !usedRecordIds.has(r.record_id));
    for (const slot of typeSlots) {
        if (questions.length >= 10) break;
        const candidates = remaining.filter(r => {
            if (usedRecordIds.has(r.record_id)) return false;
            const w = r.word.toLowerCase();
            if (questions.some(q => q.word.toLowerCase() === w)) return false;
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
        const q = buildQuizQuestion(rec.record_id, pool[rec.record_id], slot, testId, letters);
        if (q) {
            questions.push(q);
            usedRecordIds.add(rec.record_id);
        }
    }

    console.log(`生成题目: 总=${questions.length}, type1=${questions.filter(q=>q.type===1).length}, type2=${questions.filter(q=>q.type===2).length}, type3=${questions.filter(q=>q.type===3).length}`);

    const token = await getToken();
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
    const finalOpts = secureRandom([key, ...secureRandom(specificDistrs, 3)], 4);
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
        q = { type: 3, word: key, context: info.CN_Meaning || '', options: finalOpts.map((o, i) => `${letters[i]}. ${o}`), answer: letters[correctIdx] };
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
    const wordMap = {};

    const letters = ['A', 'B', 'C', 'D'];
    for (let i = 0; i < Math.min(sortedRecords.length, answers.length); i++) {
        const rec = sortedRecords[i];
        const yourAnswerIdx = answers[i];
        const yourAnswer = yourAnswerIdx !== null && yourAnswerIdx !== undefined ? letters[yourAnswerIdx] : null;
        const correctAnswer = rec.fields.correct_answer;
        console.log(`第${i+1}题 correctAnswer:`, JSON.stringify(correctAnswer));
        const answerStr = getFieldValue(correctAnswer);
        const isCorrect = yourAnswer === answerStr;
        if (isCorrect) correct++;

        await updateRecord(TEST_TABLE, rec.record_id, {
            your_answer: yourAnswer || '',
            is_correct: isCorrect ? ['optHGT7gYf'] : ['optbe4bsQk']
        });

        const word = getFieldValue(rec.fields.word).toLowerCase();
        const recordId = getFieldValue(rec.fields.record_id);
        if (!wordMap[word]) {
            wordMap[word] = { correct: 0, total: 0, recordIds: [], wrongRecordIds: [], hasRecordIds: false };
        }
        wordMap[word].total++;
        if (isCorrect) wordMap[word].correct++;
        if (recordId) {
            wordMap[word].hasRecordIds = true;
            wordMap[word].recordIds.push(recordId);
            if (!isCorrect) wordMap[word].wrongRecordIds.push(recordId);
        }

        results.push({ q: i + 1, word, recordId, your: yourAnswer, answer: answerStr, correct: isCorrect });
    }

    const masteredWords = [];
    for (const [word, stats] of Object.entries(wordMap)) {
        if (stats.hasRecordIds) {
            if (stats.correct >= stats.total) {
                masteredWords.push(word);
                for (const recordId of stats.recordIds) {
                    await updateRecord(WORD_TABLE, recordId, { Status: STATUS_MASTERED });
                }
            } else {
                const current = await getRecords(WORD_TABLE);
                for (const recordId of stats.wrongRecordIds) {
                    const rec = current.find(r => r.record_id === recordId);
                    const errCount = Number(rec?.fields?.Error_Count || 0) + 1;
                    await updateRecord(WORD_TABLE, recordId, { Error_Count: errCount });
                }
            }
        } else if (stats.correct >= stats.total) {
            masteredWords.push(word);
            const wordRecords = (await getRecords(WORD_TABLE)).filter(r => getFieldValue(r.fields.user) === userId && getFieldValue(r.fields.Word).toLowerCase() === word);
            for (const wr of wordRecords) {
                await updateRecord(WORD_TABLE, wr.record_id, { Status: STATUS_MASTERED });
            }
        }
    }

    const wordRecords = (await getRecords(WORD_TABLE)).filter(r => getFieldValue(r.fields.user) === userId);
    const total = wordRecords.length;
    const mastered = wordRecords.filter(r => isMasteredStatus(r.fields.Status)).length;

    const statsRecords = await getRecords(STATS_TABLE);
    const userRecord = statsRecords.find(r => getFieldValue(r.fields.user) === userId);

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
        Status: 'Pending',
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
    const distPool = await getDistractorPool();
    
    for (const word of words) {
        const lowerWord = word.toLowerCase();
        if (!/^[a-z]+$/.test(lowerWord)) {
            errors.push(word);
            continue;
        }
        
        let meanings = [];
        
        const exists = distPool[lowerWord];
        if (exists && exists.meaning) {
            meanings = exists.meaning.split(',').map(m => m.trim()).filter(m => m);
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

async function generateDistractorsWithContext(word, context) {
    const prompt = `Given the sentence: "${context}"
Target word: "${word}"
Generate 3 wrong distractors that:
1. Are grammatically correct in this sentence
2. Make the sentence sound natural but meaning wrong
3. Are NOT synonyms of "${word}"
Return JSON: {"distractors": ["word1", "word2", "word3"]}`;
    try {
        const result = await callMiniMaxAPI(prompt);
        if (result) {
            const match = result.match(/"distractors"\s*:\s*\[(.*?)\]/s);
            if (match) {
                const words = match[1].match(/"([^"]+)"/g);
                if (words && words.length >= 3) {
                    return words.map(w => w.replace(/"/g, '').trim());
                }
            }
        }
    } catch (e) { }
    return null;
}

async function generateDistractorsWithCollocation(word, context) {
    const prompt = `Sentence: "${context}"
Word: "${word}"
Generate 3 WRONG words by analyzing collocation keywords in the sentence.
The wrong words should create semantic confusion when substituted.
Return JSON: {"distractors": ["wrong1", "wrong2", "wrong3"]}`;
    try {
        const result = await callMiniMaxAPI(prompt);
        if (result) {
            const match = result.match(/"distractors"\s*:\s*\[(.*?)\]/s);
            if (match) {
                const words = match[1].match(/"([^"]+)"/g);
                if (words && words.length >= 3) {
                    return words.map(w => w.replace(/"/g, '').trim());
                }
            }
        }
    } catch (e) { }
    return null;
}

async function generateExampleWithAI(word, meaning) {
    const prompt = `Create one natural English vocabulary quiz sentence.
Target word: "${word}"
Meaning: "${meaning || ''}"
Rules:
1. Include the exact target word once.
2. Add concrete context clues so a learner can infer the meaning.
3. Do not use thin idioms or fixed phrases such as "It works like a charm".
4. Avoid generic sentences.
5. Keep it under 22 words.
Return JSON only: {"example": "sentence"}`;
    try {
        const result = await callMiniMaxAPI(prompt);
        if (result) {
            const match = result.match(/"example"\s*:\s*"([^"]+)"/);
            if (match && isContextUsableForWord(word, match[1])) return match[1];
        }
    } catch (e) { }
    return null;
}

async function translateToCN(text) {
    if (!text) return null;
    const prompt = `翻译成中文（只返回翻译结果）：${text}`;
    try {
        const result = await callMiniMaxAPI(prompt);
        if (result) return result.trim();
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
                example = await generateExampleWithAI(word, def.meaning) || '';
            }

            if (example) {
                distractors = await generateDistractorsWithContext(word, example);
            }

            if (!distractors || distractors.length < 3) {
                if (example) {
                    distractors = await generateDistractorsWithCollocation(word, example);
                }
            }

            if (!distractors || distractors.length < 3) {
                const { pool: distPool } = await getDistractorPool();
                const lowerWord = word.toLowerCase();
                const allWords = [...new Set(Object.values(distPool).map(r => r.word?.toLowerCase()).filter(Boolean))];
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
                    distractors = [...distractors, ...fallback].slice(0, 3);
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
                Meaning: def.meaning,
                CN_Meaning: cnMeaning || '',
                Distractors: Array.isArray(distractors) ? distractors.join(',') : '',
                Status: 'Pending',
                record_time: Date.now()
            };
            if (def.pos) wordFields.POS = def.pos;
            if (example) wordFields.Context = example;
            
            await addRecord(WORD_TABLE, wordFields);
            count++;
            console.log(`成功写入: ${word}, 干扰词: ${distractors.join(', ')}, 中文: ${cnMeaning?.substring(0, 15)}...`);
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
        status: record.fields.Status || 'Pending',
        record_id: record.record_id
    };
}

async function updateWord(userId, word, fields) {
    const records = await getRecords(WORD_TABLE);
    const record = records.find(r => r.fields.user === userId && r.fields.Word?.toLowerCase() === word.toLowerCase());
    if (!record) return { error: '单词不存在' };
    const updateFields = {};
    if (fields.meaning !== undefined) updateFields.Meaning = fields.meaning;
    if (fields.cnMeaning !== undefined) updateFields.CN_Meaning = fields.cnMeaning;
    if (fields.pos !== undefined) updateFields.POS = fields.pos;
    if (fields.context !== undefined) updateFields.Context = fields.context;
    if (fields.distractors !== undefined) updateFields.Distractors = fields.distractors;
    if (fields.status !== undefined) updateFields.Status = fields.status;
    await updateRecord(WORD_TABLE, record.record_id, updateFields);
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

module.exports = { generateQuiz, submitAnswers, getStats, addWord, getAllUsers, getAllStats, validateWords, addWords, updateMultiDefinition, getWord, updateWord, deleteWord, searchRecords, getRecords, updateRecord, getToken };
