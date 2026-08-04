/**
 * LLM-assisted distractor generation for fill-in-the-blank quiz questions.
 */

async function selectContextualDistractors({ word, meaning, context, candidates, excludedDistractors = [], callLLM }) {
    const referenceList = (candidates || []).slice(0, 8).join(', ');
    const exclusionList = (excludedDistractors || [])
        .map(value => String(value || '').trim())
        .filter(Boolean)
        .join(', ');
    const prompt = [
        'Create exactly 3 wrong options for this vocabulary fill-in quiz.',
        `Correct answer: "${word}"`,
meaning ? `Required meaning: "${String(meaning).trim()}"` : '',
        `Sentence: "${context.replace(/_____/g, '___')}"`,
        referenceList ? `Difficulty reference only: ${referenceList}` : '',
        exclusionList ? `Prior-stem distractors: ${exclusionList}. Reuse at most one.` : '',
        'Each distractor must be exactly one English word using letters or one apostrophe; never use a phrase or hyphen.',
        'Use the same part of speech and similar difficulty as the answer.',
        'Prefer the same semantic category, but every option must be clearly wrong in this sentence.',
        `Never repeat "${word}". Return only JSON: {"distractors":["word1","word2","word3"]}`,
    ].filter(Boolean).join('\n');

    const raw = await callLLM(prompt).catch(() => '');
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

    return clean;
}

module.exports = { selectContextualDistractors };
