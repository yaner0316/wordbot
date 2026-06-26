const { inflectWord } = require('./word-inflector');

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
        'what you would like me to do',
        'what you would like me to help',
        'what you would like me to do with it',
        'could you please let me know',
        'please let me know what you need',
        'please let me know what you would like',
        'what would you like me to do',
        'how you would like me to help',
        'message you sent contains a large amount of garbled or encoded text',
        'message you sent contains a very long',
        'text you provided appears to be corrupted or garbled',
        "can't make sense of the text you've provided",
        'seemingly garbled or encoded',
        'large block of text that appears',
        '您好',
        '您提供的内容',
        '您发送的',
        '请告诉我您的具体需求',
        '我将竭诚为您提供帮助',
        '我会尽力为您提供帮助',
        '无法理解您发送的这段文字',
    ];
    if (directMarkers.some(marker => value.includes(marker.toLowerCase()))) return true;
    const helpIntentMarkers = ['translation', 'decoding', 'de-ciphering', 'deciphering', 'analysis'];
    const metaMarkerCount = helpIntentMarkers.filter(marker => value.includes(marker)).length;
    if (value.includes('chinese characters') && metaMarkerCount >= 2) return true;
    const taskRequestMarkers = ['could you let me know', 'could you please let me know', 'please let me know', 'what you would like me to do', 'what would you like me to do'];
    const inputDescriptionMarkers = ['text you provided', 'text you shared', 'message you sent', 'you sent contains', 'you provided appears', 'you shared a', 'garbled or encoded text', 'garbled string'];
    if (taskRequestMarkers.some(marker => value.includes(marker)) && inputDescriptionMarkers.some(marker => value.includes(marker))) return true;
    const chineseHelpMarkers = ['翻译', '摘要', '提取关键信息', '解释', '纠错', '其他需求', '具体需求'];
    const chineseMetaCount = chineseHelpMarkers.filter(marker => value.includes(marker)).length;
    return (value.includes('您希望') || value.includes('您想让我') || value.includes('您是想让我')) && chineseMetaCount >= 2;
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

function hasMeaningfulChineseMeaning(value) {
    const cn = String(value || '').trim();
    return cn.length > 0 && cn.length <= 50 && /[一-鿿]/.test(cn) && !hasAiMetaResponse(cn);
}

function hasDistractorFormOverlap(word, question) {
    const forms = new Set(
        ['third_singular', 'past', 'past_participle', 'present_participle']
            .map(formKey => inflectWord(word, formKey))
            .filter(form => form !== word)
    );
    const answerPrefix = `${question.answer}.`;
    return (question.options || [])
        .filter(option => !String(option || '').startsWith(answerPrefix))
        .map(stripOptionLabel)
        .some(distractor => forms.has(distractor));
}

function isQuestionQualityAcceptable(question) {
    if (!question) return false;
    if (Number(question.type) === 3) {
        if (!hasMeaningfulChineseMeaning(question.context)) return false;
    } else if (hasAiMetaResponse(question.context)) {
        return false;
    }
    if (hasAiMetaResponse(question.correctMeaning)) question.correctMeaning = '';
    if (Number(question.type) === 2) {
        const word = String(question.word || '').toLowerCase();
        const context = String(question.context || '').toLowerCase();
        if (word && context && new RegExp(`\\b${escapeRegExp(word)}\\b`).test(context)) return false;
    }
    if (Number(question.type) !== 1) return true;
    const answerPrefix = `${question.answer}.`;
    const word = stripOptionLabel(
        (question.options || []).find(option => String(option || '').startsWith(answerPrefix)) ||
        question.word
    );
    const context = String(question.context || '').replace(/_{3,}/g, word);
    return !hasInvalidFillInGrammar({ word, context }) &&
        !hasDistractorFormOverlap(word, question);
}

module.exports = {
    hasAiMetaResponse,
    hasMeaningfulChineseMeaning,
    hasInvalidFillInGrammar,
    isQuestionQualityAcceptable,
};
