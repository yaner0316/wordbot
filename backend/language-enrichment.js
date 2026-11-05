const {levelGuidance} = require('./high-school-fit');
const LEVEL_DESCRIPTIONS = Object.fromEntries(['小学','中学','高中','CET4_6_TOEFL'].map(level => [level, levelGuidance(level)]));

function withTimeout(promise, timeoutMs, label = 'operation') {
    let timer = null;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function createContextDifficultyAdapter({ callAI, timeoutMs = 12000 }) {
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
- For Type2: rewrite the definition/explanation with level-appropriate vocabulary. At elementary level, completely replace technical or formal definitions with the simplest possible child-friendly explanation (e.g. for "smile": "The happy look on your face when you feel good" not an anatomy description)
- Write natural standalone quiz text only. Do not add meta commentary such as "which clearly illustrates how the word is used".
- Avoid repeating the same sentence frame across questions.

Return JSON ONLY: {"rewrites": [{"index":1,"text":"rewritten version with _____ if type1"},{"index":2,"text":"..."}]}`;

        try {
            const response = await withTimeout(callAI(prompt), timeoutMs, 'context difficulty rewrite');
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
