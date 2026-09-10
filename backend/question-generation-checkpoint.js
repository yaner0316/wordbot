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
        variants: materialChange
            ? []
            : casingChanged
                ? variants.map(variant => invalidateVariantFromStage(variant, 'option_layout'))
                : variants.map(variant => ({ ...variant })),
    };
}

module.exports = {
    invalidateVariantFromStage,
    normalizeGenerationCheckpoint,
};
