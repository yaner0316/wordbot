const XLSX = require('xlsx');
const https = require('https');

const APP_ID = 'cli_a97e125f0ab89cb5';
const APP_SECRET = 'pppKJAybbiNqKIDB9hlvshTnXGPg7OVH';
const WORD_APP = 'BWhIb2hjaaDQHdsNhWRcPluBncg';
const WORD_TABLE = 'tblyMh69dws6ty6n';
const DIST_APP = 'GskxbMxMgaDPFRsgqS4cdWvdndb';
const DIST_TABLE = 'tbl3EgurgOTXdM3V';

function req(method, path, body, token) {
    return new Promise((resolve) => {
        const data = body ? JSON.stringify(body) : null;
        const headers = { 'Content-Type': 'application/json' };
        if (data) headers['Content-Length'] = Buffer.byteLength(data);
        if (token) headers['Authorization'] = 'Bearer ' + token;
        const r = https.request({ hostname: 'open.feishu.cn', path, method, headers }, (res) => {
            let chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { resolve({}); } });
        });
        r.on('error', () => resolve({}));
        if (data) r.write(data);
        r.end();
    });
}

async function getToken() {
    const res = await req('POST', '/open-apis/auth/v3/tenant_access_token/internal', { app_id: APP_ID, app_secret: APP_SECRET });
    return res.tenant_access_token;
}

async function add(appToken, tableId, fields) {
    return req('POST', '/open-apis/bitable/v1/apps/' + appToken + '/tables/' + tableId + '/records', { fields }, await getToken());
}

const SIMP = {
    '為':'为','義':'义','過':'过','來':'来','時':'时','個':'个','學':'学','國':'国','會':'会','對':'对','沒':'没','種':'种','經':'经','開':'开','現':'现','發':'发','見':'见','關':'关','電':'电','網':'网','場':'场','間':'间','題':'题','處':'应','應':'应','進':'进','動':'动','運':'运','營':'营','變':'变','說':'说','認':'认','論':'论','無':'无','機':'机','東':'东','車':'车','員':'员','達':'达','區':'区','書':'书','報':'报','資':'资','總':'总','產':'产','價':'价','結':'结','覺':'觉','廣':'广','錯':'错','雖':'虽','親':'亲','聽':'听','從':'从','樣':'样','線':'线','風':'风','護':'护','準':'准','備':'备','導':'导','創':'创','極':'极','務':'务','確':'确','單':'单','觀':'观','類':'类','統':'统','據':'据','層':'层','歷':'历','決':'决','質':'质','號':'号','試':'试','連':'连','龍':'龙','隊':'队','農':'农','異':'异','餘':'余','體':'体','島':'岛','藥':'药','鄉':'乡','錢':'钱','陽':'阳','陰':'阴','雜':'杂','雙':'双','難':'难','離':'离','靈':'灵','驗':'验','競':'竞','繼':'继','續':'续','聯':'联','職':'职','鐵':'铁','歸':'归','寶':'宝','懸':'悬','織':'织','譯':'译','贊':'赞','輸':'输','辦':'办','鎮':'镇','閉':'闭','陳':'随','隨':'随','際':'际','陸':'陆','階':'阶','預':'预','點':'点','響':'响','讓':'让','謊':'谎','譽':'誉','讀':'读','計':'计','誤':'误','誇':'夸','設':'设','許':'许','訴':'诉','詞':'词','謝':'谢','幾':'几','萬':'万','參':'参','華':'华','標':'标','選':'选','門':'门','術':'术','環':'环','詞':'词'
};

function ts(text) {
    if (!text) return '';
    let r = text;
    for (const [t, s] of Object.entries(SIMP)) r = r.split(t).join(s);
    return r;
}

function pm(json) {
    try {
        const o = JSON.parse(json);
        return { m: ts(o['核心释义'] || ''), p: o['词性'] || '', s: ts(o['例句'] || '') };
    } catch { return { m: '', p: '', s: '' }; }
}

async function main() {
    const wb = XLSX.readFile('单词机器人-数据 副本_生产-单词表.xlsx');
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    console.log('Excel:', rows.length, '行');
    
    const st = { yusi: {t:0, m:0}, qiuqiu: {t:0, m:0} };
    
    for (const row of rows) {
        const w = (row['单词'] || '').toString().trim();
        if (!w) continue;
        const u = row['录入人'] || 'yusi';
        if (!st[u]) st[u] = {t:0, m:0};
        st[u].t++;
        const im = row['状态'] === '已记住';
        
        await add(WORD_APP, WORD_TABLE, { Word: w, user: u, Error_Count: 0, record_time: Date.now() });
        
        const p = pm(row['释义JSON'] || '{}');
        const pos = p.p.includes('verb') ? 'v' : p.p.includes('adj') ? 'adj' : 'n';
        const ds = pos === 'v' ? 'receive,obtain,acquire,achieve' : pos === 'adj' ? 'attractive,appealing,charming,elegant' : 'instance,example,case,sample';
        const ctx = p.s ? p.s.replace(new RegExp(w, 'gi'), '___') : 'The word "' + w + '" is used.';
        
        await add(DIST_APP, DIST_TABLE, { Word: w, POS: pos, Meaning: p.m || w, Distractors: ds, Context: ctx, Translation: p.m });
    }
    
    console.log('\n导入完成');
    for (const [u, s] of Object.entries(st)) console.log(u + ': ' + s.t + '条');
}

main();
