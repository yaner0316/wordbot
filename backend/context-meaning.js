const { hasAiMetaResponse } = require('./question-quality');

function cleanContextualMeaning(value) {
    let meaning = String(value || '').trim();
    if (!meaning) return '';
    meaning = meaning.split(/\r?\n/)[0].trim();
    meaning = meaning
        .replace(/^中文释义[:：]\s*/i, '')
        .replace(/^释义[:：]\s*/i, '')
        .replace(/^答案[:：]\s*/i, '')
        .replace(/^[-*\d.、\s]+/, '')
        .replace(/["'“”‘’]/g, '')
        .trim();
    if (!meaning || hasAiMetaResponse(meaning)) return '';
    if (!/[\u4e00-\u9fff]/.test(meaning)) return '';
    if (meaning.length > 10) return '';
    return meaning;
}

async function enrichContextualCorrectMeanings(
    questions,
    { generateContextMeaning } = {}
) {
    if (!Array.isArray(questions) || typeof generateContextMeaning !== 'function') {
        return questions;
    }
    const cache = new Map();
    for (const question of questions) {
        if (Number(question?.type) !== 1) continue;
        const word = String(question.word || '').trim();
        const context = String(question.context || '').trim();
        if (!word || !context) continue;
        const key = word.toLowerCase() + '\n' + context;
        try {
            if (!cache.has(key)) {
                cache.set(key, Promise.resolve(generateContextMeaning(word, context)));
            }
            const contextualMeaning = cleanContextualMeaning(await cache.get(key));
            if (contextualMeaning) question.correctMeaning = contextualMeaning;
        } catch (error) {
            // Keep the dictionary meaning when context-specific enrichment fails.
        }
    }
    return questions;
}

module.exports = {
    cleanContextualMeaning,
    enrichContextualCorrectMeanings,
};
