/**
 * One-time script: delete specific words from yusi's word list.
 *
 * Usage:
 *   node delete-yusi-words.js [--dry-run]
 */

const https = require('https');
const {
    APP_ID,
    APP_SECRET,
    WORD_TABLE,
} = require('./config');

const DRY_RUN = process.argv.includes('--dry-run');

const YUSI_USER_ID = 'yusi';

// Words to delete (case-insensitive match on Word field)
const WORDS_TO_DELETE = [
    'test_word',
    'afraid', 'apple', 'area', 'around', 'arrange', 'as', 'aspirin',
    'attend', 'attack', 'bank', 'bore', 'can', 'eastern', 'handsome',
    'improve', 'in spite of', 'milk', 'new', 'noun', 'november',
    'peach', 'talk', 'try', 'wave',
];

// --- Feishu helpers ---

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

async function getAllRecords(token) {
    const all = [];
    let pageToken = null;
    do {
        const qs = `page_size=500${pageToken ? `&page_token=${pageToken}` : ''}`;
        const path = `/open-apis/bitable/v1/apps/${WORD_TABLE.appToken}/tables/${WORD_TABLE.tableId}/records?${qs}`;
        const response = await request('GET', path, null, token);
        if (response.code !== 0) throw new Error(response.msg || '读取记录失败');
        all.push(...(response.data?.items || []));
        pageToken = response.data?.has_more ? response.data.page_token : null;
    } while (pageToken);
    return all;
}

async function deleteRecord(token, recordId) {
    const path = `/open-apis/bitable/v1/apps/${WORD_TABLE.appToken}/tables/${WORD_TABLE.tableId}/records/${recordId}`;
    const response = await request('DELETE', path, null, token);
    if (response.code !== 0) throw new Error(response.msg || '删除失败');
}

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

function isYusi(userField) {
    const val = fv(userField).toLowerCase();
    return val === YUSI_USER_ID || val.includes(YUSI_USER_ID);
}

// --- Main ---

async function run() {
    console.log(DRY_RUN ? '[dry-run 模式，不写入飞书]' : '[正式模式，将写入飞书]');

    const token = await getToken();
    const allRecords = await getAllRecords(token);
    console.log(`共 ${allRecords.length} 条词表记录`);

    const yusiRecords = allRecords.filter(r => isYusi(r.fields?.user));
    console.log(`yusi 共 ${yusiRecords.length} 条`);

    const toDeleteWords = new Set(WORDS_TO_DELETE.map(w => w.toLowerCase()));
    const toDelete = [];

    for (const record of yusiRecords) {
        const word = fv(record.fields?.Word).trim();
        const meaning = fv(record.fields?.Meaning).trim();
        const cn = fv(record.fields?.CN_Meaning).trim();

        // Blank entry: both word and meaning are empty
        const isBlank = !word && !meaning && !cn;
        // Named word match
        const isNamedTarget = word && toDeleteWords.has(word.toLowerCase());

        if (isBlank || isNamedTarget) {
            toDelete.push({ recordId: record.record_id, word: word || '(空白条目)' });
        }
    }

    if (!toDelete.length) {
        console.log('未找到需要删除的记录，退出。');
        return;
    }

    console.log(`\n待删除 ${toDelete.length} 条：`);
    for (const item of toDelete) {
        console.log(`  ${item.word}  (${item.recordId})`);
    }

    if (DRY_RUN) {
        console.log('\n[dry-run] 未实际删除。');
        return;
    }

    let deleted = 0;
    let errors = 0;
    for (const item of toDelete) {
        try {
            await deleteRecord(token, item.recordId);
            console.log(`  已删除: ${item.word}`);
            deleted++;
        } catch (error) {
            console.error(`  删除失败 [${item.word}]: ${error.message}`);
            errors++;
        }
    }

    console.log(`\n完成：删除 ${deleted} 条，失败 ${errors} 条`);
}

if (require.main === module) {
    run().catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
