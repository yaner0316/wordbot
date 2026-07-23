const https = require('https');
const { selectContextualDistractors } = require('./generate-distractors');

function callMiniMax(prompt, timeout = 15000) {
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
            request.destroy(new Error('MiniMax request timeout'));
        }, timeout);
        request.on('close', () => clearTimeout(timer));
        request.write(body);
        request.end();
    });
}

async function generateSupabaseDistractors({ word, meaning }) {
    const context = 'The target word "' + word + '" means: ' + meaning + '.';
    return selectContextualDistractors({
        word,
        context,
        candidates: [],
        callLLM: prompt => callMiniMax(prompt),
    });
}

module.exports = { generateSupabaseDistractors };