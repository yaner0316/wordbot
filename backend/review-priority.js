const { getAssessmentMode } = require('./assessment-mode');
const { getAssessmentKind, ASSESSMENT_KIND } = require('./review-session');

function value(input) {
    if (Array.isArray(input)) return input[0] || '';
    if (input && typeof input === 'object') {
        return input.text || input.name || input.value || input.id || '';
    }
    return String(input ?? '');
}

function getDeferredRecordIds(records, {
    userId,
    mode,
    masteredRecordIds,
}) {
    return [...new Set(records
        .filter(record => {
            const fields = record.fields || {};
            const assessmentId = value(fields.test_id);
            return value(fields.user) === userId &&
                getAssessmentKind(assessmentId) === ASSESSMENT_KIND.REVIEW &&
                getAssessmentMode(assessmentId) === mode &&
                value(fields.review_status) === 'deferred';
        })
        .map(record => value(record.fields?.record_id))
        .filter(recordId => recordId && !masteredRecordIds.has(recordId)))];
}

function prioritizePendingRecords(records, priorityRecordIds) {
    return [...records].sort((left, right) => {
        const leftPriority = priorityRecordIds.has(left.record_id) ? 0 : 1;
        const rightPriority = priorityRecordIds.has(right.record_id) ? 0 : 1;
        return leftPriority - rightPriority;
    });
}

module.exports = {
    getDeferredRecordIds,
    prioritizePendingRecords,
};
