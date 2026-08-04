const https = require('https');
const { hasMeaningfulChineseMeaning } = require('./question-quality');
const { buildMiniMaxRequestBody, getMiniMaxSettings } = require('./minimax-settings');

function callMiniMax(prompt, timeout) {
    return new Promise((resolve, reject) => {
        const apiKey = process.env.MINIMAX_API_KEY;
        if (!apiKey) {
            reject(new Error('MINIMAX_API_KEY not set'));
            return;
        }
        const settings = getMiniMaxSettings();
        const body = JSON.stringify(buildMiniMaxRequestBody(prompt));
        const request = https.request({
            hostname: 'api.minimax.chat',
            path: '/v1/text/chatcompletion_v2',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + apiKey,
                'Content-Length': Buffer.byteLength(body),
            },
        }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => {
                try {
                    const result = JSON.parse(Buffer.concat(chunks).toString());
                    resolve(result.choices?.[0]?.message?.content || '');
                } catch (error) {
                    reject(error);
                }
            });
        });
        request.on('error', reject);
        const timer = setTimeout(() => {
            request.destroy(new Error('MiniMax translation timeout'));
        }, timeout || settings.timeoutMs);
        request.on('close', () => clearTimeout(timer));
        request.write(body);
        request.end();
    });
}

async function translateSupabaseWords(words) {
    const uniqueWords = [...new Set((words || []).map(word => String(word || '').trim().toLowerCase()).filter(Boolean))];
    if (!uniqueWords.length) return {};
    const prompt = [
        'Translate these English vocabulary words into concise Simplified Chinese:',
        JSON.stringify(uniqueWords),
        'Return only one JSON object mapping each original word to its Chinese meaning.',
    ].join('\n');
    try {
        const raw = await callMiniMax(prompt);
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) return {};
        const parsed = JSON.parse(match[0]);
        return Object.fromEntries(uniqueWords
            .map(word => [word, String(parsed[word] || '').trim()])
            .filter(([, meaning]) => hasMeaningfulChineseMeaning(meaning)));
    } catch (error) {
        return {};
    }
}

module.exports = { translateSupabaseWords };
