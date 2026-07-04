/**
 * Backfill script: update existing type-4 review questions with contextual meanings.
 *
 * For every type-4 review record whose source question was a type-1 (context-fill),
 * re-derive the correct meaning from the source context sentence using the AI and
 * overwrite correct_answer if the result differs.
 *
 * Usage:
 *   node backfill-review-contextual-meanings.js [--dry-run]
 */

const https = require('https');
const {
    APP_ID,
    APP_SECRET,
    TEST_TABLE,
    MINIMAX_API_KEY,
} = require('./config');
const { hasAiMetaResponse } = require('./question-quality');
const { cleanContextualMeaning } = require('./context-meaning');

const DRY_RUN = process.argv.includes('--dry-run');

// --- Feishu helpers (self-contained, no app dependencies) ---

async function request(method, path, body, token) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const headers = { 'Content-Type': 'application/json' };
        if (data) headers['Content-Length'] = Buffer.byteLength(data);
        if (token) headers.Authorization = `Bearer ${token}`;
        const req = https.request(
            { hostname: 'open.feishu.cn', method, path, headers },
            response => {
                const chunks = [];
                response.on('data', chunk => chunks.push(chunk));
                response.on('end', () => {
                    try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
                    catch (error) { reject(error); }
                });
            }
        );
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

async function getToken() {
    const response = await request(
        'POST',
        '/open-apis/auth/v3/tenant_access_token/internal',
        { app_id: APP_ID, app_secret: APP_SECRET }
    );
    if (response.code !== 0 || !response.tenant_access_token) {
        throw new Error(response.msg || '无法获取飞书访问令牌');
    }
    return response.tenant_access_token;
}

async function getAllRecords(token, table) {
    const all = [];
    let pageToken = null;
    do {
        const qs = `page_size=500${pageToken ? `&page_token=${pageToken}` : ''}`;
        const path = `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records?${qs}`;
        const response = await request('GET', path, null, token);
        if (response.code !== 0) throw new Error(response.msg || '读取记录失败');
        const items = response.data?.items || [];
        all.push(...items);
        pageToken = response.data?.has_more ? response.data.page_token : null;
    } while (pageToken);
    return all;
}

async function updateRecord(token, table, recordId, fields) {
    const path = `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records/${recordId}`;
    const response = await request('PUT', path, { fields }, token);
    if (response.code !== 0) throw new Error(response.msg || '更新记录失败');
    return response;
}

// --- MiniMax helper ---

async function callMiniMaxAPI(prompt) {
    if (!MINIMAX_API_KEY) return '';
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            model: 'MiniMax-M2.7',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 64,
        });
        const headers = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${MINIMAX_API_KEY}`,
            'Content-Length': Buffer.byteLength(body),
        };
        const req = https.request(
            {
                hostname: 'api.minimax.chat',
                path: '/v1/text/chatcompletion_v2',
                method: 'POST',
                headers,
            },
            response => {
                const chunks = [];
                response.on('data', chunk => chunks.push(chunk));
                response.on('end', () => {
                    try {
                        const parsed = JSON.parse(Buffer.concat(chunks).toString());
                        resolve(parsed?.choices?.[0]?.message?.content || '');
                    } catch (error) { reject(error); }
                });
            }
        );
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function toSimp(text) {
    // No converter available in standalone script; return as-is.
    return String(text || '').trim();
}

async function generateContextMeaning(word, context) {
    if (!MINIMAX_API_KEY) return '';
    const sentence = String(context || '').replace(/_{3,}/g, word);
    const prompt = [
        '给定英文单词和它在句子中的具体用法，返回最贴切的中文释义。',
        '只输出一行中文释义，不要解释，不超过10个字。',
        '如果是短语义或具体语境义，优先返回语境义。',
        '单词：' + word,
        '句子：' + sentence,
    ].join('\n');
    const result = await callMiniMaxAPI(prompt);
    return toSimp(result).trim();
}

// --- Field value helper ---

function fv(value) {
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return value.length > 0 ? fv(value[0]) : '';
    if (typeof value === 'object') {
        if (value.text !== undefined) return String(value.text);
        if (value.value !== undefined) return String(value.value);
        return JSON.stringify(value);
    }
    return String(value);
}

// --- Main ---

async function run() {
    if (!MINIMAX_API_KEY) {
        console.error('MINIMAX_API_KEY 未设置，无法推断语境义，退出。');
        process.exitCode = 1;
        return;
    }

    console.log(DRY_RUN ? '[dry-run 模式，不写入飞书]' : '[正式模式，将写入飞书]');

    const token = await getToken();
    console.log('获取飞书 token 成功');

    console.log('加载所有测试记录...');
    const allRecords = await getAllRecords(token, TEST_TABLE);
    console.log(`共 ${allRecords.length} 条记录`);

    // Index all records by Feishu row ID for fast lookup
    const byRowId = new Map(allRecords.map(r => [r.record_id, r]));

    // Filter: type-4 review records that haven't been submitted wrong or are still active
    const reviewType4 = allRecords.filter(r => {
        const fields = r.fields || {};
        return (
            Number(fv(fields.question_type)) === 4 &&
            fv(fields.assessment_kind) === 'review'
        );
    });
    console.log(`找到 ${reviewType4.length} 条 type-4 复习记录`);

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const record of reviewType4) {
        const fields = record.fields || {};
        const sourceQuestionRowId = fv(fields.source_question_id);
        const word = fv(fields.word);
        const currentAnswer = fv(fields.correct_answer);

        if (!sourceQuestionRowId) {
            skipped++;
            continue;
        }

        const sourceRecord = byRowId.get(sourceQuestionRowId);
        if (!sourceRecord) {
            skipped++;
            continue;
        }

        const sourceType = Number(fv(sourceRecord.fields?.question_type)) || 1;
        const sourceContext = fv(sourceRecord.fields?.context).trim();

        // Only process type-1 source questions with a real sentence (not just the word)
        if (sourceType !== 1 || !sourceContext || sourceContext === word) {
            skipped++;
            continue;
        }

        // Skip if correct_answer is already a JSON array (multi-def, don't touch)
        try {
            const parsed = JSON.parse(currentAnswer);
            if (Array.isArray(parsed)) { skipped++; continue; }
        } catch { /* single string, proceed */ }

        try {
            const rawMeaning = await generateContextMeaning(word, sourceContext);
            const contextualMeaning = cleanContextualMeaning(rawMeaning);

            if (!contextualMeaning) { skipped++; continue; }
            if (contextualMeaning === currentAnswer) { skipped++; continue; }

            console.log(`  [${word}] "${currentAnswer}" → "${contextualMeaning}"  (context: ${sourceContext.slice(0, 60)})`);

            if (!DRY_RUN) {
                await updateRecord(token, TEST_TABLE, record.record_id, {
                    correct_answer: contextualMeaning,
                });
            }
            updated++;
        } catch (error) {
            console.error(`  [${word}] 更新失败: ${error.message}`);
            errors++;
        }
    }

    console.log(`\n完成：更新 ${updated} 条，跳过 ${skipped} 条，失败 ${errors} 条`);
}

if (require.main === module) {
    run().catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}

module.exports = { run };
