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


const ELEMENTARY_LEVEL = String.fromCharCode(0x5c0f, 0x5b66);
const CN = {
    chest: String.fromCharCode(0x80f8, 0x90e8),
    cheek: String.fromCharCode(0x8138, 0x988a),
    mud: String.fromCharCode(0x6ce5),
    pepper: String.fromCharCode(0x80e1, 0x6912),
    lamb: String.fromCharCode(0x7f8a, 0x7f94),
};

function isElementaryLevel(level) {
    const value = String(level || '').trim().toLowerCase();
    return value === ELEMENTARY_LEVEL || value === 'elementary' || value.includes('elementary school');
}

function getOptionWord(option) {
    return stripOptionLabel(option).replace(/[^a-z\s'-]/gi, '').trim();
}

function getCorrectOptionWord(question) {
    const answerPrefix = String(question.answer || '') + '.';
    const answerOption = (question.options || []).find(option =>
        String(option || '').startsWith(answerPrefix)
    );
    return getOptionWord(answerOption || question.word);
}

function getDistractorWords(question) {
    const answerPrefix = String(question.answer || '') + '.';
    return (question.options || [])
        .filter(option => !String(option || '').startsWith(answerPrefix))
        .map(getOptionWord)
        .filter(Boolean);
}

function hasDictionaryStyleDefinition(text) {
    const value = String(text || '').trim().toLowerCase();
    if (!value) return false;
    const patterns = [
        'the act of',
        'an act of',
        'characterized by',
        'a person who',
        'one who',
        'a thing that',
        'the quality of',
        'relating to',
        'consisting of',
        'usually of',
        'worn by',
        'or any two surfaces',
        'before or after exercise',
        'an edible plant',
        'an adult female',
        'of the species',
        'especially',
        'brassica',
        'var.',
        'having a head',
        'less than a year',
        'outer garment',
        'covers the body',
        'waist downwards',
        'each leg separately',
        'such as a part',
        'road or track',
        'not crooked or bent',
    ];
    return patterns.some(pattern => value.includes(pattern));
}

function hasElementaryContextRisk(text) {
    const value = String(text || '').toLowerCase();
    const riskyPatterns = [
        'campaign issues',
        'both parties',
        'brand awareness',
        '17th century',
        'artifacts',
        'brass lock',
        'museum',
        'ancient',
        'nominal fee',
        'barley',
        'ballparks',
        'young ewes',
        'shepherd',
        'execute',
        'padded mat',
    ];
    return riskyPatterns.some(pattern => value.includes(pattern));
}

function hasSenseMismatchRisk(question) {
    const word = String(question.word || '').trim().toLowerCase();
    const meaning = String(question.correctMeaning || '').trim();
    const context = String(question.context || '').toLowerCase();
    if (word === 'chest' && meaning.includes(CN.chest) && /\b(museum|ancient|lock|locked|secured|artifacts|treasure|box)\b/.test(context)) {
        return 'sense_mismatch_chest';
    }
    if (word === 'cheek' && meaning.includes(CN.cheek) && /(you['’]?ve got some|have some|asking me for money)/.test(context)) {
        return 'sense_mismatch_cheek';
    }
    if (word === 'mud' && meaning.includes(CN.mud) && /(campaign|both parties|politic|issues got lost)/.test(context)) {
        return 'sense_mismatch_mud';
    }
    if (word === 'pepper' && meaning.includes(CN.pepper) && /(pepper games|ballparks|no _____ games)/.test(context)) {
        return 'sense_mismatch_pepper';
    }
    if (word === 'lamb' && meaning.includes(CN.lamb) && /(lambing|young ewes|shepherd was up all night)/.test(context + ' ' + getCorrectOptionWord(question))) {
        return 'sense_mismatch_lamb';
    }
    return '';
}

function hasBadDistractorShape(question) {
    const correct = getCorrectOptionWord(question);
    const distractors = getDistractorWords(question);
    if (!correct || distractors.length < 3) return true;
    const correctIsSingleWord = /^[a-z]+(?:'[a-z]+)?$/i.test(correct);
    if (correctIsSingleWord && distractors.some(d => /\s/.test(d))) return true;
    if (distractors.some(d => d.length < 2 || d.length > 25)) return true;
    return false;
}

function getQuestionQualityIssues(question) {
    const issues = [];
    if (!question) return ['missing_question'];
    const type = Number(question.type);
    if (type === 3) {
        if (!hasMeaningfulChineseMeaning(question.context)) issues.push('bad_chinese_meaning');
    } else if (hasAiMetaResponse(question.context)) {
        issues.push('ai_meta_context');
    }
    if (type === 2) {
        const word = String(question.word || '').toLowerCase();
        const context = String(question.context || '').toLowerCase();
        if (word && context && new RegExp('\\b' + escapeRegExp(word) + '\\b').test(context)) issues.push('answer_revealed_in_definition');
    }
    if (type === 1) {
        const word = getCorrectOptionWord(question);
        const baseWord = String(question.word || '').trim().toLowerCase();
        const rawContext = String(question.context || '');
        const context = rawContext.replace(/_{3,}/g, word);
        const baseContext = rawContext.replace(/_{3,}/g, baseWord);
        if (hasInvalidFillInGrammar({ word, context }) || hasInvalidFillInGrammar({ word: baseWord, context: baseContext })) issues.push('invalid_fill_in_grammar');
        if (hasDistractorFormOverlap(word, question)) issues.push('distractor_form_overlap');
    }
    if (isElementaryLevel(question.level)) {
        if ([1, 2, 3].includes(type) && hasBadDistractorShape(question)) issues.push('bad_distractor_shape');
        if (type === 1) {
            const mismatch = hasSenseMismatchRisk(question);
            if (mismatch) issues.push(mismatch);
            if (hasElementaryContextRisk(question.context)) issues.push('not_elementary_context');
        }
        if (type === 2 && hasDictionaryStyleDefinition(question.context)) {
            issues.push('dictionary_definition');
        }
    }
    return [...new Set(issues)];
}

function isQuestionQualityAcceptable(question) {
    if (!question) return false;
    if (hasAiMetaResponse(question.correctMeaning)) question.correctMeaning = '';
    return getQuestionQualityIssues(question).length === 0;
}
module.exports = {
    hasAiMetaResponse,
    hasMeaningfulChineseMeaning,
    hasInvalidFillInGrammar,
    getQuestionQualityIssues,
    isQuestionQualityAcceptable,
};
