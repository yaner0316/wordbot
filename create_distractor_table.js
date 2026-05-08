const https = require('https');

const APP_ID = 'cli_a97e125f0ab89cb5';
const APP_SECRET = 'pppKJAybbiNqKIDB9hlvshTnXGPg7OVH';

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
    const res = await request('POST', '/open-apis/auth/v3/tenant_access_token/internal', { app_id: APP_ID, app_secret: APP_SECRET });
    return res.tenant_access_token;
}

async function createBitable(token) {
    return request('POST', '/open-apis/bitable/v1/apps', { name: '词汇干扰项库' }, token);
}

async function addFields(token, appToken, tableId) {
    const fields = [
        { field_name: 'Word', type: 1 },
        { field_name: 'POS', type: 3, property: { options: [{ name: 'n' }, { name: 'v' }, { name: 'adj' }, { name: 'adv' }] } },
        { field_name: 'Meaning', type: 1 },
        { field_name: 'Distractors', type: 1 },
        { field_name: 'Context', type: 1 },
        { field_name: 'Translation', type: 1 }
    ];
    for (const f of fields) {
        await request('POST', `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields`, f, token);
    }
}

async function addRecords(token, appToken, tableId, records) {
    for (const r of records) {
        await request('POST', `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`, { fields: r }, token);
    }
}

async function main() {
    const token = await getToken();
    console.log('创建干扰项库表格...');
    const bitable = await createBitable(token);
    
    if (bitable.code !== 0) {
        console.log('错误:', bitable.msg);
        return;
    }
    
    const appToken = bitable.data.app.app_token;
    const tableId = bitable.data.app.default_table_id;
    console.log('App Token:', appToken);
    console.log('Table ID:', tableId);
    
    console.log('添加字段...');
    await addFields(token, appToken, tableId);
    
    console.log('录入初始数据...');
    const initialRecords = [
        { 'Word': 'seize', 'POS': 'v', 'Meaning': '抓住；夺取', 'Distractors': 'grasp,snatch,grab', 'Context': 'You must ___ this rare opportunity before it\'s gone.', 'Translation': '你必须抓住这个难得的机会。' },
        { 'Word': 'delicate', 'POS': 'adj', 'Meaning': '精致的；脆弱的', 'Distractors': 'dainty,subtle,fine', 'Context': 'The ___ flower petals fell gently to the ground.', 'Translation': '精致的花瓣轻轻飘落到地上。' },
        { 'Word': 'confession', 'POS': 'n', 'Meaning': '忏悔；坦白', 'Distractors': 'admission,revelation,disclosure', 'Context': 'In his ___, he admitted to all charges.', 'Translation': '在坦白中，他承认了所有指控。' },
        { 'Word': 'commercial', 'POS': 'adj', 'Meaning': '商业的', 'Distractors': 'marketing,trade,business', 'Context': 'This is a ___ opportunity for our business expansion.', 'Translation': '这是我们业务扩张的商业机会。' },
        { 'Word': 'conduct', 'POS': 'v', 'Meaning': '指挥；进行', 'Distractors': 'perform,direct,manage', 'Context': 'The orchestra will ___ the symphony tonight.', 'Translation': '管弦乐队今晚将指挥这首交响曲。' },
        { 'Word': 'conduct', 'POS': 'n', 'Meaning': '行为；举止', 'Distractors': 'behavior,performance,management', 'Context': 'His ___ at the meeting was highly professional.', 'Translation': '他在会议上的表现非常专业。' },
        { 'Word': 'inherit', 'POS': 'v', 'Meaning': '继承', 'Distractors': 'receive,obtain,acquire', 'Context': 'She will ___ the family business after her father.', 'Translation': '她将在父亲之后继承家族企业。' },
        { 'Word': 'dusk', 'POS': 'n', 'Meaning': '黄昏', 'Distractors': 'sunset,twilight,evening', 'Context': 'At ___, the streetlights began to illuminate.', 'Translation': '黄昏时分，路灯开始亮起。' },
        { 'Word': 'grace', 'POS': 'n', 'Meaning': '优雅；恩典', 'Distractors': 'elegance,dignity,charm', 'Context': 'The dancer moved with perfect ___ and fluidity.', 'Translation': '舞者以完美的优雅和流畅移动。' },
        { 'Word': 'fairy', 'POS': 'n', 'Meaning': '仙女；精灵', 'Distractors': 'sprite,elf,pixie', 'Context': 'The ___ tale ended with a happy marriage.', 'Translation': '这个童话故事以幸福的婚姻结束。' },
        { 'Word': 'conference', 'POS': 'n', 'Meaning': '会议；研讨会', 'Distractors': 'symposium,gathering,seminar', 'Context': 'She attended a ___ about climate change.', 'Translation': '她参加了一个关于气候变化的会议。' },
        { 'Word': 'instance', 'POS': 'n', 'Meaning': '例子；情况', 'Distractors': 'example,case,occasion', 'Context': 'For ___, he was late due to traffic yesterday.', 'Translation': '例如，他昨天因交通堵塞迟到了。' },
        { 'Word': 'cushion', 'POS': 'n', 'Meaning': '垫子；缓冲', 'Distractors': 'pillow,pad,mattress', 'Context': 'She placed a soft ___ on the hard wooden chair.', 'Translation': '她在硬木椅上放了一个柔软的垫子。' },
        { 'Word': 'convey', 'POS': 'v', 'Meaning': '传达；运输', 'Distractors': 'transmit,communicate,express', 'Context': 'Colors can ___ emotions more effectively than words.', 'Translation': '颜色比语言更有效地传达情感。' },
        { 'Word': 'handsome', 'POS': 'adj', 'Meaning': '英俊的；慷慨的', 'Distractors': 'attractive,striking,good-looking', 'Context': 'The prince is tall and ___, loved by everyone.', 'Translation': '王子高大英俊，受每个人喜爱。' },
        { 'Word': 'patriotic', 'POS': 'adj', 'Meaning': '爱国的', 'Distractors': 'loyal,nationalistic,devoted', 'Context': 'He wore a ___ smile during the national ceremony.', 'Translation': '在国葬仪式上他露出爱国的微笑。' }
    ];
    
    await addRecords(token, appToken, tableId, initialRecords);
    
    console.log('\n干扰项库创建完成！');
    console.log(`URL: https://w1qe12a7pis.feishu.cn/base/${appToken}`);
}

main();
