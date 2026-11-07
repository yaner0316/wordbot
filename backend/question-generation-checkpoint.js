'use strict';

const STAGE_FIELDS = {
    context: [
        'context', 'contextTranslation', 'distractors', 'optionWords', 'options',
        'answer', 'optionMeanings', 'localValidated', 'audit', 'row',
    ],
    distractors: [
        'distractors', 'optionWords', 'options', 'answer', 'optionMeanings',
        'localValidated', 'audit', 'row',
    ],
    option_layout: [
        'optionWords', 'options', 'answer', 'optionMeanings', 'localValidated',
        'audit', 'row',
    ],
    option_meanings: ['optionMeanings', 'localValidated', 'audit', 'row'],
    context_translation: ['contextTranslation', 'localValidated', 'audit', 'row'],
    local_validation: ['localValidated', 'audit', 'row'],
    semantic_audit: ['audit', 'row'],
    row: ['row'],
};

function cleanText(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
}

function invalidateVariantFromStage(variant, stage) {
    const result = { ...(variant || {}) };
    const fields = STAGE_FIELDS[stage];
    if (!fields) throw new Error(`UNKNOWN_GENERATION_STAGE:${stage}`);
    for (const field of fields) delete result[field];
    return result;
}

function checkpointInvalidationStageForIssues(issues) {
    if (issues.includes('content_review_missing')) return 'semantic_audit';
    if (issues.includes('content_translation')) return 'context_translation';
    if (issues.includes('content_option_meanings')) return 'option_meanings';
    if (issues.includes('level_fit_context')) return 'context';
    if (issues.includes('level_fit_distractors')) return 'distractors';
    if (issues.includes('level_fit_evidence_invalid')) return 'semantic_audit';
    if (issues.some(issue => /^semantic_audit_/.test(issue))) return 'semantic_audit';
    if (issues.some(issue => /context/.test(issue) && !/translation/.test(issue))) return 'context';
    if (issues.some(issue => /context.*translation|translation.*context/.test(issue))) return 'context_translation';
    if (issues.some(issue => /option_meaning|correct_meaning/.test(issue))) return 'option_meanings';
    if (issues.some(issue => /option|answer|distractor/.test(issue))) return 'distractors';
    return 'option_layout';
}

function normalizeGenerationCheckpoint(checkpoint, current) {
    const previous = checkpoint && typeof checkpoint === 'object' ? checkpoint : {};
    const input = current && typeof current === 'object' ? current : {};
    const previousWord = cleanText(previous.word);
    const currentWord = cleanText(input.word);
    const sameWordIgnoringCase = previousWord.toLowerCase() === currentWord.toLowerCase();
    const materialChange = cleanText(previous.level) !== cleanText(input.level)
        || cleanText(previous.meaning) !== cleanText(input.meaning)
        || !sameWordIgnoringCase;
    const casingChanged = !materialChange && previousWord !== currentWord;
    const variants = Array.isArray(previous.variants) ? previous.variants : [];

    return {
        schemaVersion: 1,
        wordVersion: input.wordVersion,
        level: input.level,
        word: input.word,
        meaning: input.meaning,
        ...(!materialChange && Array.isArray(previous.rejectedContexts) && previous.rejectedContexts.length
            ? {rejectedContexts:[...previous.rejectedContexts]} : {}),
        ...(!materialChange && Array.isArray(previous.rejectedAlternatives) && previous.rejectedAlternatives.length
            ? {rejectedAlternatives:[...previous.rejectedAlternatives].slice(-12)} : {}),
        ...(!materialChange && Array.isArray(previous.levelFitFeedback) && previous.levelFitFeedback.length
            ? {levelFitFeedback:previous.levelFitFeedback.slice(0,8)} : {}),
        variants: materialChange
            ? []
            : casingChanged
                ? variants.map(variant => invalidateVariantFromStage(variant, 'option_layout'))
                : variants.map(variant => ({ ...variant })),
    };
}

module.exports = {
    checkpointInvalidationStageForIssues,
    invalidateVariantFromStage,
    normalizeGenerationCheckpoint,
};
