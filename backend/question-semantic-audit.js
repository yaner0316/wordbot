const { buildMiniMaxRequestBody, getMiniMaxSettings } = require('./minimax-settings');

const CURRENT_SEMANTIC_AUDIT_POLICY_VERSION = 'unique-answer-v2';

function buildAttestedQuestionSourceVersion(baseVersion) {
    return `${String(baseVersion || 'v1').trim()}|${CURRENT_SEMANTIC_AUDIT_POLICY_VERSION}`;
}

function extractJson(text) {
    const match = String(text || '').match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch (_) { return null; }
}

async function callMiniMax(prompt) {
    const apiKey = process.env.MINIMAX_API_KEY;
    if (!apiKey || typeof fetch !== 'function') throw new Error('semantic_audit_unavailable');
    const settings = getMiniMaxSettings();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
    try {
        const response = await fetch('https://api.minimax.chat/v1/text/chatcompletion_v2', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
            body: JSON.stringify(buildMiniMaxRequestBody(prompt)),
            signal: controller.signal,
        });
        if (!response.ok) throw new Error('semantic_audit_http_' + response.status);
        const payload = await response.json();
        return payload?.choices?.[0]?.message?.content || '';
    } finally {
        clearTimeout(timer);
    }
}

async function auditUniqueAnswer(question, { callModel = callMiniMax } = {}) {
    const answer = String(question?.answer || '').trim().toUpperCase();
    const prompt = [
        'Audit this child vocabulary fill-in question for semantic uniqueness.',
        'Judge each option in the exact sentence, not merely its dictionary meaning.',
        'Reject the question if any other option can plausibly complete the sentence in ordinary child-facing English.',
        'Do not accept a merely better answer: approve only when every other option is clearly wrong in this exact context.',
        'Return JSON only: {"validLetters":["A"],"certain":true,"reason":"short reason"}.',
        'If more than one option could naturally fit, list all of them. If uncertain, set certain false.',
        JSON.stringify({ context: question?.context, options: question?.options, optionMeanings: question?.optionMeanings, expectedAnswer: answer }),
    ].join('\n');
    try {
        const parsed = extractJson(await callModel(prompt));
        const validLetters = Array.isArray(parsed?.validLetters)
            ? [...new Set(parsed.validLetters.map(value => String(value).trim().toUpperCase()).filter(value => /^[A-D]$/.test(value)))]
            : [];
        const approved = parsed?.certain === true && validLetters.length === 1 && validLetters[0] === answer;
        return {
            approved,
            status: approved ? 'approved' : 'rejected',
            validLetters,
            reason: String(parsed?.reason || '').slice(0, 200),
            policyVersion: CURRENT_SEMANTIC_AUDIT_POLICY_VERSION,
        };
    } catch (error) {
        return {
            approved: false,
            status: 'unavailable',
            validLetters: [],
            reason: 'semantic audit unavailable',
            policyVersion: CURRENT_SEMANTIC_AUDIT_POLICY_VERSION,
        };
    }
}

module.exports = { CURRENT_SEMANTIC_AUDIT_POLICY_VERSION, buildAttestedQuestionSourceVersion, auditUniqueAnswer };
