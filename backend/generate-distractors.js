/**
 * LLM-assisted distractor generation for fill-in-the-blank quiz questions.
 */

const {miniMaxFallback} = require('./minimax-settings');
async function selectContextualDistractors({ word, meaning, level, context, candidates, excludedDistractors = [], rejectedAlternatives = [], callLLM }) {
    const referenceList = (candidates || []).slice(0, 8).join(', ');
    const exclusionList = (excludedDistractors || [])
        .map(value => String(value || '').trim())
        .filter(Boolean)
        .join(', ');
    const prompt = [
        'Pick 3 wrong quiz options.',
        `Correct answer: "${word}"`,
meaning ? `Required meaning: "${String(meaning).trim()}"` : '',
        `Sentence: "${context.replace(/_____/g, '___')}"`,
        referenceList ? `Level only: ${referenceList}` : '',
        exclusionList ? `Prior-stem distractors: ${exclusionList}. Reuse at most one.` : '',
        rejectedAlternatives.length ? `Do not output these earlier plausible alternatives: ${rejectedAlternatives.slice(-12).join(', ')}. The auditor found them valid. Broaden within the same category beyond interchangeable subtypes; every choice must contradict a stated clue.` : '',
        'Exactly one English word (letters or one apostrophe), never a phrase or hyphen.',
        'Use the same part of speech and similar difficulty as the answer.',
        `Choose plausible same-category words at level "${level || '\u4e2d\u5b66'}". Each must contradict the sentence. Chinese meaning must not repeat or contain another option's.`,
        'Name the broad category; pick its members, not unrelated objects.',
        `Never repeat "${word}". Return only JSON: {"category":"broad category","distractors":["word1","word2","word3"]}`,
    ].filter(Boolean).join('\n');

    const raw = await callLLM(prompt).catch(error => miniMaxFallback(error, ''));
    if (!raw) return null;

    const normalizedRaw = String(raw).replace(/```(?:json)?/gi, '').trim();
    let parsedDistractors = null;
    try {
        const parsed = JSON.parse(normalizedRaw);
        if (Array.isArray(parsed?.distractors)) parsedDistractors = parsed.distractors.map(String);
    } catch {}

    const match = normalizedRaw.match(/"distractors"\s*:\s*\[(.*?)\]/s);
    const tokens = parsedDistractors
        ? parsedDistractors.slice(0, 3).map(token => `"${token}"`)
        : match?.[1]?.match(/"([^"]+)"/g);
    if (!tokens || tokens.length < 3) return null;

    const targetLower = word.toLowerCase();
    const picked = tokens
        .slice(0, 3)
        .map(t => t.replace(/"/g, '').trim().toLowerCase());
    const clean = picked.filter(t =>
        t &&
        t !== targetLower &&
        t.length >= 2 &&
        t.length <= 25 &&
        /^[a-z]+(?:'[a-z]+)?$/i.test(t)
    );

    if (clean.length !== 3 || new Set(clean).size !== 3) return null;
    const rejected = new Set(rejectedAlternatives.map(value=>String(value || '').trim().toLowerCase()));
    if (clean.some(value=>rejected.has(value))) return null;

    return clean;
}

module.exports = { selectContextualDistractors };
