require('dotenv').config();

const https = require('https');

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;

if (!MINIMAX_API_KEY) {
    console.log('错误: MINIMAX_API_KEY 未设置');
    console.log('请创建 .env 文件，内容: MINIMAX_API_KEY=你的key');
    process.exit(1);
}

function callMiniMaxAPI(prompt) {
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
    console.log('测试 MiniMax API 调用\n');

    // 测试1: 翻译
    console.log('=== 测试翻译 ===');
    try {
        const prompt1 = '翻译成中文：The quick brown fox jumps over the lazy dog';
        const result1 = await callMiniMaxAPI(prompt1);
        console.log('原文:', prompt1.replace('翻译成中文：', ''));
        console.log('译文:', result1);
    } catch (e) {
        console.log('翻译失败:', e.message);
    }

    // 测试2: 生成例句
    console.log('\n=== 测试生成例句 ===');
    try {
        const prompt2 = '为单词 "event" 生成一个英文例句，返回JSON：{"example": "例句"}';
        const result2 = await callMiniMaxAPI(prompt2);
        console.log('响应:', result2);
        const match = result2.match(/"example"\s*:\s*"([^"]+)"/);
        if (match) {
            console.log('提取的例句:', match[1]);
        }
    } catch (e) {
        console.log('例句生成失败:', e.message);
    }

    // 测试3: 生成干扰词
    console.log('\n=== 测试生成干扰词 ===');
    try {
        const prompt3 = '为单词 "love" 生成3个含义相近的英文干扰词，返回JSON：{"distractors": ["word1", "word2", "word3"]}';
        const result3 = await callMiniMaxAPI(prompt3);
        console.log('响应:', result3);
        const match = result3.match(/"distractors"\s*:\s*\[(.*?)\]/s);
        if (match) {
            const words = match[1].match(/"([^"]+)"/g);
            if (words) {
                console.log('提取的干扰词:', words.map(w => w.replace(/"/g, '')));
            }
        }
    } catch (e) {
        console.log('干扰词生成失败:', e.message);
    }

    console.log('\n测试完成');
}

test();