'use strict';

function formatOptionSurface(word, context) {
    const text = String(word || '').trim();
    return /^\s*_{3,}/.test(context) || /[.!?]\s*_{3,}/.test(context)
        ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function targetSurface(context, word) {
    const escaped = String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return String(context).match(new RegExp('\\b' + escaped + '\\b', 'i'))?.[0] || word;
}

const SURFACE_POLICY = 'english-surface-v1';
const printedWord = value => String(value || '').replace(/^[A-D]\.\s*/, '').trim();
function surfaceFingerprint(question) {
    const words = (question.options || []).map(printedWord);
    const meanings = question.optionMeanings || question.option_meanings || [];
    return require('node:crypto').createHash('sha256').update(JSON.stringify({
        context: question.context || question.question_text,
        options: words.map((word,index) => [word,meanings[index]]).sort((a,b) => a[0].localeCompare(b[0])),
        answer: words['ABCD'.indexOf(question.answer)],
    })).digest('hex');
}
function textFingerprint(question) { return surfaceFingerprint({...question,optionMeanings:[],option_meanings:[]}); }
function hasCurrentSurfaceEvidence(question, evidence) {
    return evidence?.policy === SURFACE_POLICY && evidence.textFingerprint === textFingerprint(question)
        && (!(question.optionMeanings || question.option_meanings) || evidence.fingerprint === surfaceFingerprint(question))
        && evidence.options?.length === 4 && new Set(evidence.options.map(item => item.word)).size === 4
        && evidence.options.every(item => item.grammatical === true && (question.options || []).map(printedWord).includes(item.word));
}
function parseSurfaceEvidence(question, evidence) {
    const items = evidence?.options;
    const complete = Array.isArray(items) && items.length === 4 && new Set(items.map(item => item.letter)).size === 4
        && items.every(item => /^[A-D]$/.test(item.letter) && item.word === printedWord(question.options['ABCD'.indexOf(item.letter)])
            && typeof item.grammatical === 'boolean' && typeof item.reason === 'string' && item.reason.trim().length >= 8);
    if (!complete) return {approved:false,status:'rejected',code:'semantic_audit_surface_missing'};
    const bad = items.filter(item => !item.grammatical);
    if (bad.length) return {approved:false,status:'rejected',code:bad.some(item => item.letter === question.answer) ? 'surface_context' : 'surface_distractors'};
    return {approved:true,surface:{policy:SURFACE_POLICY,fingerprint:surfaceFingerprint(question),textFingerprint:textFingerprint(question),options:items.map(({word,grammatical,reason}) => ({word,grammatical,reason}))}};
}
module.exports = { formatOptionSurface, targetSurface, SURFACE_POLICY, surfaceFingerprint, hasCurrentSurfaceEvidence, parseSurfaceEvidence };
