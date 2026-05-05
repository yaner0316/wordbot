const https = require('https');
const crypto = require('crypto');

const APP_ID = 'cli_a97e125f0ab89cb5';
const APP_SECRET = 'pppKJAybbiNqKIDB9hlvshTnXGPg7OVH';

const WORD_TABLE = { appToken: 'BWhIb2hjaaDQHdsNhWRcPluBncg', tableId: 'tblyMh69dws6ty6n' };
const DIST_TABLE = { appToken: 'GskxbMxMgaDPFRsgqS4cdWvdndb', tableId: 'tbl3EgurgOTXdM3V' };

const TEST_WORDS = {
    yusi: [
        { word: 'serendipity', pos: 'n.', meaning: '意外发现美好事物的运气', context: 'Finding that rare book at the flea market was pure serendipity___.' },
        { word: 'ephemeral', pos: 'adj.', meaning: '短暂的，转瞬即逝的', context: 'The beauty of cherry blossoms is ephemeral___.' },
        { word: 'ubiquitous', pos: 'adj.', meaning: '无处不在的，普遍存在的', context: 'Smartphones have become ubiquitous___ in modern society.' },
        { word: 'eloquent', pos: 'adj.', meaning: '雄辩的，口才好的', context: 'Her eloquent speech moved the entire audience___.' },
        { word: 'resilient', pos: 'adj.', meaning: '有弹性的，能快速恢复的', context: 'Children are remarkably resilient___ in the face of adversity.' },
        { word: 'benevolent', pos: 'adj.', meaning: '善良的，仁慈的', context: 'The benevolent donor gave millions to charity___.' },
        { word: 'candid', pos: 'adj.', meaning: '坦率的，直言不讳的', context: 'He gave a candid assessment of the situation___.' },
        { word: 'diligent', pos: 'adj.', meaning: '勤勉的，刻苦的', context: 'The diligent student always submitted work on time___.' },
        { word: 'gregarious', pos: 'adj.', meaning: '爱交际的，友善的', context: 'Her gregarious nature made her popular at parties___.' },
        { word: 'pragmatic', pos: 'adj.', meaning: '务实的，实际的', context: 'We need a pragmatic approach to solve this problem___.' }
    ],
    qiuqiu: [
        { word: 'luminous', pos: 'adj.', meaning: '发光的，明亮的', context: 'The luminous moon lit up the night sky___.' },
        { word: 'meticulous', pos: 'adj.', meaning: '一丝不苟的，极度仔细的', context: 'The meticulous chef measured every ingredient precisely___.' },
        { word: 'tenacious', pos: 'adj.', meaning: '顽强的，坚持不懈的', context: 'Her tenacious spirit helped her win the championship___.' },
        { word: 'ambiguous', pos: 'adj.', meaning: '模糊不清的，含糊的', context: 'The ambiguous instructions confused everyone___.' },
        { word: 'profound', pos: 'adj.', meaning: '深刻的，意义深远的', context: 'The book had a profound impact on my thinking___.' },
        { word: 'vivid', pos: 'adj.', meaning: '生动的，鲜艳的', context: 'She painted a vivid picture of the tropical sunset___.' },
        { word: 'zealous', pos: 'adj.', meaning: '热心的，热情的', context: 'The zealous volunteers worked tirelessly___.' },
        { word: 'ardent', pos: 'adj.', meaning: '热烈的，热情的', context: 'He was an ardent supporter of environmental protection___.' },
        { word: 'acute', pos: 'adj.', meaning: '敏锐的，尖锐的', context: 'Dogs have an acute sense of smell___.' },
        { word: 'apt', pos: 'adj.', meaning: '恰当的，贴切的', context: 'Her apt description perfectly captured the scene___.' }
    ]
};

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
    return res.tenant_access_token;
}

async function addRecord(table, fields) {
    const token = await getToken();
    return request('POST', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records`, { fields }, token);
}

async function getExistingWords() {
    const token = await getToken();
    const res = await request('GET', `/open-apis/bitable/v1/apps/${DIST_TABLE.appToken}/tables/${DIST_TABLE.tableId}/records?page_size=500`, null, token);
    return res.data?.items || [];
}

async function addTestWords() {
    console.log('开始添加测试单词...\n');
    
    const existingRecords = await getExistingWords();
    const existingWords = new Set(existingRecords.map(r => r.fields.Word?.toLowerCase()));
    const existingDistractors = new Set();
    for (const r of existingRecords) {
        if (r.fields.Distractors) {
            r.fields.Distractors.split(',').forEach(d => existingDistractors.add(d.trim().toLowerCase()));
        }
    }
    
    const allValidWords = [...existingWords, ...existingDistractors].filter(w => w);
    
    for (const [user, words] of Object.entries(TEST_WORDS)) {
        console.log(`\n=== 为 ${user} 添加单词 ===`);
        let count = 0;
        
        for (const w of words) {
            try {
                const lowerWord = w.word.toLowerCase();
                
                const wordFields = {
                    user: user,
                    Word: w.word,
                    Meaning: w.meaning,
                    POS: w.pos,
                    Status: 'Pending',
                    record_time: Date.now()
                };
                
                await addRecord(WORD_TABLE, wordFields);
                
                const distractors = [];
                const pool = [...allValidWords].filter(word => word !== lowerWord);
                
                while (distractors.length < 3 && pool.length > 0) {
                    const idx = crypto.randomInt(0, pool.length);
                    const candidate = pool[idx];
                    if (!distractors.includes(candidate)) {
                        distractors.push(candidate);
                    }
                    pool.splice(idx, 1);
                }
                
                const distFields = {
                    Word: w.word,
                    Meaning: w.meaning,
                    POS: w.pos,
                    Context: w.context,
                    Distractors: distractors.join(',')
                };
                
                await addRecord(DIST_TABLE, distFields);
                
                console.log(`  ✓ ${w.word} (干扰词: ${distractors.join(', ')})`);
                count++;
            } catch (e) {
                console.log(`  ✗ ${w.word}: ${e.message}`);
            }
        }
        
        console.log(`  ${user} 共添加 ${count} 个单词`);
    }
    
    console.log('\n=== 测试单词添加完成 ===');
}

addTestWords().catch(console.error);
