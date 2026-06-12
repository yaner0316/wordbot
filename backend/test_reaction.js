require('dotenv').config();

const https = require('https');
const { execSync } = require('child_process');

function exec(command) {
    try {
        return execSync(command, { encoding: 'utf8', timeout: 20000 });
    } catch (e) {
        return null;
    }
}

function translateToCN(text) {
    if (!text) return null;
    const prompt = `翻译成中文（只返回翻译结果）：${text}`;
    try {
        const escapedPrompt = prompt.replace(/"/g, '\\"');
        const result = exec(`mmx text chat --message "${escapedPrompt}" --output json`);
        const textMatch = result.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (textMatch) {
            return textMatch[1].replace(/\\"/g, '"').replace(/\\n/g, ' ').trim();
        }
    } catch (e) { }
    return null;
}

function generateDistractors(word, meaning) {
    const prompt = `为单词 ${word} 生成3个含义相近的英文干扰词，返回JSON：{"distractors": ["word1", "word2", "word3"]}`;
    try {
        const escapedPrompt = prompt.replace(/"/g, '\\"');
        const result = exec(`mmx text chat --message "${escapedPrompt}" --output json`);
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

function generateExample(word, meaning) {
    const prompt = `为单词 ${word} 生成一个英文例句，返回JSON：{"example": "例句"}`;
    try {
        const escapedPrompt = prompt.replace(/"/g, '\\"');
        const result = exec(`mmx text chat --message "${escapedPrompt}" --output json`);
        const textMatch = result.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (textMatch) {
            const innerJson = textMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
            const exampleMatch = innerJson.match(/"example"\s*:\s*"([^"]+)"/);
            if (exampleMatch) {
                return exampleMatch[1];
            }
        }
    } catch (e) { }
    return null;
}

async function testWord(word) {
    console.log(`\n测试单词: ${word}\n`);
    
    console.log('1. 生成干扰词...');
    const distractors = generateDistractors(word, 'a response to something');
    console.log(`   干扰词: ${distractors ? distractors.join(', ') : '失败'}`);
    
    console.log('\n2. 生成例句...');
    const example = generateExample(word, 'a response to something');
    console.log(`   例句: ${example ? example.substring(0, 50) + '...' : '失败'}`);
    
    console.log('\n3. 翻译中文释义...');
    const cnMeaning = translateToCN('a response to something');
    console.log(`   中文释义: ${cnMeaning || '失败'}`);
    
    console.log('\n=== 最终结果 ===');
    console.log(`单词: ${word}`);
    console.log(`英文释义: a response to something`);
    console.log(`中文释义: ${cnMeaning}`);
    console.log(`干扰词: ${distractors ? distractors.join(', ') : '无'}`);
    console.log(`例句: ${example || '无'}`);
}

testWord('reaction');