const { execSync } = require('child_process');

const prompt = `为单词 test 生成3个干扰词，返回JSON：{"distractors": ["a", "b", "c"]}`;

try {
    const escapedPrompt = prompt.replace(/"/g, '\\"');
    const result = execSync(`mmx text chat --message "${escapedPrompt}" --output json`, { encoding: 'utf8', timeout: 20000 });
    console.log('=== RAW OUTPUT ===');
    console.log(result);
    console.log('=== END ===');
} catch (e) {
    console.log('ERROR:', e.message);
}