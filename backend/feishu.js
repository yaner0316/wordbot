const https = require('https');
const crypto = require('crypto');

const APP_ID = process.env.FEISHU_APP_ID || 'cli_a97e125f0ab89cb5';
const APP_SECRET = process.env.FEISHU_APP_SECRET || 'pppKJAybbiNqKIDB9hlvshTnXGPg7OVH';
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;

const WORD_TABLE = { appToken: 'BWhIb2hjaaDQHdsNhWRcPluBncg', tableId: 'tblyMh69dws6ty6n' };
const DIST_TABLE = { appToken: 'GskxbMxMgaDPFRsgqS4cdWvdndb', tableId: 'tbl3EgurgOTXdM3V' };
const TEST_TABLE = { appToken: 'FyyPb1urFacfn7sGSjpca2UwnHe', tableId: 'tbl6Nx0kJWjr7qQZ' };
const STATS_TABLE = { appToken: 'Mbh7bK7Jrah7XMsV9lhceE7cnyh', tableId: 'tblQBYKzcQuz8sSq' };

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

async function searchRecords(table, filter) {
    const token = await getToken();
    const allRecords = [];
    let pageToken = null;
    const body = { page_size: 500 };
    if (filter) body.filter = filter;

    do {
        if (pageToken) body.page_token = pageToken;
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
    // 词库统计
    let stats = { total: 0, hasCN: 0, hasDist3: 0, canType3: 0 };
    
    for (const r of records) {
        const w = r.fields.Word?.toLowerCase();
        if (w) {
            const cn = r.fields.CN_Meaning?.trim() || '';
            const dists = r.fields.Distractors ? r.fields.Distractors.split(',').map(s => s.trim()).filter(s => s) : [];
            const context = r.fields.Context || '';
            
            pool[w] = {
                pos: r.fields.POS,
                meaning: r.fields.Meaning,
                CN_Meaning: cn,
                distractors: dists,
                context: context,
                rawContext: context
            };
            
            stats.total++;
            if (cn) stats.hasCN++;
            if (dists.length >= 3) stats.hasDist3++;
            if (cn && dists.length >= 3) stats.canType3++;
        }
    }
    console.log(`词库: 总数=${stats.total}, 有中文=${stats.hasCN}, 有3个干扰词=${stats.hasDist3}, 可出type3=${stats.canType3}`);
    return pool;
}

async function getPendingWords(userId) {
    const records = await getRecords(WORD_TABLE);
    return records
        .filter(r => r.fields.user === userId && r.fields.Status !== 'optF5P0W3O')
        .map(r => ({ word: r.fields.Word, record_id: r.record_id }));
}

function isContextValid(ctx) {
    if (!ctx || ctx === '___' || ctx.includes('[object Object]')) return false;
    return true;
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
    const pool = await getDistractorPool();
    const pending = await getPendingWords(userId);

    const valid = pending.filter(w => {
        const info = pool[w.word.toLowerCase()];
        return info && (info.distractors || []).filter(d => d).length >= 3;
    });

    if (valid.length < 2) {
        return { error: `可用单词不足，当前${valid.length}个，需要至少2个` };
    }

    // 分离不同类型的单词
    const withCN = valid.filter(w => {
        const info = pool[w.word.toLowerCase()];
        return info.CN_Meaning?.trim();
    });
    const withContext = valid.filter(w => {
        const info = pool[w.word.toLowerCase()];
        return !info.CN_Meaning?.trim() && info.context?.trim();
    });
    const withMeaning = valid.filter(w => {
        const info = pool[w.word.toLowerCase()];
        return !info.CN_Meaning?.trim() && !info.context?.trim() && info.meaning?.trim();
    });

    console.log(`可用: 总=${valid.length}, type3=${withCN.length}, type1=${withContext.length}, type2=${withMeaning.length}`);

    // 严格按 6:2:2 比例选取
    const targetType3 = 2, targetType1 = 6, targetType2 = 2;
    const selectedType3 = secureRandom(withCN, Math.min(withCN.length, targetType3));
    const selectedType1 = secureRandom(withContext, Math.min(withContext.length, targetType1));
    const selectedType2 = secureRandom(withMeaning, Math.min(withMeaning.length, targetType2));

    const selected = [...selectedType3, ...selectedType1, ...selectedType2];
    const typeMap = new Map();
    selectedType3.forEach(w => typeMap.set(w.word.toLowerCase(), 3));
    selectedType1.forEach(w => typeMap.set(w.word.toLowerCase(), 1));
    selectedType2.forEach(w => typeMap.set(w.word.toLowerCase(), 2));

    const totalQuestions = 10;
    const usedWords = new Set();
    const usedDistractors = new Set();
    const questions = [];
    const testId = crypto.randomUUID().split('-')[0];
    const letters = ['A', 'B', 'C', 'D'];

    for (const w of selected) {
        if (questions.length >= totalQuestions) break;
        const key = w.word.toLowerCase();
        if (usedWords.has(key)) continue;
        usedWords.add(key);

        const info = pool[key];
        const qType = typeMap.get(key);

        const specificDistrs = (info.distractors || []).filter(d => d !== key);
        if (specificDistrs.length < 3) continue;

        const distrs = secureRandom(specificDistrs, 3);
        distrs.forEach(d => usedDistractors.add(d));

        const opts = [key, ...distrs];
        for (let i = opts.length - 1; i > 0; i--) {
            const j = crypto.randomInt(0, i + 1);
            [opts[i], opts[j]] = [opts[j], opts[i]];
        }
        const finalOpts = opts.slice(0, 4);
        const finalCorrectIdx = finalOpts.indexOf(key);
        console.log(`出题: word=${key}, finalOpts=${JSON.stringify(finalOpts)}, correctIdx=${finalCorrectIdx}, answer=${letters[finalCorrectIdx]}`);

        let q;
        if (qType === 1) {
            const singular = key.endsWith('y') ? key.slice(0, -1) + 'ies' : key + 's';
            const pattern = new RegExp(`(${key}|${singular})`, 'gi');
            const sentence = (info.context || '').replace(pattern, '_____');
            q = { type: 1, word: key, context: sentence, options: finalOpts.map((o, i) => `${letters[i]}. ${o}`), answer: letters[finalCorrectIdx] };
        } else if (qType === 2) {
            const meaning = info.meaning || info.meaning.split(';')[0] || '';
            q = { type: 2, word: key, context: meaning, options: finalOpts.map((o, i) => `${letters[i]}. ${o}`), answer: letters[finalCorrectIdx] };
        } else if (qType === 3) {
            const cnMeaning = info.CN_Meaning || '';
            q = { type: 3, word: key, context: cnMeaning, options: finalOpts.map((o, i) => `${letters[i]}. ${o}`), answer: letters[finalCorrectIdx] };
        }
        
        if (!q.context) continue;
        q.testId = testId;
        questions.push(q);
    }

    // 确保凑满10道题，从剩余单词中补 type1 或 type2
    const selectedKeys = new Set(selected.map(w => w.word.toLowerCase()));
    const remaining = valid.filter(w => !selectedKeys.has(w.word.toLowerCase()));
    const remainingWithContext = remaining.filter(w => pool[w.word.toLowerCase()]?.context?.trim());
    const remainingWithMeaning = remaining.filter(w => !pool[w.word.toLowerCase()]?.context?.trim() && pool[w.word.toLowerCase()]?.meaning?.trim());

    const currentCounts = { 1: selectedType1.length, 2: selectedType2.length, 3: selectedType3.length };

    while (questions.length < 10) {
        let nextWord = null;
        let nextType = null;

        // 优先补 type1
        if (currentCounts[1] < targetType1 && remainingWithContext.length > 0) {
            nextWord = remainingWithContext.splice(Math.floor(Math.random() * remainingWithContext.length), 1)[0];
            nextType = 1;
            currentCounts[1]++;
        } else if (currentCounts[2] < targetType2 && remainingWithMeaning.length > 0) {
            nextWord = remainingWithMeaning.splice(Math.floor(Math.random() * remainingWithMeaning.length), 1)[0];
            nextType = 2;
            currentCounts[2]++;
        } else if (remainingWithContext.length > 0) {
            nextWord = remainingWithContext.splice(Math.floor(Math.random() * remainingWithContext.length), 1)[0];
            nextType = 1;
        } else if (remainingWithMeaning.length > 0) {
            nextWord = remainingWithMeaning.splice(Math.floor(Math.random() * remainingWithMeaning.length), 1)[0];
            nextType = 2;
        }

        if (!nextWord) break;

        const key = nextWord.word.toLowerCase();
        const info = pool[key];
        const t = nextType;
        const distrs = secureRandom((info.distractors || []).filter(d => d !== key), 3);
        if (distrs.length < 3) continue;

        const shuffledOpts = secureRandom([key, ...distrs], 4);
        const correctIdx = shuffledOpts.indexOf(key);
        const letters = ['A', 'B', 'C', 'D'];

        let context = '';
        if (t === 1 && info.context) {
            const singular = key.endsWith('y') ? key.slice(0, -1) + 'ies' : key + 's';
            const pattern = new RegExp(`(${key}|${singular})`, 'gi');
            context = info.context.replace(pattern, '_____');
        } else {
            context = info.meaning || '';
        }

        if (context) {
            questions.push({ type: t, word: key, context, options: shuffledOpts.map((o, i) => `${letters[i]}. ${o}`), answer: letters[correctIdx], testId });
        }
    }

    console.log(`生成题目: 总=${questions.length}, type1=${questions.filter(q=>q.type===1).length}, type2=${questions.filter(q=>q.type===2).length}, type3=${questions.filter(q=>q.type===3).length}`);

    const token = await getToken();
    for (const q of questions) {
        await addRecord(TEST_TABLE, {
            user: userId,
            test_id: testId,
            word: q.word,
            question_type: q.type,
            correct_answer: q.answer,
            test_time: Date.now()
        });
    }

    return {
        testId,
        questions: questions.map(({ testId: _, ...q }) => q)
    };
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
        const isCorrect = yourAnswer === correctAnswer;
        if (isCorrect) correct++;

        await updateRecord(TEST_TABLE, rec.record_id, {
            your_answer: yourAnswer || '',
            is_correct: isCorrect ? ['optHGT7gYf'] : ['optbe4bsQk']
        });

        const word = rec.fields.word;
        if (!wordMap[word]) wordMap[word] = { correct: 0, total: 0 };
        wordMap[word].total++;
        if (isCorrect) wordMap[word].correct++;

        results.push({ q: i + 1, word, your: yourAnswer, answer: answerStr, correct: isCorrect });
    }

    const masteredWords = [];
    for (const [word, stats] of Object.entries(wordMap)) {
        if (stats.correct >= stats.total) {
            masteredWords.push(word);
            const wordRecords = (await getRecords(WORD_TABLE)).filter(r => r.fields.user === userId && r.fields.Word === word);
            if (wordRecords.length > 0) {
                await updateRecord(WORD_TABLE, wordRecords[0].record_id, { Status: 'optF5P0W3O' });
            }
        }
    }

    const wordRecords = (await getRecords(WORD_TABLE)).filter(r => r.fields.user === userId);
    const total = wordRecords.length;
    const mastered = wordRecords.filter(r => r.fields.Status === 'optF5P0W3O').length;

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
    const wordRecords = (await getRecords(WORD_TABLE)).filter(r => r.fields.user === userId);
    const total = wordRecords.length;
    const mastered = wordRecords.filter(r => r.fields.Status === 'optF5P0W3O').length;
    const statsRecords = await getRecords(STATS_TABLE);
    const userRecord = statsRecords.find(r => r.fields.user === userId);

    const acc = (userRecord?.fields?.total_tests || 0) > 0 
        ? ((userRecord.fields.correct_count / (userRecord.fields.total_tests * 4)) * 100)
        : 0;
    return {
        user: userId,
        totalWords: total,
        masteredWords: mastered,
        pendingWords: total - mastered,
        totalTests: userRecord?.fields?.total_tests || 0,
        correctCount: userRecord?.fields?.correct_count || 0,
        accuracyRate: `${acc.toFixed(1)}%`,
        lastTestTime: userRecord?.fields?.last_test_time || null
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
    const userSet = new Set(records.map(r => r.fields.user).filter(u => u));
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

function callMiniMaxAPI(prompt) {
    return new Promise((resolve, reject) => {
        if (!MINIMAX_API_KEY) {
            reject(new Error('MINIMAX_API_KEY not set'));
            return;
        }
        const data = JSON.stringify({
            model: 'MiniMax-M2.7',
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
        req.write(data);
        req.end();
    });
}

async function generateExampleWithAI(word, meaning) {
    const prompt = `为单词 ${word} 生成一个英文例句，返回JSON：{"example": "例句"}`;
    try {
        const result = await callMiniMaxAPI(prompt);
        if (result) {
            const match = result.match(/"example"\s*:\s*"([^"]+)"/);
            if (match) return match[1];
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
            
            let distractors = generateDistractorsWithAI(word, def.meaning);
            if (!distractors || distractors.length < 3) {
                const distPool = await getDistractorPool();
                const lowerWord = word.toLowerCase();
                const allWords = Object.keys(distPool);
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
            
            let example = await generateExampleWithAI(word, def.meaning);
            if (!example && def.context) {
                example = def.context;
            }
            
            let cnMeaning = await translateToCN(def.meaning);
            if (!cnMeaning) {
                cnMeaning = await translateToCN(info.cnMeaning);
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

module.exports = { generateQuiz, submitAnswers, getStats, addWord, getAllUsers, getAllStats, validateWords, addWords, updateMultiDefinition, getWord, updateWord, deleteWord };
