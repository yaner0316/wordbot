/**
 * LLM-assisted distractor selection for fill-in-the-blank quiz questions.
 *
 * Given a word, its context sentence, and a pool of candidate words from the
 * user's vocabulary, asks the model to pick the 3 candidates that work best as
 * wrong options: same part-of-speech, similar difficulty, semantically plausible
 * in general English but clearly wrong in this specific sentence.
 */

async function selectContextualDistractors({ word, context, candidates, callLLM }) {
    if (!candidates || candidates.length < 3) return null;

    const candidateList = candidates.slice(0, 12).join(', ');
    const prompt = `You are building a vocabulary fill-in-the-blank quiz question.

Correct answer: "${word}"
Sentence: "${context.replace(/_____/g, '___')}"
Candidate wrong options: ${candidateList}

Pick exactly 3 candidates from the list above that make the best wrong options.
Rules:
1. Each pick must be from the candidate list — do not invent new words.
2. Each pick should be the same part of speech as "${word}".
3. Each pick should be at a similar vocabulary difficulty level to "${word}".
4. Each pick must be clearly wrong in the given sentence context.
5. Avoid picks that are too obviously unrelated (e.g. mixing basic and advanced vocabulary).

Return JSON only, no explanation: {"distractors": ["word1", "word2", "word3"]}`;

    const raw = await callLLM(prompt).catch(() => '');
    if (!raw) return null;

    const match = raw.match(/"distractors"\s*:\s*\[(.*?)\]/s);
    if (!match) return null;

    const tokens = match[1].match(/"([^"]+)"/g);
    if (!tokens || tokens.length < 3) return null;

    const picked = tokens
        .slice(0, 3)
        .map(t => t.replace(/"/g, '').trim().toLowerCase())
        .filter(Boolean);

    if (picked.length !== 3) return null;

    // Validate: all picks must come from the original candidate pool
    const candidateSet = new Set(candidates.map(c => c.toLowerCase()));
    if (!picked.every(p => candidateSet.has(p))) return null;

    return picked;
}

module.exports = { selectContextualDistractors };
