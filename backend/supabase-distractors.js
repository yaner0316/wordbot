const https = require('https');
const { selectContextualDistractors } = require('./generate-distractors');

async function callMiniMax(prompt, timeout = 15000) {
    const apiKey = process.env.MINIMAX_API_KEY;
    if (!apiKey || typeof fetch !== 'function') throw new Error('MiniMax client unavailable');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch('https://api.minimax.chat/v1/text/chatcompletion_v2', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
            body: JSON.stringify({ model: 'MiniMax-M2.7', messages: [{ role: 'user', content: prompt }] }),
            signal: controller.signal,
        });
        if (!response.ok) throw new Error('MiniMax HTTP ' + response.status);
        const result = await response.json();
        return result.choices?.[0]?.message?.content || '';
    } finally {
        clearTimeout(timer);
    }
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