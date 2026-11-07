'use strict';
const { createHash } = require('node:crypto');
const CONTENT_REVIEW_POLICY = 'question-content-v1';
const clean = value => String(value || '').trim();
const printed = value => clean(value).replace(/^[A-D]\.\s*/i, '');
const partsOfSpeech = new Set(['noun','verb','adjective','adverb','pronoun','determiner','preposition','conjunction','interjection','numeral']);
const reasonValid = value => typeof value === 'string' && clean(value).length >= 8 && /[\u3400-\u9fff]/.test(value);
function contentParts(question) {
    const words=(question.options || []).map(printed);
    const meanings=question.optionMeanings || question.option_meanings || [];
    const index='ABCD'.indexOf(clean(question.answer).toUpperCase());
    return {level:clean(question.level), context:clean(question.context || question.question_text),
        translation:clean(question.contextCN || question.context_zh),
        targetMeaning:clean(question.targetMeaning || question.correctMeaning || question.correct_meaning || meanings[index]),
        correctWord:words[index], options:words.map((word,i)=>({word,meaning:clean(meanings[i])})).sort((a,b)=>a.word.localeCompare(b.word))};
}
function contentFingerprint(question) {
    return createHash('sha256').update(JSON.stringify(contentParts(question))).digest('hex');
}
function parseContentReview(question, evidence, {requireOptionSeparation=false}={}) {
    const invalid=code=>({approved:false,status:'rejected',code:code || 'content_review_missing'});
    const parts=contentParts(question),sense=evidence?.targetSense,translation=evidence?.translation;
    if (!parts.translation || !parts.targetMeaning || !parts.correctWord || parts.options.length!==4
        || !Array.isArray(sense?.providedPartsOfSpeech) || !sense.providedPartsOfSpeech.length
        || !sense.providedPartsOfSpeech.every(pos=>partsOfSpeech.has(pos)) || !partsOfSpeech.has(sense.contextualPartOfSpeech)
        || translation?.text!==parts.translation || typeof translation.accurate!=='boolean' || !reasonValid(translation.reason)) return invalid();
    const judgments=evidence?.optionMeanings;
    if (!Array.isArray(judgments) || judgments.length!==4 || new Set(judgments.map(item=>item.letter)).size!==4
        || !judgments.every(item=>/^[A-D]$/.test(item.letter)
            && item.meaning===clean((question.optionMeanings || question.option_meanings || [])['ABCD'.indexOf(item.letter)])
            && typeof item.accurate==='boolean' && reasonValid(item.reason))) return invalid();
    if (!sense.providedPartsOfSpeech.includes(sense.contextualPartOfSpeech)) return invalid('semantic_expected_sense_mismatch');
    const pairs=evidence.overlappingPairs;
    if (requireOptionSeparation || pairs!==undefined) {
        if (!Array.isArray(pairs) || !pairs.every(pair=>Array.isArray(pair?.letters)
            && pair.letters.length===2 && new Set(pair.letters).size===2
            && pair.letters.every(letter=>/^[A-D]$/.test(letter)) && reasonValid(pair.reason))) return invalid();
        if (pairs.length) return invalid('content_option_overlap');
    }
    if (!translation.accurate) return invalid('content_translation');
    if (judgments.some(item=>!item.accurate)) return invalid('content_option_meanings');
    return {approved:true,contentReview:{policy:CONTENT_REVIEW_POLICY,inputFingerprint:contentFingerprint(question),targetMeaning:parts.targetMeaning,
        targetSense:sense,translation,...(pairs ? {overlappingPairs:[]} : {}),
        optionMeanings:judgments.map(({letter,...item})=>({...item,word:printed(question.options['ABCD'.indexOf(letter)])}))}};
}
function hasCurrentContentReview(question, evidence) {
    question={...question,targetMeaning:question.targetMeaning || question.correctMeaning || question.correct_meaning || evidence?.targetMeaning};
    if (evidence?.policy!==CONTENT_REVIEW_POLICY || evidence.inputFingerprint!==contentFingerprint(question)
        || !Array.isArray(evidence.optionMeanings)) return false;
    const words=(question.options || []).map(printed);
    return parseContentReview(question,{...evidence,optionMeanings:evidence.optionMeanings.map(({word,...item})=>({
        ...item,letter:words.includes(word)?'ABCD'[words.indexOf(word)]:''
    }))}).approved;
}
function contentReviewPrompt(question) {
    return [
        'CONTENT REVIEW: check the exact Chinese sentence translation and all supplied option glosses, not merely whether they contain Chinese or have sufficient length.',
        'The learning target is the supplied sense, not its word family. A noun meaning such as 目录册 or 显微镜 is not satisfied by a verb meaning such as 编目 or 用显微镜检查. Classify the supplied meaning independently of the sentence; allow multiple parts of speech only when the supplied gloss itself explicitly includes them. Classify proper nouns as noun and multiword phrases by their grammatical role.',
        'Compare all six pairs of option meanings, including distractor versus distractor. Reject synonymous meanings or semantic inclusion, even when different Chinese labels hide the overlap (for example special/unusual or an abacus as a kind of calculator). Mere shared topic, shared characters, or belonging to the same broad category is not overlap (cat and dog remain distinct). Compare genuine meanings represented by the supplied glosses; do not invent unrelated senses. Do not repair overlap by mislabeling a word. Include overlappingPairs in contentReview: [] only when all six pairs are distinct; otherwise [{letters:["A","B"],reason:Chinese explanation identifying the synonymous or inclusion relationship}]. Unresolved doubt must not produce an empty list.',
        'Return contentReview in the same JSON: {targetSense:{providedPartsOfSpeech:[noun/verb/adjective/adverb/pronoun/determiner/preposition/conjunction/interjection/numeral],contextualPartOfSpeech:one of those},translation:{text:copy contextCN exactly,accurate:boolean,reason:Chinese evidence},optionMeanings:[{letter,meaning:copy supplied gloss exactly,accurate:boolean,reason:Chinese evidence} for ALL four options]}. Translation accuracy includes actors, actions, negation, relationships, quantities and no invented content. A gloss must be a genuine meaning of its printed English option; this does not restrict the independent English-uniqueness check to a hidden sense. Reasons must describe this input; if uncertain do not approve.',
        'Translation and meaning input: '+JSON.stringify({contextCN:question.contextCN || question.context_zh,
            targetMeaning:contentParts(question).targetMeaning,optionMeanings:(question.optionMeanings || question.option_meanings || []).map((meaning,i)=>({letter:'ABCD'[i],word:printed(question.options[i]),meaning}))}),
    ].join('\n');
}
module.exports={CONTENT_REVIEW_POLICY,contentFingerprint,parseContentReview,hasCurrentContentReview,contentReviewPrompt};
