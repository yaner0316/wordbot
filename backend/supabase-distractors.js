const { selectContextualDistractors } = require('./generate-distractors');
const { buildMiniMaxRequestBody, getMiniMaxSettings } = require('./minimax-settings');

async function callMiniMax(prompt, timeout) {
    const apiKey = process.env.MINIMAX_API_KEY;
    if (!apiKey || typeof fetch !== 'function') throw new Error('MiniMax client unavailable');
    const settings = getMiniMaxSettings();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout || settings.timeoutMs);
    try {
        const response = await fetch('https://api.minimax.chat/v1/text/chatcompletion_v2', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
            body: JSON.stringify(buildMiniMaxRequestBody(prompt)),
            signal: controller.signal,
        });
        if (!response.ok) throw new Error('MiniMax HTTP ' + response.status);
        const result = await response.json();
        return result.choices?.[0]?.message?.content || '';
    } finally {
        clearTimeout(timer);
    }
}

async function generateSupabaseDistractors({ word, meaning, context, candidates = [], excludedDistractors = [] }) {
    const actualContext = String(context || '').trim();
    if (!actualContext) return null;
    return selectContextualDistractors({
        word,
        meaning,
        context: actualContext,
        candidates,
        excludedDistractors,
        callLLM: prompt => callMiniMax(prompt),
    });
}

module.exports = { generateSupabaseDistractors };
