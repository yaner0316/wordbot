const test = require('node:test');
const assert = require('node:assert/strict');

const { createLearningEventsFromWordStatusChange } = require('../reward-learning-events');

function wordRecord(recordId, status) {
    return {
        record_id: recordId,
        fields: {
            Status: status,
        },
    };
}

test('creates meaning mastery events only for records newly changed to Mastered', () => {
    const events = createLearningEventsFromWordStatusChange({
        beforeRecords: [
            wordRecord('m1', 'Pending'),
            wordRecord('m2', 'Mastered'),
            wordRecord('m3', 'Pending'),
        ],
        afterRecords: [
            wordRecord('m1', 'Mastered'),
            wordRecord('m2', 'Mastered'),
            wordRecord('m3', 'Pending'),
        ],
    });

    assert.deepEqual(events, [
        { type: 'meaning_mastered', meaningRecordId: 'm1' },
    ]);
});

test('does not create events for attempts or parent-added raw words without mastery change', () => {
    const events = createLearningEventsFromWordStatusChange({
        beforeRecords: [
            wordRecord('m1', 'Pending'),
        ],
        afterRecords: [
            wordRecord('m1', 'Pending'),
        ],
    });

    assert.deepEqual(events, []);
});

test('treats Chinese and option-style mastered values as mastered', () => {
    const events = createLearningEventsFromWordStatusChange({
        beforeRecords: [
            wordRecord('m1', '待复习'),
            wordRecord('m2', 'Pending'),
        ],
        afterRecords: [
            wordRecord('m1', '已掌握'),
            wordRecord('m2', [{ text: 'Mastered' }]),
        ],
    });

    assert.deepEqual(events, [
        { type: 'meaning_mastered', meaningRecordId: 'm1' },
        { type: 'meaning_mastered', meaningRecordId: 'm2' },
    ]);
});
