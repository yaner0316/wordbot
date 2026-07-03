/**
 * LLM-assisted distractor generation for fill-in-the-blank quiz questions.
 *
 * Asks the model to generate 3 semantically appropriate wrong options for the
 * target word in context. The user's vocabulary is provided as a difficulty
 * calibration reference only — the model is free to generate words outside
 * that list to ensure semantic quality.
 */

async function selectContextualDistractors({ word, context, candidates, callLLM }) {
    const referenceList = (candidates || []).slice(0, 8).join(', ');
    const referenceNote = referenceList
        ? `Reference vocabulary (use only to gauge the learner's difficulty level): ${referenceList}`
        : '';

    const prompt = `You are building a vocabulary fill-in-the-blank quiz question.

Correct answer: "${word}"
Sentence: "${context.replace(/_____/g, '___')}"
${referenceNote}

Generate exactly 3 distractor words for this question.
Rules:
1. Each distractor must be the same part of speech as "${word}".
2. Each distractor should be at a similar difficulty level to "${word}"${referenceList ? ' — use the reference vocabulary to calibrate difficulty' : ''}.
3. Each distractor must be clearly wrong in the given sentence context.
4. Prefer words in the same semantic category as "${word}" (similar objects, actions, or concepts) to make the question genuinely challenging rather than trivially easy.
5. Do not repeat the correct answer.

Return JSON only, no explanation: {"distractors": ["word1", "word2", "word3"]}`;

    const raw = await callLLM(prompt).catch(() => '');
    if (!raw) return null;

    const match = raw.match(/"distractors"\s*:\s*\[(.*?)\]/s);
    if (!match) return null;

    const tokens = match[1].match(/"([^"]+)"/g);
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
