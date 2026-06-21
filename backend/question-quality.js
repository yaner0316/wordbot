function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripOptionLabel(option) {
    return String(option || '').replace(/^[A-D]\.\s*/i, '').trim().toLowerCase();
}

function isLikelyPluralNoun(word) {
    const value = String(word || '').trim().toLowerCase();
    return value.length > 3 && value.endsWith('s') && !value.endsWith('ss');
}

function hasAiMetaResponse(text) {
    const value = String(text || '').toLowerCase();
    if (!value) return false;
    const directMarkers = [
        "the text you've shared looks like",
        'the text you have shared looks like',
        'could you let me know',
        "i'll be happy to help",
        'i will be happy to help',
        'would you like:',
    ];
    if (directMarkers.some(marker => value.includes(marker))) return true;
    const helpIntentMarkers = ['translation', 'decoding', 'de-ciphering', 'deciphering', 'analysis'];
    const metaMarkerCount = helpIntentMarkers.filter(marker => value.includes(marker)).length;
    return value.includes('chinese characters') && metaMarkerCount >= 2;
}

function hasPluralListMismatch(word, context) {
    const key = String(word || '').toLowerCase();
    const text = String(context || '').toLowerCase();
    if (!key || key.endsWith('s')) return false;
    const escaped = escapeRegExp(key);
    const match = text.match(new RegExp(`([^.?!]*,\\s*and\\s+)${escaped}\\b`));
    if (!match) return false;
    const prefix = match[1] || '';
    const listItems = prefix
        .split(',')
        .map(item => item.trim().replace(/\band\s+$/i, ''))
        .filter(Boolean);
    const pluralItems = listItems.filter(item => {
        const lastWord = (item.match(/[a-z]+$/i) || [''])[0].toLowerCase();
        return isLikelyPluralNoun(lastWord);
    });
    return listItems.length >= 2 && pluralItems.length >= 2;
}

function hasNumericQuantitySingularMismatch(word, context) {
    const key = String(word || '').trim().toLowerCase();
    if (!key || key.endsWith('s')) return false;
    const text = String(context || '').toLowerCase();
    const quantity = '(?:two|three|four|five|six|seven|eight|nine|ten|\\d+)';
    const escaped = escapeRegExp(key);
    return new RegExp(`\\b${quantity}\\s+${escaped}\\s+of\\b`).test(text);
}

function hasInvalidFillInGrammar({ word, context }) {
    return hasPluralListMismatch(word, context) ||
        hasNumericQuantitySingularMismatch(word, context);
}

function isQuestionQualityAcceptable(question) {
    if (!question) return false;
    if (hasAiMetaResponse(question.context) || hasAiMetaResponse(question.correctMeaning)) return false;
    if (Number(question.type) !== 1) return true;
    const answerPrefix = `${question.answer}.`;
    const word = stripOptionLabel(
        (question.options || []).find(option => String(option || '').startsWith(answerPrefix)) ||
        question.word
    );
    const context = String(question.context || '').replace(/_{3,}/g, word);
    return !hasInvalidFillInGrammar({ word, context });
}

module.exports = {
    hasAiMetaResponse,
    hasInvalidFillInGrammar,
    isQuestionQualityAcceptable,
};