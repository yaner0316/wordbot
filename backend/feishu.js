const https = require('https');
const crypto = require('crypto');
const {
  APP_ID,
  APP_SECRET,
  MINIMAX_API_KEY,
  WORD_TABLE,
  DIST_TABLE,
  TEST_TABLE,
  STATS_TABLE,
  OPTION_IDS,
  STATUS,
} = require('./config');

// 飞书字段选项快捷引用
const { STATUS_MASTERED, STATUS_PENDING } = STATUS;
const {
  STATUS_MASTERED: OPT_STATUS_MASTERED,
  STATUS_PENDING: OPT_STATUS_PENDING,
  IS_CORRECT: OPT_IS_CORRECT,
  IS_WRONG: OPT_IS_WRONG,
  MULTI_DEF_YES: OPT_MULTI_DEF_YES,
} = OPTION_IDS;

// 辅助函数：选项首字母大写


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
    if (lower === STATUS_MASTERED.toLowerCase() || value === OPT_STATUS_MASTERED || value === '已掌握') return STATUS_MASTERED;
    if (lower === STATUS_PENDING.toLowerCase() || value === OPT_STATUS_PENDING || value === '待复习') return STATUS_PENDING;
    return STATUS_PENDING;
}

function isMasteredStatus(status) {
    return normalizeStatus(status) === STATUS_MASTERED;
}

function isCorrectField(value) {
    const normalized = getFieldValue(value).trim();
    return normalized === OPT_IS_CORRECT || normalized === '正确' || normalized.toLowerCase() === 'true';
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
    let prevPageToken = null;
    const body = { page_size: 500 };
    if (filter) body.filter = filter;
    if (sort) body.sort = sort;

    const startTime = Date.now();
    let pageCount = 0;
    do {
        pageCount++;
        if (pageToken) body.page_token = pageToken;
        if (Date.now() - startTime > timeout) {
            console.error(`searchRecords timeout after ${Date.now() - startTime}ms, pages=${pageCount}, records=${allRecords.length}`);
            throw new Error('search timeout');
        }
        const res = await request('POST', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records/search`, body, token);
        const items = res.data?.items || [];
        allRecords.push(...items);
        prevPageToken = pageToken;
        pageToken = res.data?.page_token;
        // 防止 page_token 循环导致无限请求
        if (pageToken && pageToken === prevPageToken) {
            console.warn(`searchRecords: page_token 重复，停止分页 (table=${table.tableId})`);
            break;
        }
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

async function addRecords(table, fieldList) {
    const token = await getToken();
    const records = fieldList.map(fields => ({ fields }));
    console.log(`批量写入表: ${table.appToken} ${table.tableId}, 数量=${records.length}`);
    const res = await request('POST', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records/batch_create`, { records }, token);
    console.log('batchCreate返回:', JSON.stringify(res).substring(0, 200));
    if (res.code !== 0) {
        throw new Error(`批量添加记录失败: ${res.msg || res.code}`);
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
    const pool = [...arr];
    for (let i = pool.length - 1; i > 0; i--) {
        const j = crypto.randomInt(0, i + 1);
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, Math.min(count, pool.length));
}

async function getDistractorPool(records = null) {
    records = records || await getRecords(WORD_TABLE);
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

async function getPendingWords(userId, records = null) {
    records = records || await getRecords(WORD_TABLE);
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
            multi_definition: r.fields.multi_definition,
            quality_flags: getFieldValue(r.fields.Quality_Flags),
            level: getFieldValue(r.fields.Level)
        }));
}

async function getRecentQuizFootprint(userId, testCount = 4) {
    const records = await searchRecords(
        TEST_TABLE,
        { conjunction: "and", conditions: [{ field_name: "user", operator: "is", value: [userId] }] },
        [{ desc: true, field_name: "test_time" }],
        30000
    );
    const recentTestIds = [];
    const seenTests = new Set();
    for (const record of records) {
        const testId = getFieldValue(record.fields.test_id);
        if (!testId || seenTests.has(testId)) continue;
        seenTests.add(testId);
        recentTestIds.push(testId);
        if (recentTestIds.length >= testCount) break;
    }

    const recentSet = new Set(recentTestIds);
    const recordIds = new Set();
    const words = new Set();
    for (const record of records) {
        const testId = getFieldValue(record.fields.test_id);
        if (!recentSet.has(testId)) continue;
        const recordId = getFieldValue(record.fields.record_id);
        const word = getFieldValue(record.fields.word).toLowerCase();
        if (recordId) recordIds.add(recordId);
        if (word) words.add(word);
    }
    return { recordIds, words };
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

async function generateQuiz(userId, level = null) {
    const wordRecords = await getRecords(WORD_TABLE);
    const { pool } = await getDistractorPool(wordRecords);
    const pending = await getPendingWords(userId, wordRecords);

    const recent = await getRecentQuizFootprint(userId).catch(e => {
        console.log(`recent quiz footprint failed: ${e.message}`);
        return { recordIds: new Set(), words: new Set() };
    });

    const validBase = pending.filter(r => {
        const info = pool[r.record_id];
        return info && (info.distractors || []).filter(d => d).length >= 3;
    });
    const reviewClean = validBase.filter(r => !r.quality_flags);
    const valid = reviewClean.length >= 2 ? reviewClean : validBase;

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
        return m === OPT_MULTI_DEF_YES || (Array.isArray(m) && m.includes(OPT_MULTI_DEF_YES));
    };

    const multiDefGroups = Object.entries(wordGroup)
        .filter(([w, recs]) => recs.length >= 2 && recs.length <= 10 && isMultiDef(recs[0]));
    const freshMultiDefGroups = multiDefGroups.filter(([w, recs]) =>
        !recent.words.has(w) && recs.every(r => !recent.recordIds.has(r.record_id))
    );

    let questions = [];
    const usedRecordIds = new Set();
    const testId = crypto.randomUUID().split('-')[0];
    const letters = ['A', 'B', 'C', 'D'];

    const multiCandidates = freshMultiDefGroups.length > 0 ? freshMultiDefGroups : multiDefGroups;
    for (const [pickedWord, pickedRecs] of secureRandom(multiCandidates, multiCandidates.length)) {
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
            if (slot === 2) return info.meaning?.trim();
            if (slot === 3) {
                const cn = info.CN_Meaning?.trim();
                return cn && cn.length > 0 && !cn.includes('请提供要翻译的文本');
            }
            return false;
        });
        if (candidates.length === 0) continue;
        const freshCandidates = candidates.filter(r =>
            !recent.recordIds.has(r.record_id) && !recent.words.has(r.word.toLowerCase())
        );
        const rec = secureRandom(freshCandidates.length > 0 ? freshCandidates : candidates, 1)[0];
        const q = buildQuizQuestion(rec.record_id, pool[rec.record_id], slot, testId, letters);
        if (q) {
            questions.push(q);
            usedRecordIds.add(rec.record_id);
        }
    }

    console.log(`生成题目: 总=${questions.length}, type1=${questions.filter(q=>q.type===1).length}, type2=${questions.filter(q=>q.type===2).length}, type3=${questions.filter(q=>q.type===3).length}`);

    // AI 审核：剔除有歧义的题目
    if (MINIMAX_API_KEY && questions.length > 0) {
        try {
            const validated = await validateAndFixQuiz(questions, pool, testId, letters);
            questions = validated.filter(q => q !== null);
        } catch (e) {
            console.error('AI审核整体失败:', e.message);
        }
        console.log(`AI审核后: ${questions.length} 题`);
    }

    // 按难度等级改写题干
    if (level && MINIMAX_API_KEY && questions.length > 0) {
        try {
            await adaptContextsByLevel(questions, level);
            console.log(`题干已适配难度: ${level}`);
        } catch (e) {
            console.error(`题干适配失败: ${e.message}`);
        }
    }

    const randomizedQuestions = secureRandom(questions, questions.length);
    const baseTestTime = Date.now();
    await addRecords(TEST_TABLE, randomizedQuestions.map((q, index) => ({
            user: userId,
            test_id: testId,
            record_id: q.record_id,
            word: q.word,
            question_type: q.type,
            correct_answer: q.answer,
            options: JSON.stringify(q.options),
            test_time: baseTestTime + index
    })));

    return {
        testId,
        questions: randomizedQuestions.map(({ testId: _, record_id: __, ...q }) => q)
    };
}

// AI 审核：检查并修复有歧义的题目
async function validateAndFixQuiz(questions, pool, testId, letters) {
    const maxRounds = 2;
    let currentQuestions = [...questions];

    for (let round = 0; round < maxRounds; round++) {
        const ambiguousIdx = await checkQuizAmbiguity(currentQuestions);
        if (ambiguousIdx.length === 0) break;
        console.log(`AI审核第${round+1}轮: 发现${ambiguousIdx.length}道歧义题`);

        for (const idx of ambiguousIdx) {
            const q = currentQuestions[idx];
            const info = pool[q.record_id];
            if (!info) continue;

            // 请求 AI 生成更好的干扰词（明显错误的那种）
            const betterDistrs = await generateBetterDistractors(q, info);
            if (betterDistrs && betterDistrs.length >= 3) {
                const rebuilt = buildQuizQuestion(q.record_id, {
                    ...info,
                    distractors: betterDistrs
                }, q.type, testId, letters);
                if (rebuilt) currentQuestions[idx] = rebuilt;
            }
        }
    }
    return currentQuestions;
}

// 用 AI 检查哪些题有多个正确选项（并行检查）
async function checkQuizAmbiguity(questions) {
    const batchSize = 5;

    // 分批并行检查
    const checks = [];
    for (let offset = 0; offset < questions.length; offset += batchSize) {
        const batch = questions.slice(offset, offset + batchSize);
        const quizText = batch.map((q, i) =>
            `Q${offset + i + 1}: ${q.context}  Opts: ${q.options.join(' ')}`
        ).join('\n');

        checks.push((async () => {
            try {
                const r = await callMiniMaxAPI(
                    `Check each: if >1 option fits, list Q numbers. Return numbers only, comma-separated. None->empty.\n\n${quizText}`,
                    'MiniMax-M2.7', 60000
                );
                if (!r) return [];
                const nums = r.match(/\d+/g);
                return nums ? nums.map(Number) : [];
            } catch {
                return [];
            }
        })());
    }

    const results = await Promise.all(checks);
    const ambiguous = [...new Set(results.flat())];
    // convert 1-based to 0-based, filter valid
    return ambiguous.filter(i => i >= 1 && i <= questions.length).map(i => i - 1);
}

// 为歧义题生成明显错误的干扰词
/**
 * 按难度等级改写题干语境
 */
async function adaptContextsByLevel(questions, level) {
    if (!level || level === '全部') return;
    const levelMap = {
        '小学': 'elementary school level (use very simple daily words, 6-8 year old vocabulary)',
        '中学': 'middle school level (common vocabulary, straightforward sentences, 12-15 year old)',
        '高中': 'high school level (moderately complex vocabulary and sentence structures)',
        'CET4_6_TOEFL': 'college/TOEFL level (academic vocabulary, complex sentence structures)'
    };
    const desc = levelMap[level];
    if (!desc) return;

    // 所有题（type1和type2）合并到一个prompt一次调用
    const toAdapt = questions.filter(q => q.type === 1 || q.type === 2);
    if (toAdapt.length === 0) return;

    const prompt = toAdapt.map((q, i) => {
        if (q.type === 1) return `Q${i + 1} [Type1 fill-in-blank]:\nWord: "${q.word}"\nOriginal: "${q.context}"\nOptions: ${q.options.join(', ')}\n---`;
        return `Q${i + 1} [Type2 definition]:\nWord: "${q.word}"\nOriginal definition: "${q.context}"\nOptions: ${q.options.join(', ')}\n---`;
    }).join('\n') + `\n\nRewrite ALL ${toAdapt.length} questions at ${desc}.
- For Type1: rewrite the context sentence (keep _____ blank and word meaning the same, but use level-appropriate vocabulary)
- For Type2: rewrite the definition/explanation with level-appropriate vocabulary

Return JSON ONLY: {"rewrites": [{"index":1,"text":"rewritten version with _____ if type1"},{"index":2,"text":"..."}]}`;

    try {
        const r = await callMiniMaxAPI(prompt, 'MiniMax-M2.7', 60000);
        if (!r) { console.error('Level context: empty response'); return; }
        const m = r.match(/\{[\s\S]*\}/);
        if (!m) { console.error('Level context: no JSON'); return; }
        const j = JSON.parse(m[0]);
        if (!j.rewrites) { console.error('Level context: no rewrites field'); return; }
        for (const c of j.rewrites) {
            const idx = c.index - 1;
            if (idx >= 0 && idx < toAdapt.length && c.text && c.text.length > 3) {
                toAdapt[idx].context = c.text.trim();
            }
        }
    } catch (e) { console.error('Level context failed:', e.message); }
}

async function generateBetterDistractors(q, info) {
    const prompt = q.type === 1
        ? `Context: "${q.context}"
Correct word: "${info.word}"
The current wrong options also fit the blank, making the question ambiguous.
Generate 3 new wrong options that are COMPLETELY WRONG when put in this blank:
- Different meaning
- Different part of speech
- Obviously incorrect in context
Return JSON: {"distractors": ["word1", "word2", "word3"]}`
        : `Target: "${info.word}"
Meaning: "${info.meaning || q.context}"
Current wrong options are too close to the correct answer.
Generate 3 clearly different wrong options.
Return JSON: {"distractors": ["option1", "option2", "option3"]}`;

    try {
        const result = await callMiniMaxAPI(prompt, 'MiniMax-M2.7', 15000);
        if (!result) return null;
        const match = result.match(/"distractors"\s*:\s*\[(.*?)\]/s);
        if (!match) return null;
        const words = match[1].match(/"([^"]+)"/g);
        if (!words || words.length < 3) return null;
        return words.map(w => w.replace(/"/g, '').trim()).slice(0, 3);
    } catch (e) {
        return null;
    }
}

// 将 blank 前的 "a _____" / "an _____" 统一改为 "a(n) _____"
function normalizeArticleContext(context) {
    if (!context) return { text: context, normalized: false };
    let result = context;
    let normalized = false;
    // 替换 "an _____" 或 "a _____" → "a(n) _____"
    if (/\ban\s+_____/i.test(result)) {
        result = result.replace(/\ban\s+_____/gi, 'a(n) _____');
        normalized = true;
    } else if (/\ba\s+_____/i.test(result)) {
        result = result.replace(/\ba\s+_____/gi, 'a(n) _____');
        normalized = true;
    }
    return { text: result, normalized };
}

function buildQuizQuestion(recordId, info, qType, testId, letters) {
    const key = info.word.toLowerCase();
    const specificDistrs = (info.distractors || []).filter(d => d !== key);
    if (specificDistrs.length < 3) return null;

    // 对 type 1 (语境填空) 做额外质量过滤
    let validatedDistrs = [...specificDistrs];
    let articleNormalized = false;
    if (qType === 1 && isContextUsableForWord(key, info.context)) {
        const pattern = new RegExp(`\\b(${getWordForms(key).map(escapeRegExp).join('|')})\\b`, 'gi');
        const sentence = (info.context || '').replace(pattern, '_____');

        // 将 "a _____" / "an _____" 统一为 "a(n) _____"，不再限制选项
        const art = normalizeArticleContext(sentence);
        if (art.normalized) {
            articleNormalized = true;
            // 在 question 上记录冠词提示信息，前端分析时展示
        }

        // 过滤掉与正确答案过于相似的干扰项（含同义或包含关系）
        validatedDistrs = validatedDistrs.filter(d => {
            if (d.includes(key) || key.includes(d)) return false;
            return true;
        });
    }

    if (validatedDistrs.length < 3) return null;

    // 随机选 3 个干扰词 + 正确答案，一起 shuffle
    const pickedDistrs = secureRandom(validatedDistrs, 3);
    const allOptions = secureRandom([key, ...pickedDistrs], 4);
    const correctIdx = allOptions.indexOf(key);

    let q;
    if (qType === 1) {
        if (!isContextUsableForWord(key, info.context)) return null;
        const pattern = new RegExp(`\\b(${getWordForms(key).map(escapeRegExp).join('|')})\\b`, 'gi');
        let sentence = (info.context || '').replace(pattern, '_____');
        if (!sentence.includes('_____')) return null;
        // 冠词标准化: "a _____" / "an _____" → "a(n) _____"
        const art = normalizeArticleContext(sentence);
        sentence = art.text;
        if (art.normalized) articleNormalized = true;
        q = { type: 1, word: key, context: sentence, options: allOptions.map((o, i) => `${letters[i]}. ${o}`), answer: letters[correctIdx], articleNormalized };
    } else if (qType === 2) {
        const meaning = (info.meaning || '').split(';')[0] || info.meaning || '';
        q = { type: 2, word: key, context: meaning, options: allOptions.map((o, i) => `${letters[i]}. ${o}`), answer: letters[correctIdx] };
    } else if (qType === 3) {
        q = { type: 3, word: key, context: info.CN_Meaning || '', options: allOptions.map((o, i) => `${letters[i]}. ${o}`), answer: letters[correctIdx] };
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

        const opts = rec.fields.options || [];
        const optsText = Array.isArray(opts) ? opts.join(' | ') : String(opts);
        await updateRecord(TEST_TABLE, rec.record_id, {
            your_answer: yourAnswer || '',
            is_correct: isCorrect ? [OPT_IS_CORRECT] : [OPT_IS_WRONG],
            options: optsText
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
                    await updateRecord(WORD_TABLE, recordId, {
                        Status: STATUS_MASTERED,
                        remember_time: Date.now()
                    });
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
                await updateRecord(WORD_TABLE, wr.record_id, {
                    Status: STATUS_MASTERED,
                    remember_time: Date.now()
                });
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

    // 改用 getRecords 替代 searchRecords（search 在大数据量下容易超时）
    const allTestRecords = await getRecords(TEST_TABLE);
    const testRecords = allTestRecords.filter(r => getFieldValue(r.fields.user) === userId);
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
        await updateRecord(WORD_TABLE, record.record_id, { multi_definition: [OPT_MULTI_DEF_YES] });
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
        status: record.fields.Status || 'Pending',
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
    if (fields.status !== undefined) updateFields.Status = fields.status;
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

async function rebuildUserWordStatus(userId) {
    // 根据剩余测试记录重建单词掌握状态
    const allWords = await getRecords(WORD_TABLE);
    const userWords = allWords.filter(r => r.fields?.user === userId || getFieldValue(r.fields?.user) === userId);
    const testRecords = await getRecords(TEST_TABLE);
    const userTests = testRecords.filter(r => r.fields?.user === userId || getFieldValue(r.fields?.user) === userId);

    // 统计每个单词在剩余测试中的正确情况
    const wordCorrectMap = {};
    for (const t of userTests) {
        const word = getFieldValue(t.fields?.word);
        const isCorrect = getFieldValue(t.fields?.is_correct);
        if (!word) continue;
        if (!wordCorrectMap[word]) wordCorrectMap[word] = { correct: 0, total: 0 };
        wordCorrectMap[word].total++;
        if (isCorrect === 'optHGT7gYf' || isCorrect === '正确' || isCorrect === true || isCorrect === 'true') {
            wordCorrectMap[word].correct++;
        }
    }

    let updated = 0;
    for (const wordRecord of userWords) {
        const word = getFieldValue(wordRecord.fields?.Word);
        if (!word) continue;
        const stats = wordCorrectMap[word];
        const newStatus = (stats && stats.correct > 0) ? 'Mastered' : 'Pending';
        const currentStatus = getFieldValue(wordRecord.fields?.Status);
        if (currentStatus !== newStatus) {
            const updateFields = { Status: newStatus };
            if (newStatus === 'Mastered') {
                updateFields.remember_time = Date.now();
            }
            await updateRecord(WORD_TABLE, wordRecord.record_id, updateFields);
            updated++;
        }
    }
    console.log(`rebuildUserWordStatus: 用户 ${userId} 更新了 ${updated} 个单词状态`);
    return updated;
}

async function deleteUserTestData(userId, days = null) {
    // 获取该用户所有的测试记录
    const testRecords = await getRecords(TEST_TABLE);
    let userTests = testRecords.filter(r => r.fields?.user === userId || getFieldValue(r.fields?.user) === userId);

    // 如果指定了 days，只删除最近 N 天的记录
    let cutoffTime = null;
    if (days !== null && days > 0) {
        cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;
        const beforeCount = userTests.length;
        userTests = userTests.filter(r => {
            const t = r.fields?.test_time;
            return t && t >= cutoffTime;
        });
        console.log(`deleteUserTestData: 用户 ${userId} 共 ${beforeCount} 条记录，最近 ${days} 天内 ${userTests.length} 条将被删除`);
    } else {
        console.log(`deleteUserTestData: 找到用户 ${userId} 的 ${userTests.length} 条测试记录`);
    }

    if (userTests.length === 0) {
        // 即使没有删除记录，也重建单词状态和统计
        const rebuilt = await rebuildUserWordStatus(userId);
        await rebuildUserStats(userId);
        return { success: true, deleted: 0, rebuilt };
    }

    const token = await getToken();
    const recordIds = userTests.map(r => r.record_id);
    let deleted = 0;

    // 飞书支持批量删除（最多500条/批）
    for (let i = 0; i < recordIds.length; i += 500) {
        const batch = recordIds.slice(i, i + 500);
        await new Promise((resolve, reject) => {
            const body = JSON.stringify({ records: batch });
            const req = https.request({
                hostname: 'open.feishu.cn',
                path: `/open-apis/bitable/v1/apps/${TEST_TABLE.appToken}/tables/${TEST_TABLE.tableId}/records/batch_delete`,
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Content-Type': 'application/json'
                }
            }, (res) => {
                const chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => {
                    const result = JSON.parse(Buffer.concat(chunks).toString());
                    console.log(`batch_delete result: code=${result.code}, msg=${result.msg}, deleted_in_batch=${batch.length}`);
                    if (result.code === 0) deleted += batch.length;
                    else console.error(`batch_delete failed:`, JSON.stringify(result));
                    resolve(result);
                });
            });
            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }

    // 重建单词掌握状态（基于剩余测试记录）
    const rebuilt = await rebuildUserWordStatus(userId);

    // 重建考核统计
    await rebuildUserStats(userId);

    console.log(`deleteUserTestData: 删除了用户 ${userId} 的 ${deleted} 条测试记录，重建了 ${rebuilt} 个单词状态`);
    return { success: true, deleted, rebuilt };
}

async function rebuildUserStats(userId) {
    // 根据剩余测试记录重建用户统计
    const testRecords = await getRecords(TEST_TABLE);
    const userTests = testRecords.filter(r => r.fields?.user === userId || getFieldValue(r.fields?.user) === userId);

    // 按 test_id 分组统计考核次数
    const testIds = new Set();
    let correctCount = 0;
    let totalQuestions = 0;
    let lastTestTime = null;

    for (const t of userTests) {
        const testId = getFieldValue(t.fields?.test_id);
        const isCorrect = getFieldValue(t.fields?.is_correct);
        const time = t.fields?.test_time;

        if (testId) testIds.add(testId);
        totalQuestions++;
        if (isCorrect === 'optHGT7gYf' || isCorrect === '正确' || isCorrect === true || isCorrect === 'true') {
            correctCount++;
        }
        if (time && (!lastTestTime || time > lastTestTime)) {
            lastTestTime = time;
        }
    }

    const accuracyRate = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

    // 更新 STATS_TABLE
    const statsRecords = await getRecords(STATS_TABLE);
    const userStats = statsRecords.filter(r => r.fields?.user === userId || getFieldValue(r.fields?.user) === userId);

    for (const stat of userStats) {
        await updateRecord(STATS_TABLE, stat.record_id, {
            total_tests: testIds.size,
            correct_count: correctCount,
            accuracy_rate: accuracyRate,
            last_test_time: lastTestTime || null
        });
        console.log(`rebuildUserStats: 已重建用户 ${userId} 的统计 => 考核${testIds.size}次, 正确${correctCount}/${totalQuestions}, 正确率${accuracyRate}%`);
    }
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

module.exports = { generateQuiz, submitAnswers, getStats, addWord, getAllUsers, getAllStats, validateWords, addWords, updateMultiDefinition, getWord, updateWord, deleteWord, deleteUserTestData, getWordByRecordId, getReviewWords, markWordForReview, clearWordReview, searchRecords, getRecords, updateRecord, getToken };
