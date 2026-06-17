function fieldValue(value) {
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return value.length > 0 ? fieldValue(value[0]) : '';
    if (typeof value === 'object') {
        if (value.text !== undefined) return String(value.text);
        if (value.name !== undefined) return String(value.name);
        if (value.value !== undefined) return String(value.value);
        if (value.id !== undefined) return String(value.id);
        return JSON.stringify(value);
    }
    return String(value);
}

function isMasteredStatus(status) {
    const value = fieldValue(status).trim();
    return value === '已掌握' || value.toLowerCase() === 'mastered';
}

function mapByRecordId(records) {
    const map = new Map();
    for (const record of records || []) {
        if (record?.record_id) map.set(record.record_id, record);
    }
    return map;
}

function createLearningEventsFromWordStatusChange({ beforeRecords, afterRecords }) {
    const beforeById = mapByRecordId(beforeRecords);
    const events = [];

    for (const after of afterRecords || []) {
        const recordId = after?.record_id;
        if (!recordId) continue;
        const before = beforeById.get(recordId);
        const wasMastered = isMasteredStatus(before?.fields?.Status);
        const isNowMastered = isMasteredStatus(after?.fields?.Status);
        if (!wasMastered && isNowMastered) {
            events.push({
                type: 'meaning_mastered',
                meaningRecordId: recordId,
            });
        }
    }

    return events;
}

module.exports = {
    createLearningEventsFromWordStatusChange,
    isMasteredStatus,
};
