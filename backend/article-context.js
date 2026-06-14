function normalizeArticleContext(context) {
    if (!context) return { text: context, normalized: false };
    const text = context
        .replace(/\ban\s+_____/gi, 'a(n) _____')
        .replace(/\ba\s+_____/gi, 'a(n) _____');
    return {
        text,
        normalized: text !== context,
    };
}

function normalizeQuizArticleContexts(questions) {
    for (const question of questions) {
        if (question.type !== 1) continue;
        const normalized = normalizeArticleContext(question.context);
        question.context = normalized.text;
        if (normalized.normalized) question.articleNormalized = true;
    }
    return questions;
}

module.exports = {
    normalizeArticleContext,
    normalizeQuizArticleContexts,
};
