'use strict';
const { createHash } = require('node:crypto');
const {admitsTranslationDefect}=require('./audit-reason-consistency');
const CONTENT_REVIEW_POLICY = 'question-content-v3';
// One shared rule body for generation and the existing translation review.
const CONTEXTUAL_GLOSS_RULES = [
 'For ALL FOUR options, including distractors, interpret the exact printed word/phrase in the supplied sentence: check part of speech, active/passive voice, object and collocation. A dictionary-valid meaning alone is insufficient. Select the relevant sense; do not list unrelated dictionary senses.',
 'An incorrect option must still have an accurate gloss. Do not invent motives, actions or background to make a distractor fit. If the option is incompatible with the slot (including a different part of speech), retain its genuine lexical meaning and part of speech; never convert it into the word or sense the blank needs. Translation accuracy does not certify that the option is a valid answer; do not re-audit answer uniqueness.',
 'Example 1: had protected them -> 保护, NOT 受保护的. The subject actively protected other people; the past participle in had protected is not a passive adjective. Apply the same distinction to had comforted/praised them.',
 'Example 2: slap a coin -> 拍打, NOT 扇耳光. The stated object is a coin, not a face. Keep this genuine action sense even though slap remains a distractor; do not add a face or change the action to tossing.',
 'Example 3: I must _____ ... with distractor success -> 成功（名词）, NOT 成功做到. Success is a noun and does not become a verb because must requires one; preserve the incompatibility instead of repairing the English through its Chinese gloss.'
].join('\n');
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
function parseContentReview(question, evidence) {
    const invalid=code=>({approved:false,status:'rejected',code:code || 'content_review_missing'});
    const parts=contentParts(question),sense=evidence?.targetSense,translation=evidence?.translation;
    if (!parts.translation || !parts.targetMeaning || !parts.correctWord || parts.options.length!==4
        || typeof sense?.matches!=='boolean' || !reasonValid(sense.reason) || !clean(sense.contextualSense)
        || !Array.isArray(sense?.providedPartsOfSpeech) || !sense.providedPartsOfSpeech.length
        || !sense.providedPartsOfSpeech.every(pos=>partsOfSpeech.has(pos)) || !partsOfSpeech.has(sense.contextualPartOfSpeech)
        || translation?.text!==parts.translation || typeof translation.accurate!=='boolean' || !reasonValid(translation.reason)) return invalid();
    const judgments=evidence?.optionMeanings;
    if (!Array.isArray(judgments) || judgments.length!==4 || new Set(judgments.map(item=>item.letter)).size!==4
        || !judgments.every(item=>/^[A-D]$/.test(item.letter)
            && item.meaning===clean((question.optionMeanings || question.option_meanings || [])['ABCD'.indexOf(item.letter)])
            && typeof item.accurate==='boolean' && reasonValid(item.reason))) return invalid();
    if ((translation.accurate && admitsTranslationDefect(translation.reason)) || judgments.some(item=>item.accurate && admitsTranslationDefect(item.reason)))
        return {...invalid(),reason:'审核理由承认翻译缺陷，但结论标为准确。',repairEvidence:[translation,...judgments]};
    if (sense.matches===false || !sense.providedPartsOfSpeech.includes(sense.contextualPartOfSpeech)) return {...invalid('semantic_expected_sense_mismatch'),reason:sense.reason,repairEvidence:[sense]};
    if (!translation.accurate) return {...invalid('content_translation'),reason:translation.reason,repairEvidence:[translation]};
    if (judgments.some(item=>!item.accurate)) return {...invalid('content_option_meanings'),reason:judgments.filter(item=>!item.accurate).map(item=>item.reason).join('; '),repairEvidence:judgments.filter(item=>!item.accurate)};
    return {approved:true,contentReview:{policy:CONTENT_REVIEW_POLICY,inputFingerprint:contentFingerprint(question),targetMeaning:parts.targetMeaning,
        targetSense:sense,translation,
        optionMeanings:judgments.map(({letter,...item})=>({...item,word:printed(question.options['ABCD'.indexOf(letter)])}))}};
}
function hasCurrentContentReview(question, evidence) {
    question={...question,targetMeaning:question.targetMeaning || question.correctMeaning || question.correct_meaning || evidence?.targetMeaning};
    if (evidence?.policy!==CONTENT_REVIEW_POLICY || evidence.inputFingerprint!==contentFingerprint(question)
        || !Array.isArray(evidence.optionMeanings)) return false;
    const words=(question.options || []).map(printed);
    return parseContentReview(question,{...evidence,
        optionMeanings:evidence.optionMeanings.map(({word,...item})=>({
        ...item,letter:words.includes(word)?'ABCD'[words.indexOf(word)]:''
    }))}).approved;
}
function contentReviewPrompt(question) {
 return [
  'TRANSLATION REVIEW. Check the actual Chinese sentence and all supplied glosses against the printed English and selected sense. Do not change the English or reinterpret the selected meaning to approve a translation.',
  'Preserve actors, actions, negation, quantities, time, cause and relations. Natural Chinese is required; no invented motives, instruments, actions or background. If the English target has another sense, report targetSense.matches=false so the English is repaired.',
  'Classify the selected meaning independently from the English sentence. A noun meaning is not a verb meaning. Ordinary subtypes of a broad supplied sense are allowed. Wrong options may have identical, synonymous or inclusive glosses: that is not a translation defect and is not an independent uniqueness veto.',
  CONTEXTUAL_GLOSS_RULES,
  'For each option, explain the relevant printed form and object/collocation, or its genuine lexical part of speech if the slot is incompatible. Mark accurate=false for a mismatching sense, voice or part of speech, even when that Chinese is a possible dictionary meaning elsewhere. Do not fail an accurate gloss merely because its English option cannot fill the blank.',
  'Return JSON: {contentReview:{targetSense:{providedPartsOfSpeech:[noun/verb/adjective/adverb/pronoun/determiner/preposition/conjunction/interjection/numeral],contextualPartOfSpeech:one of those,matches:boolean,contextualSense:Chinese,reason:Chinese evidence},translation:{text:copy contextCN exactly,accurate:boolean,reason:Chinese evidence},optionMeanings:[{letter,meaning:copy supplied gloss exactly,accurate:boolean,reason:Chinese evidence} for all four letters]}}. Each reason must explain the actual input; uncertainty must not approve. Reasons and boolean conclusions must agree.',
  JSON.stringify({context:question.context || question.question_text,completedSentence:(question.context || question.question_text || '').replace(/_{3,}/g,contentParts(question).correctWord),contextCN:question.contextCN || question.context_zh,targetMeaning:contentParts(question).targetMeaning,options:(question.options || []).map((word,i)=>({letter:'ABCD'[i],word:printed(word),meaning:(question.optionMeanings || question.option_meanings || [])[i]}))})
 ].join('\n');
}
module.exports={CONTENT_REVIEW_POLICY,CONTEXTUAL_GLOSS_RULES,contentFingerprint,parseContentReview,hasCurrentContentReview,contentReviewPrompt};
