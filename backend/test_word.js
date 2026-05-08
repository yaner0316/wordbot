const { execSync } = require('child_process');

const word = 'tenant';

console.log(`测试单词: ${word}\n`);

// 测试干扰词生成
console.log('=== 生成干扰词 ===');
const distPrompt = `为单词 ${word} 生成3个含义相近的英文干扰词，返回JSON：{"distractors": ["word1", "word2", "word3"]}`;
try {
    const distResult = execSync(`mmx text chat --message "${distPrompt.replace(/"/g, '\\"')}" --output json`, { encoding: 'utf8', timeout: 20000 });
    const textMatch = distResult.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (textMatch) {
        const innerJson = textMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
        const distMatch = innerJson.match(/"distractors"\s*:\s*\[(.*?)\]/s);
        if (distMatch) {
            const words = distMatch[1].match(/"([^"]+)"/g);
            if (words) {
                console.log('干扰词:', words.map(w => w.replace(/"/g, '')));
            }
        }
    }
} catch (e) {
    console.log('失败:', e.message);
}

// 测试例句生成
console.log('\n=== 生成例句 ===');
const exPrompt = `为单词 ${word} 生成一个英文例句，返回JSON：{"example": "例句"}`;
try {
    const exResult = execSync(`mmx text chat --message "${exPrompt.replace(/"/g, '\\"')}" --output json`, { encoding: 'utf8', timeout: 20000 });
    const textMatch = exResult.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (textMatch) {
        const innerJson = textMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
        const exampleMatch = innerJson.match(/"example"\s*:\s*"([^"]+)"/);
        if (exampleMatch) {
            console.log('例句:', exampleMatch[1]);
        }
    }
} catch (e) {
    console.log('失败:', e.message);
}