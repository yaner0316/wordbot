const { inflectWord } = require('./word-inflector');

const BAD_QUIZ_WORDS = new Set(['genaine']);

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
    crowded: String.fromCharCode(0x62e5, 0x6324),
};

function isElementaryLevel(level) {
    const value = String(level || '').trim().toLowerCase();
    return value === ELEMENTARY_LEVEL || value === 'elementary' || value.includes('elementary school');
}

function getOptionWord(option) {
    return stripOptionLabel(option).replace(/[^a-z\s'-]/gi, '').trim();
}

function isBadQuizWord(word) {
    return BAD_QUIZ_WORDS.has(String(word || '').trim().toLowerCase());
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
        'the act or result',
        'state of being',
        'an act of',
        'characterized by',
        'a person who',
        'one who',
        'a thing that',
        'the quality of',
        'relating to',
        'consisting of',
        'usually of',
        'now usually',
        'worn by',
        'or any two surfaces',
        'before or after exercise',
        'an edible plant',
        'a plant of the family',
        'an adult female',
        'of the species',
        'of the family',
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
        'secure convex lid',
        'convex',
        'fine grained',
        'sediment',
        'piperaceae',
        'a mixture of',
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
        'mare',
        'nuzzled',
        'newborn',
        'meadow',
        'door swing',
        'door _____',
        'which way the door opens',
        'of a flask',
        'violin',
        'sail, or ship',
        'pressed the bright',
        'wavy edges',
        'execute',
        'padded mat',
    ];
    return riskyPatterns.some(pattern => value.includes(pattern));
}

function hasAmbiguousElementaryContext(question) {
    const word = String(question.word || '').trim().toLowerCase();
    const context = String(question.context || '').toLowerCase().replace(/_{3,}/g, '_____');
    const optionWords = (question.options || []).map(getOptionWord).filter(Boolean);
    const optionSet = new Set(optionWords);
    const hasAll = words => words.every(item => optionSet.has(item));

    if (word === 'braided' && /wore _____ hair/.test(context) && hasAll(['straight', 'short', 'curly'])) {
        return true;
    }
    if (word === 'curly' && /has _____ hair/.test(context) && hasAll(['long', 'short', 'straight'])) {
        return true;
    }
    if (word === 'sweater' && /wore a warm _____/.test(context) && hasAll(['shirt', 'coat', 'jacket'])) {
        return true;
    }
    if (word === 'pants' && /wore blue _____ to school/.test(context) && hasAll(['shirt', 'shoes', 'socks'])) {
        return true;
    }
    const playgroundActionCount = optionWords.filter(item => PLAYGROUND_ACTION_WORDS.has(item)).length;
    if (playgroundActionCount >= 3 && /\b(?:kids|children)\s+_____\s+high\b/.test(context)) {
        return true;
    }

    const seasoningCount = optionWords.filter(item => SEASONING_WORDS.has(item)).length;
    if (seasoningCount >= 3 && /\bblack\s+_____\b.*\bsoup\b/.test(context)) {
        return true;
    }

    const hairColorCount = optionWords.filter(item => ELEMENTARY_HAIR_COLOR_WORDS.has(item)).length;
    if (hairColorCount >= 3) return true;

    const clothingCount = optionWords.filter(item => ELEMENTARY_CLOTHING_WORDS.has(item)).length;
    const hasWeakClothingContext = [
        /\b(?:put\s+on|puts\s+on|wear|wore|wears|wearing)\b.*\b(?:blue|red|green|yellow|black|white|warm|new|clean|school)\s+_____\b/,
        /\b(?:blue|red|green|yellow|black|white|warm|new|clean|school)\s+_____\b.*\b(?:school|home|morning|before\s+going|on\s+(?:his|her|their)\s+(?:legs|feet|body))\b/,
        /\b_____\b.*\b(?:before\s+going\s+to\s+school|to\s+school|at\s+school|on\s+(?:his|her|their)\s+(?:legs|feet|body))\b/,
    ].some(pattern => pattern.test(context));
    if (clothingCount >= 3 && hasWeakClothingContext) {
        return true;
    }

    const animalCount = optionWords.filter(item => ELEMENTARY_ANIMAL_WORDS.has(item)).length;
    const hasWeakAnimalContext = [
        /\byoung\s+_____\b.*\bmother\b/,
        /\bmother\b.*\byoung\s+_____\b/,
        /\b(?:happy|little|small|young)\s+_____\s+(?:wagged|wags|wagging|wag)\s+(?:its|his|her)\s+tail\b/,
        /\b_____\s+(?:ran|walked|played|jumped)\s+beside\s+(?:its|his|her)\s+mother\b/,
    ].some(pattern => pattern.test(context));
    if (animalCount >= 3 && hasWeakAnimalContext) {
        return true;
    }

    return false;
}
const FOOD_CATEGORY_WORDS = new Set([
    'lettuce', 'cucumber', 'celery', 'radish', 'carrot', 'tomato', 'cabbage',
    'spinach', 'pepper', 'onion', 'corn', 'broccoli', 'brocolli', 'potato',
    'bean', 'beans', 'pea', 'peas', 'apple', 'orange', 'banana', 'grape',
]);

const PUBLICATION_CATEGORY_WORDS = new Set([
    'book', 'textbook', 'magazine', 'novel', 'biography', 'article',
    'newspaper', 'journal', 'storybook', 'comic',
]);

const MATERIAL_CATEGORY_WORDS = new Set([
    'cotton', 'linen', 'wool', 'silk', 'nylon', 'polyester', 'leather',
    'denim', 'velvet', 'canvas', 'rubber', 'plastic', 'metal', 'steel',
    'wood', 'glass', 'paper', 'gold', 'silver',
]);

const SOUND_ADJECTIVE_WORDS = new Set([
    'strange', 'sudden', 'distant', 'quiet', 'loud', 'soft', 'faint',
    'sharp', 'muffled', 'weird', 'odd', 'unusual', 'clear', 'low', 'high',
]);

const OCEAN_ROUTE_WORDS = new Set([
    'atlantic', 'pacific', 'indian', 'arctic', 'southern', 'antarctic',
    'ocean', 'sea', 'mediterranean', 'caribbean', 'baltic', 'black', 'red',
]);

const PLAYGROUND_ACTION_WORDS = new Set([
    'swing', 'jump', 'climb', 'slide', 'run', 'walk',
]);

const SEASONING_WORDS = new Set([
    'pepper', 'salt', 'sugar', 'butter',
]);

const ELEMENTARY_CLOTHING_WORDS = new Set([
    'shirt', 'jacket', 'pants', 'dress', 'coat', 'sweater', 'skirt', 'shorts',
    'shoes', 'socks', 'uniform', 'jeans', 't-shirt', 'tshirt', 'hat', 'cap',
]);

const ELEMENTARY_HAIR_COLOR_WORDS = new Set(['blond', 'blonde', 'black', 'brown', 'red', 'gray', 'grey']);

const ELEMENTARY_ANIMAL_WORDS = new Set([
    'cub', 'calf', 'lamb', 'foal', 'puppy', 'kitten', 'chick', 'duckling',
    'duck', 'rabbit', 'bunny', 'dog', 'cat', 'horse', 'cow', 'sheep', 'goat',
    'piglet', 'fawn', 'colt', 'pony', 'bird', 'hen', 'rooster',
]);

function hasAmbiguousFillInContext(question) {
    const type = Number(question?.type);
    if (type !== 1) return false;
    const context = String(question.context || '').toLowerCase().replace(/_{3,}/g, '_____');
    const optionWords = (question.options || []).map(getOptionWord).filter(Boolean);
    const foodOptionCount = optionWords.filter(word => FOOD_CATEGORY_WORDS.has(word)).length;
    const hasAmbiguousFoodContext = [
        /\b(?:a\(n\)|a|an)\s+_____\s+(?:salad|soup|dish|meal|sandwich)\b/,
        /\bsandwich\s+with\s+_____\s+and\s+tomato\b/,
    ].some(pattern => pattern.test(context));
    if (foodOptionCount >= 3 && hasAmbiguousFoodContext) {
        return true;
    }

    const publicationOptionCount = optionWords.filter(word => PUBLICATION_CATEGORY_WORDS.has(word)).length;
    if (
        publicationOptionCount >= 3 &&
        /\b(?:this|that|the|a|an)\s+[a-z]+\s+_____\s+(?:explains|teaches|describes|introduces|covers|shows)\b/.test(context)
    ) {
        return true;
    }

    const materialOptionCount = optionWords.filter(word => MATERIAL_CATEGORY_WORDS.has(word)).length;
    const hasAmbiguousMaterialContext = [
        /\bmade\s+(?:of|from|out\s+of)\s+(?:pure\s+)?_____\b/,
        /\b(?:pure|soft|warm|thin|thick)\s+_____\b.*\b(?:wore\s+out|holes?|clothes?|socks?|shirt|coat|fabric)\b/,
    ].some(pattern => pattern.test(context));
    if (materialOptionCount >= 3 && hasAmbiguousMaterialContext) {
        return true;
    }

    const soundAdjectiveCount = optionWords.filter(word => SOUND_ADJECTIVE_WORDS.has(word)).length;
    const hasAmbiguousSoundContext = [
        /\b(?:the|a|an)\s+_____\s+(?:noise|sound|voice)\b/,
        /\b_____\s+(?:noise|sound|voice)\b.*\b(?:made|makes|making|heard|hear|wonder|wondered)\b/,
    ].some(pattern => pattern.test(context));
    if (soundAdjectiveCount >= 3 && hasAmbiguousSoundContext) {
        return true;
    }

    const oceanRouteCount = optionWords.filter(word => OCEAN_ROUTE_WORDS.has(word)).length;
    const hasOceanRouteContext = [
        /\b(?:ship|boat|vessel|sailor|captain|crew)\b.*\b(?:sailed|sail|crossed|across|heading|voyage)\b.*\b_____/,
        /\b_____.+\b(?:from|between)\b.+\b(?:london|new york|america|europe|asia|africa|australia)\b/,
        /\b(?:sailed|crossed|voyage|route)\b.*\b(?:from|between)\b.*\b(?:to|and)\b/,
    ].some(pattern => pattern.test(context));
    if (oceanRouteCount >= 3 && hasOceanRouteContext) {
        return true;
    }
    return false;
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
    if (word === 'crowded' && meaning.includes(CN.crowded) && /\bcrowded\s+into\b/.test(context.replace(/_{3,}/g, 'crowded'))) {
        return 'sense_mismatch_crowded';
    }
    return '';
}

function hasGenericFillInContext(question) {
    const context = String(question.context || '').trim().toLowerCase().replace(/_{3,}/g, '_____').replace(/\s+/g, ' ');
    return context === 'the student wrote _____ in the sentence.';
}

function hasDictionaryFragmentContext(question) {
    const context = String(question.context || '').trim();
    if (!context) return false;
    const semicolonCount = (context.match(/;/g) || []).length;
    if (semicolonCount < 2) return false;
    const fragments = context.split(';').map(part => part.trim()).filter(Boolean);
    const fullSentenceCount = fragments.filter(part => /^[A-Z]/.test(part) && /[.!?]$/.test(part)).length;
    const phraseLikeCount = fragments.filter(part => /^(?:a|an|the)\s+/i.test(part) && !/[.!?]$/.test(part)).length;
    return fullSentenceCount === 0 || phraseLikeCount >= 2;
}

function hasInvalidOptionWord(question) {
    return (question.options || []).map(getOptionWord).some(isBadQuizWord);
}

function hasInvalidDistractorWord(question) {
    return getDistractorWords(question).some(isBadQuizWord);
}

function hasBadCorrectMeaning(question) {
    const type = Number(question?.type);
    if (![1, 2].includes(type) || isElementaryLevel(question.level)) return false;
    const meaning = String(question.correctMeaning || '').trim();
    if (!meaning || hasAiMetaResponse(meaning) || hasMeaningfulChineseMeaning(meaning)) return false;
    return meaning.length > 30 || /;/.test(meaning);
}

function hasAnswerRevealedAfterBlank(question) {
    const type = Number(question?.type);
    if (type !== 1) return false;
    const rawContext = String(question.context || '');
    const blankIndex = rawContext.indexOf('_____');
    if (blankIndex < 0) return false;
    const afterBlank = rawContext.slice(blankIndex + 5);
    const words = [String(question.word || '').trim().toLowerCase(), getCorrectOptionWord(question)]
        .map(word => String(word || '').trim().toLowerCase())
        .filter(Boolean);
    return words.some(word => new RegExp('\\b' + escapeRegExp(word) + '\\b', 'i').test(afterBlank));
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

function hasBadOptionInflection(question) {
    return (question.options || [])
        .map(getOptionWord)
        .some(word => /(?:eded|ieded)$/.test(word));
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
        if (isBadQuizWord(baseWord) || isBadQuizWord(word)) issues.push('invalid_quiz_word');
        if (hasAnswerRevealedAfterBlank(question)) issues.push('answer_revealed_after_blank');
        if (hasGenericFillInContext(question)) issues.push('generic_fill_in_context');
        if (hasDictionaryFragmentContext(question)) issues.push('dictionary_fragment_context');
        if (hasInvalidFillInGrammar({ word, context }) || hasInvalidFillInGrammar({ word: baseWord, context: baseContext })) issues.push('invalid_fill_in_grammar');
        if (hasDistractorFormOverlap(word, question)) issues.push('distractor_form_overlap');
        if (hasAmbiguousFillInContext(question)) issues.push('ambiguous_fill_in_context');
        const mismatch = hasSenseMismatchRisk(question);
        if (mismatch) issues.push(mismatch);
    }
    if ([1, 2].includes(type) && hasBadCorrectMeaning(question)) {
        issues.push('bad_correct_meaning');
    }
    if ([1, 2, 3].includes(type) && hasInvalidOptionWord(question)) {
        issues.push('invalid_option_word');
    }
    if ([1, 2, 3].includes(type) && hasInvalidDistractorWord(question)) {
        issues.push('invalid_distractor_word');
    }
    if ([1, 2, 3].includes(type) && hasBadDistractorShape(question)) {
        issues.push('bad_distractor_shape');
    }
    if ([1, 2, 3].includes(type) && hasBadOptionInflection(question)) {
        issues.push('bad_option_inflection');
    }
    if (isElementaryLevel(question.level)) {
        if (type === 1) {
            if (hasElementaryContextRisk(question.context)) issues.push('not_elementary_context');
            if (hasAmbiguousElementaryContext(question)) issues.push('ambiguous_elementary_context');
        }
        if (type === 2) {
            issues.push('elementary_definition_question');
            if (hasDictionaryStyleDefinition(question.context)) {
                issues.push('dictionary_definition');
            }
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
    isBadQuizWord,
    getQuestionQualityIssues,
    isQuestionQualityAcceptable,
};
