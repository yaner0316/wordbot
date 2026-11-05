'use strict';

const { createHash } = require('node:crypto');
const reference = require('./reference/high-school-fit-v1.json');
const vocabulary = require('./reference/high-school-vocabulary-2025.json');
const LEVEL_FIT_POLICY = reference.policyVersion;
const normalize = value => String(value || '').trim();
const optionWord = value => normalize(value).replace(/^[A-D]\.\s*/i, '');
const tokens = value => String(value || '').toLowerCase().match(/[a-zà-öø-ÿ]+(?:['’.-][a-zà-öø-ÿ]+)*/g) || [];
const listed = new Set(vocabulary.entries.flatMap(tokens));

function isHighSchool(level) { return normalize(level) === '高中'; }

function questionParts(question) {
    const options = (question.options || []).map(optionWord);
    const answer = normalize(question.answer).toUpperCase();
    const index = 'ABCD'.indexOf(answer);
    return {
        level: normalize(question.level),
        context: normalize(question.context || question.question_text),
        options, answer,
        target: options[index] || normalize(question.word),
        meaning: normalize((question.optionMeanings || question.option_meanings || [])[index] || question.correct_meaning),
    };
}

function levelFitFingerprint(question) {
    return createHash('sha256').update(JSON.stringify({policy: LEVEL_FIT_POLICY, ...questionParts(question)})).digest('hex');
}

function vocabularyHints(question) {
    const parts = questionParts(question);
    const targetTokens = new Set(tokens(parts.target));
    const inspect = text => {
        const unlisted = [], possibleInflections = [];
        for (const token of new Set(tokens(text))) {
            if (targetTokens.has(token) || listed.has(token)) continue;
            // These are explicitly uncertain hints, not a lemmatizer or a whitelist.
            const bases = [token.replace(/s$/, ''), token.replace(/es$/, ''), token.replace(/ies$/, 'y'),
                token.replace(/ed$/, ''), token.replace(/ed$/, 'e'), token.replace(/ing$/, ''), token.replace(/ing$/, 'e')];
            if (bases.some(base => base !== token && listed.has(base))) possibleInflections.push(token);
            else unlisted.push(token);
        }
        return {unlisted, possibleInflections};
    };
    return {context: inspect(parts.context), distractors: parts.options.filter((_, i) => 'ABCD'[i] !== parts.answer).map(word => ({word, ...inspect(word)}))};
}

function highSchoolGuidance(level, {examples = false} = {}) {
    if (!isHighSchool(level)) return '';
    return [reference.audience, ...reference.rules, reference.grammarReference,
        ...(examples ? reference.examples.map(item => JSON.stringify(item)) : [])].join('\n');
}

function levelFitPrompt(question) {
    if (!isHighSchool(question.level)) return '';
    return [
        'HIGH-SCHOOL FIT CHECK (independent of whether the intended sense matches).',
        highSchoolGuidance(question.level, {examples:true}),
        'Also return levelFit in the SAME JSON: {status:suitable/borderline/unsuitable, clue:an exact continuous English substring of the original context identifying an accessible or obstructed clue, vocabularyReason:Chinese evidence about actual word senses, syntaxReason:Chinese evidence about clause relations, reasoningReason:Chinese evidence about required inference/background knowledge, optionsReason:Chinese evidence about distractors, barriers:[{text:exact substring of context or one option,location:context/option,impact:incidental/blocking,reason:Chinese explanation}],repairStage:none/context/distractors}. Each reason must explain this input, not just say appropriate. Suitable requires no blocking barriers and repairStage=none. Unsuitable requires at least one blocking barrier; borderline requires at least one grounded concern. If context or overall comprehension is the issue, use context; use distractors only when the stem is acceptable and only the options need replacement.',
        'Local vocabulary lookup (2025 appendix; hints only, do not equate unlisted with unknown): ' + JSON.stringify(vocabularyHints(question)),
        'Exact context and all options: ' + JSON.stringify(questionParts(question)),
    ].join('\n');
}

function parseLevelFitEvidence(question, evidence) {
    if (!isHighSchool(question.level)) return {approved:true};
    const parts = questionParts(question);
    const invalid = () => ({approved:false,status:'rejected',code:'level_fit_evidence_invalid',reason:'high-school fit evidence missing or inconsistent'});
    const reasonValid = value => typeof value === 'string' && value.trim().length >= 8 && /[\u3400-\u9fff]/.test(value);
    if (!evidence || !['suitable','borderline','unsuitable'].includes(evidence.status)
        || typeof evidence.clue !== 'string' || evidence.clue.trim().length < 3 || !parts.context.includes(evidence.clue) || /_{3,}/.test(evidence.clue)
        || !['vocabularyReason','syntaxReason','reasoningReason','optionsReason'].every(key => reasonValid(evidence[key]))
        || !Array.isArray(evidence.barriers) || !['none','context','distractors'].includes(evidence.repairStage)) return invalid();
    if (!evidence.barriers.every(item => item && ['context','option'].includes(item.location)
        && ['incidental','blocking'].includes(item.impact) && reasonValid(item.reason)
        && typeof item.text === 'string' && item.text.trim().length >= 2 && !/_{3,}/.test(item.text)
        && (item.location === 'context' ? parts.context.includes(item.text) : parts.options.some(option => option.includes(item.text))))) return invalid();
    const blocked = evidence.barriers.filter(item => item.impact === 'blocking');
    if ((evidence.status === 'suitable' && (blocked.length || evidence.repairStage !== 'none'))
        || (evidence.status !== 'suitable' && (!evidence.barriers.length || evidence.repairStage === 'none'))
        || (evidence.status === 'unsuitable' && !blocked.length)
        || (evidence.repairStage === 'distractors' && evidence.barriers.some(item => item.location === 'context' && item.impact === 'blocking'))) return invalid();
    const levelFit = {...evidence,policyVersion:LEVEL_FIT_POLICY,inputFingerprint:levelFitFingerprint(question)};
    return evidence.status === 'suitable' ? {approved:true,levelFit}
        : {approved:false,status:'rejected',code:'level_fit_' + evidence.repairStage,reason:evidence.barriers.map(item=>item.reason).join(' ').slice(0,200),levelFit};
}

function hasCurrentLevelFit(question, evidence) {
    return !isHighSchool(question.level) || (evidence?.policyVersion === LEVEL_FIT_POLICY
        && evidence.inputFingerprint === levelFitFingerprint(question)
        && parseLevelFitEvidence(question, evidence).approved);
}

module.exports = {LEVEL_FIT_POLICY,isHighSchool,levelFitFingerprint,vocabularyHints,highSchoolGuidance,levelFitPrompt,parseLevelFitEvidence,hasCurrentLevelFit};
