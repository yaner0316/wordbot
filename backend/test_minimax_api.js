require('dotenv').config();

const https = require('https');

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;

console.log('API Key:', MINIMAX_API_KEY ? '已加载' : '未设置');

if (!MINIMAX_API_KEY) {
    console.log('请设置 MINIMAX_API_KEY 环境变量');
    console.log('本地: 创建 .env 文件或 export MINIMAX_API_KEY=xxx');
    console.log('服务器: 在 Render 环境变量中添加');
    process.exit(1);
}

function callMiniMax(prompt) {
    return new Promise((resolve, reject) => {
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

async function test() {
    console.log('\n=== 测试干扰词生成 ===');
    const word = 'tenant';
    const prompt = `为单词 ${word} 生成3个含义相近的英文干扰词，返回JSON：{"distractors": ["word1", "word2", "word3"]}`;

    try {
        const result = await callMiniMax(prompt);
        console.log('原始响应:', result);

        const match = result.match(/"distractors"\s*:\s*\[(.*?)\]/s);
        if (match) {
            const words = match[1].match(/"([^"]+)"/g);
            console.log('干扰词:', words?.map(w => w.replace(/"/g, '')));
        }
    } catch (e) {
        console.log('失败:', e.message);
    }

    console.log('\n=== 测试例句生成 ===');
    const exPrompt = `为单词 ${word} 生成一个英文例句，返回JSON：{"example": "例句"}`;

    try {
        const result = await callMiniMax(exPrompt);
        console.log('原始响应:', result);

        const match = result.match(/"example"\s*:\s*"([^"]+)"/);
        if (match) {
            console.log('例句:', match[1]);
        }
    } catch (e) {
        console.log('失败:', e.message);
    }
}

test();