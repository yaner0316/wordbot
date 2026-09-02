'use strict';

const SELECTED_SENSE_FLOW_FLAG = 'selected_sense_flow_v1';

function normalizedText(value) {
    return String(value || '').trim();
}

function hasSelectedSenseFlowFlag(word) {
    const rawFlags = word?.quality_flags ?? word?.fields?.Quality_Flags;
    const flags = Array.isArray(rawFlags) ? rawFlags : String(rawFlags || '').split(',');
    return flags.some(flag => normalizedText(flag) === SELECTED_SENSE_FLOW_FLAG);
}

function isSubmittedReview(record) {
    const fields = record?.fields || {};
    return normalizedText(record?.assessment_kind ?? fields.assessment_kind).toLowerCase() === 'review'
        && normalizedText(record?.review_status ?? fields.review_status).toLowerCase() === 'complete';
}

function hasCompletedSelectedSenseReview(records) {
    return (records || []).some(isSubmittedReview);
}

function getSelectedSenseContextStage(word, records) {
    if (!hasSelectedSenseFlowFlag(word)) return null;
    const hasInitialContext = (records || []).some(record =>
        normalizedText(record?.assessment_kind ?? record?.fields?.assessment_kind).toLowerCase() === 'initial_context'
    );
    if (!hasInitialContext) return 'initial_context';
    return hasCompletedSelectedSenseReview(records) ? 'context_evidence' : null;
}

function buildMeaningChoiceOptions({ correctMeaning, candidateMeanings, random = Math.random } = {}) {
    const correct = normalizedText(correctMeaning);
    if (!correct) return null;
    const seen = new Set([correct]);
    const distractors = [];
    for (const candidate of candidateMeanings || []) {
        const value = normalizedText(candidate);
        if (!value || seen.has(value)) continue;
        seen.add(value);
        distractors.push(value);
        if (distractors.length === 3) break;
    }
    if (distractors.length !== 3) return null;
    const options = [correct, ...distractors];
    for (let index = options.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.max(0, Math.min(0.999999, Number(random()) || 0)) * (index + 1));
        [options[index], options[swapIndex]] = [options[swapIndex], options[index]];
    }
    return { options, answer: String.fromCharCode(65 + options.indexOf(correct)) };
}

module.exports = {
    SELECTED_SENSE_FLOW_FLAG,
    hasSelectedSenseFlowFlag,
    hasCompletedSelectedSenseReview,
    getSelectedSenseContextStage,
    buildMeaningChoiceOptions,
};
