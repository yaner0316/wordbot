const { execSync } = require('child_process');

const prompt = `为单词 test 生成3个干扰词，返回JSON：{"distractors": ["a", "b", "c"]}`;

const escapedPrompt = prompt.replace(/"/g, '\\"');
const result = execSync(`mmx text chat --message "${escapedPrompt}" --output json`, { encoding: 'utf8', timeout: 20000 });

console.log('=== STEP 1: Extract text field ===');
const textMatch = result.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
if (textMatch) {
    console.log('Found text field');
    const innerJson = textMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
    console.log('Inner JSON:', innerJson);
    
    console.log('\n=== STEP 2: Extract distractors ===');
    const distMatch = innerJson.match(/"distractors"\s*:\s*\[(.*?)\]/s);
    if (distMatch) {
        console.log('Found distractors array');
        const words = distMatch[1].match(/"([^"]+)"/g);
        if (words) {
            console.log('Words:', words.map(w => w.replace(/"/g, '')));
        }
    }
} else {
    console.log('No text field found');
}