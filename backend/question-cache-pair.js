'use strict';

function getFields(row) {
    return row && row.fields && typeof row.fields === 'object'
        ? row.fields
        : (row || {});
}

function getField(row, name) {
    return getFields(row)[name];
}

function normalizeStem(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeFingerprint(value) {
    return String(value || '').trim();
}

function parseOptionList(value) {
    if (Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(String(value || '[]'));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return String(value || '').split(/\n|\|/).map(item => item.trim()).filter(Boolean);
    }
}

function normalizeOptionText(value) {
    return String(value || '')
        .trim()
        .replace(/^[A-D]\.\s*/i, '')
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

function getDistractors(row) {
    const options = parseOptionList(getField(row, 'options'));
    const answer = String(getField(row, 'answer') || '').trim().toUpperCase();
    const answerIndex = /^[A-D]$/.test(answer) ? answer.charCodeAt(0) - 65 : -1;
    if (options.length !== 4 || answerIndex < 0 || answerIndex >= options.length) return null;

    const distractors = options
        .filter((option, index) => index !== answerIndex)
        .map(normalizeOptionText);
    if (distractors.length !== 3 || distractors.some(value => !value)) return null;
    if (new Set(distractors).size !== 3) return null;
    return distractors;
}

function getPairIssues(left, right) {
    const issues = new Set();
    const leftStem = normalizeStem(getField(left, 'question_text'));
    const rightStem = normalizeStem(getField(right, 'question_text'));
    if (!leftStem || !rightStem) issues.add('missing_question_text');
    else if (leftStem === rightStem) issues.add('duplicate_question_text');

    const leftFingerprint = normalizeFingerprint(getField(left, 'question_fingerprint'));
    const rightFingerprint = normalizeFingerprint(getField(right, 'question_fingerprint'));
    if (!leftFingerprint || !rightFingerprint) issues.add('missing_question_fingerprint');
    else if (leftFingerprint === rightFingerprint) issues.add('duplicate_question_fingerprint');

    const leftDistractors = getDistractors(left);
    const rightDistractors = getDistractors(right);
    if (!leftDistractors || !rightDistractors) {
        issues.add('bad_distractors');
    } else {
        const rightSet = new Set(rightDistractors);
        const overlap = leftDistractors.filter(value => rightSet.has(value)).length;
        if (overlap > 1) issues.add('distractor_overlap');
    }
    return issues;
}

function getReadyPrimaryPairIssues(rows = []) {
    const candidates = Array.isArray(rows) ? rows : [];
    if (candidates.length < 2) return ['insufficient_ready_rows'];

    const issues = new Set();
    for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
            const pairIssues = getPairIssues(candidates[leftIndex], candidates[rightIndex]);
            if (pairIssues.size === 0) return [];
            for (const issue of pairIssues) issues.add(issue);
        }
    }
    return [...issues].sort();
}

module.exports = {
    getReadyPrimaryPairIssues,
};
