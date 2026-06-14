const LEVEL_DESCRIPTIONS = {
    '小学': 'elementary school level (use very simple daily words, 6-8 year old vocabulary)',
    '中学': 'middle school level (common vocabulary, straightforward sentences, 12-15 year old)',
    '高中': 'high school level (moderately complex vocabulary and sentence structures)',
    CET4_6_TOEFL: 'college/TOEFL level (academic vocabulary, complex sentence structures)',
};

function createContextDifficultyAdapter({ callAI }) {
    function isTemplatedMetaRewrite(text) {
        const lower = String(text || '').toLowerCase();
        return [
            'which clearly illustrates how the word',
            'illustrates how the word',
            'demonstrates how the word',
            'shows how the word',
            'the word _____ is used',
            'the word is used',
        ].some(pattern => lower.includes(pattern));
    }

    return async function adaptContextsByLevel(questions, level) {
        if (!level || level === '全部') return true;
        const description = LEVEL_DESCRIPTIONS[level];
        if (!description) return false;

        const adaptable = questions.filter(
            question => question.type === 1 || question.type === 2
        );
        if (adaptable.length === 0) return true;

        const questionText = adaptable.map((question, index) => {
            if (question.type === 1) {
                return [
                    `Q${index + 1} [Type1 fill-in-blank]:`,
                    `Word: "${question.word}"`,
                    `Original: "${question.context}"`,
                    `Options: ${(question.options || []).join(', ')}`,
                    '---',
                ].join('\n');
            }
            return [
                `Q${index + 1} [Type2 definition]:`,
                `Word: "${question.word}"`,
                `Original definition: "${question.context}"`,
                `Options: ${(question.options || []).join(', ')}`,
                '---',
            ].join('\n');
        }).join('\n');

        const prompt = `${questionText}

Rewrite ALL ${adaptable.length} questions at ${description}.
- For Type1: rewrite the context sentence (keep _____ blank and word meaning the same, but use level-appropriate vocabulary)
- For Type2: rewrite the definition/explanation with level-appropriate vocabulary
- Write natural standalone quiz text only. Do not add meta commentary such as "which clearly illustrates how the word is used".
- Avoid repeating the same sentence frame across questions.

Return JSON ONLY: {"rewrites": [{"index":1,"text":"rewritten version with _____ if type1"},{"index":2,"text":"..."}]}`;

        try {
            const response = await callAI(prompt);
            if (!response) return false;
            const match = response.match(/\{[\s\S]*\}/);
            if (!match) return false;
            const parsed = JSON.parse(match[0]);
            if (!Array.isArray(parsed.rewrites)) return false;
            let appliedCount = 0;
            for (const rewrite of parsed.rewrites) {
                const index = rewrite.index - 1;
                if (
                    index >= 0 &&
                    index < adaptable.length &&
                    typeof rewrite.text === 'string' &&
                    rewrite.text.trim().length > 3 &&
                    !isTemplatedMetaRewrite(rewrite.text)
                ) {
                    adaptable[index].context = rewrite.text.trim();
                    appliedCount += 1;
                }
            }
            return appliedCount > 0;
        } catch {
            return false;
        }
    };
}

module.exports = {
    LEVEL_DESCRIPTIONS,
    createContextDifficultyAdapter,
};
