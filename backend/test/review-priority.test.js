const test = require('node:test');
const assert = require('node:assert/strict');

const {
    getDeferredRecordIds,
    prioritizePendingRecords,
} = require('../review-priority');

test('derives unresolved deferred meanings for the requested mode', () => {
    const records = [
        { fields: { user: 'student', test_id: 'real-review-r1', review_status: 'deferred', record_id: 'word-2' } },
        { fields: { user: 'student', test_id: 'test-review-r2', review_status: 'deferred', record_id: 'word-3' } },
        { fields: { user: 'other', test_id: 'real-review-r3', review_status: 'deferred', record_id: 'word-4' } },
    ];

    assert.deepEqual(
        getDeferredRecordIds(records, {
            userId: 'student',
            mode: 'real',
            masteredRecordIds: new Set(),
        }),
        ['word-2']
    );
});

test('mastered meanings are removed from the deferred queue', () => {
    const records = [
        { fields: { user: 'student', test_id: 'real-review-r1', review_status: 'deferred', record_id: 'word-2' } },
    ];

    assert.deepEqual(
        getDeferredRecordIds(records, {
            userId: 'student',
            mode: 'real',
            masteredRecordIds: new Set(['word-2']),
        }),
        []
    );
});

test('prioritized records are ordered before ordinary pending records', () => {
    const pending = [
        { record_id: 'word-1' },
        { record_id: 'word-4' },
        { record_id: 'word-2' },
    ];

    assert.deepEqual(
        prioritizePendingRecords(pending, new Set(['word-4'])).map(r => r.record_id),
        ['word-4', 'word-1', 'word-2']
    );
});
