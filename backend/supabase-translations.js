const https = require('https');
const { hasMeaningfulChineseMeaning } = require('./question-quality');

function callMiniMax(prompt, timeout = 30000) {
    return new Promise((resolve, reject) => {
        const apiKey = process.env.MINIMAX_API_KEY;
        if (!apiKey) {
            reject(new Error('MINIMAX_API_KEY not set'));
            return;
        }
        const body = JSON.stringify({
            model: 'MiniMax-M2.7',
            messages: [{ role: 'user', content: prompt }],
        });
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
        }, timeout);
        request.on('close', () => clearTimeout(timer));
        request.write(body);
        request.end();
    });
}

async function translateSupabaseWords(words) {
    const uniqueWords = [...new Set((words || []).map(word => String(word || '').trim().toLowerCase()).filter(Boolean))];
    if (!uniqueWords.length) return {};
    const prompt = [
        'Translate each English vocabulary word to Simplified Chinese.',
        'Return ONLY a JSON object mapping each input word to a concise Chinese meaning.',
        'Do not return English, explanations, or pinyin.',
        'Words: ' + JSON.stringify(uniqueWords),
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