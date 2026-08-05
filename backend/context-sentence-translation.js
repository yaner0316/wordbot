'use strict';

function compactChinese(value) {
    return String(value || '').replace(/[^\u3400-\u9fff]/g, '').trim();
}

function hasChineseSentenceTranslation(value) {
    return compactChinese(value).length > 0;
}

function englishWordCount(value) {
    return (String(value || '').match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g) || []).length;
}

function getContextTranslationIssues(question) {
    if (Number(question?.type) !== 1) return [];

    const translation = String(question?.contextCN || '').trim();
    if (!hasChineseSentenceTranslation(translation)) return ['missing_context_translation'];
    const translationChinese = compactChinese(translation);

    const correctMeaningChinese = compactChinese(question?.correctMeaning);
    if (correctMeaningChinese && translationChinese === correctMeaningChinese) {
        return ['context_translation_is_meaning'];
    }

    const stemWordCount = englishWordCount(question?.context);
    const minimumChineseLength = Math.max(6, Math.ceil(stemWordCount * 0.5));
    if (stemWordCount >= 6 && translationChinese.length < minimumChineseLength) {
        return ['context_translation_too_short'];
    }

    return [];
}

function isContextSentenceTranslationAcceptable(question) {
    return getContextTranslationIssues(question).length === 0;
}

module.exports = {
    getContextTranslationIssues,
    hasChineseSentenceTranslation,
    isContextSentenceTranslationAcceptable,
};
