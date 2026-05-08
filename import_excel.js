const XLSX = require('xlsx');
const https = require('https');

const USER_ID = 'yusi';
const WORD_TABLE = { appToken: 'BWhIb2hjaaDQHdsNhWRcPluBncg', tableId: 'tblyMh69dws6ty6n' };
const DISTRACTOR_TABLE = { appToken: 'GskxbMxMgaDPFRsgqS4cdWvdndb', tableId: 'tbl3EgurgOTXdM3V' };

const TRAD_TO_SIMP = {
    '為':'为','與':'与','過':'过','來':'来','時':'时','們':'们','這':'这',
    '個':'个','學':'学','國':'国','會':'会','對':'对','麼':'么','沒':'没','種':'种',
    '經':'经','開':'开','現':'现','長':'长','義':'义','發':'发','見':'见',
    '關':'关','電':'电','網':'网','場':'场','間':'间','題':'题','處':'处',
    '應':'应','進':'进','動':'动','運':'运','營':'营','變':'变','說':'说',
    '認':'认','論':'论','無':'无','機':'机','東':'东','車':'车','員':'员',
    '達':'达','區':'区','書':'书','報':'报','資':'资','總':'总','產':'产',
    '價':'价','結':'结','覺':'觉','廣':'广','錯':'错','雖':'虽','親':'亲',
    '聽':'听','從':'从','樣':'样','線':'线','風':'风','護':'护','準':'准',
    '備':'备','導':'导','創':'创','極':'极','務':'务','確':'确','單':'单',
    '觀':'观','類':'类','統':'统','據':'据','層':'层','歷':'历','決':'决',
    '質':'质','號':'号','試':'试','連':'连','龍':'龙','隊':'队','農':'农',
    '異':'异','餘':'余','體':'体','島':'岛','藥':'药','鄉':'乡','錢':'钱',
    '陽':'阳','陰':'阴','雜':'杂','雙':'双','難':'难','離':'离','靈':'灵',
    '驗':'验','競':'竞','繼':'继','續':'续','聯':'联','職':'职','鐵':'铁',
    '歸':'归','寶':'宝','懸':'悬','織':'织','譯':'译','贊':'赞','輸':'输',
    '辦':'办','鎮':'镇','閉':'闭','陳':'陈','隨':'随','際':'际','陸':'陆',
    '階':'阶','預':'预','點':'点','響':'响','讓':'让','謊':'谎','譽':'誉',
    '讀':'读','計':'计','誤':'误','誇':'夸','設':'设','許':'许','訴':'诉',
    '詞':'词','謝':'谢','幾':'几','萬':'万','參':'参','華':'华','標':'标',
    '選':'选','門':'门','術':'术','環':'环'
};

function toSimplified(text) {
    if (!text || typeof text !== 'string') return '';
    let result = text;
    for (const [trad, simp] of Object.entries(TRAD_TO_SIMP)) {
        result = result.split(trad).join(simp);
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
    const res = await request('POST', '/open-apis/auth/v3/tenant_access_token/internal', { app_id: 'cli_a97e125f0ab89cb5', app_secret: 'pppKJAybbiNqKIDB9hlvshTnXGPg7OVH' });
    return res.tenant_access_token;
}

async function getRecords(token, table) {
    const res = await request('GET', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records?page_size=500`, null, token);
    return res.data?.items || [];
}

async function addRecord(token, table, fields) {
    return request('POST', `/open-apis/bitable/v1/apps/${table.appToken}/tables/${table.tableId}/records`, { fields }, token);
}

const FALLBACK_DISTRACTORS = {
    v: ['receive', 'obtain', 'acquire', 'achieve', 'gain', 'grasp', 'capture'],
    n: ['instance', 'example', 'case', 'sample', 'model', 'pattern', 'item'],
    adj: ['attractive', 'appealing', 'charming', 'elegant', 'graceful', 'beautiful'],
    adv: ['quickly', 'slowly', 'carefully', 'gently', 'suddenly', 'completely']
};

async function main() {
    const workbook = XLSX.readFile('单词机器人-数据 副本_生产-单词表.xlsx');
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`Excel文件共有 ${rows.length} 行数据`);
    
    const token = await getToken();
    const existingWords = await getRecords(token, WORD_TABLE);
    const existingWordSet = new Set(existingWords.map(r => (r.fields.Word || '').toLowerCase()));
    console.log(`当前已有 ${existingWordSet.size} 个单词`);
    
    const now = Date.now();
    let added = 0, skipped = 0;
    
    for (const row of rows) {
        const word = (row['单词'] || '').toString().trim();
        if (!word) continue;
        
        if (existingWordSet.has(word.toLowerCase())) {
            skipped++;
            continue;
        }
        
        let meaning = '';
        try {
            const meaningJson = row['释义JSON'];
            if (meaningJson) {
                const parsed = JSON.parse(meaningJson);
                meaning = toSimplified(parsed[0]?.cn || parsed[0]?.chinese || parsed[0] || '');
            }
        } catch (e) {}
        
        const importer = row['录入人'];
        const user = importer || USER_ID;
        
        await addRecord(token, WORD_TABLE, {
            'user': user,
            'Word': word,
            'Status': 'Pending',
            'record_time': now,
            'Error_Count': 0,
            'multi_definition': row['是否多义词'] === '是' ? ['是'] : ['否']
        });
        
        const pos = word.endsWith('tion') || word.endsWith('ment') ? 'n' : 
                    word.endsWith('ly') ? 'adv' : 'adj';
        
        const distList = [...(FALLBACK_DISTRACTORS[pos] || FALLBACK_DISTRACTORS.n)].slice(0, 4);
        
        await addRecord(token, DISTRACTOR_TABLE, {
            'Word': word,
            'POS': pos,
            'Meaning': meaning || word,
            'Distractors': distList.join(','),
            'Context': `The word "${word}" is used in context.`,
            'Translation': meaning
        });
        
        existingWordSet.add(word.toLowerCase());
        added++;
        if (added % 20 === 0) console.log(`已导入 ${added} 个...`);
    }
    
    console.log(`\n[System]: 已导入 ${added} 个新单词。跳过(已存在): ${skipped}。`);
}

main();
