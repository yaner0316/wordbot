const test = require('node:test');
const assert = require('node:assert/strict');

const { createSubmitRewardSummary } = require('../reward-submit-summary');

function wordRecord(recordId, status) {
    return {
        record_id: recordId,
        fields: {
            Status: status,
        },
    };
}

test('builds reward summary from newly mastered meaning status changes', () => {
    const summary = createSubmitRewardSummary({
        userId: 'kid-1',
        beforeRecords: [
            wordRecord('m1', 'Mastered'),
            wordRecord('m2', 'Pending'),
        ],
        afterRecords: [
            wordRecord('m1', 'Mastered'),
            wordRecord('m2', 'Mastered'),
        ],
        config: { smallMilestoneSize: 2, bigMilestoneSize: 5 },
    });

    assert.equal(summary.summary.wordCrystalsEarned, 1);
    assert.equal(summary.summary.masteredMeaningCount, 2);
    assert.equal(summary.summary.smallMilestoneUnlocked, true);
    assert.deepEqual(
        summary.events.map(event => event.type),
        ['word_crystal_created', 'small_milestone_unlocked']
    );
});

test('unlocks a test-mode big milestone at five mastered meanings', () => {
    const summary = createSubmitRewardSummary({
        userId: 'kid-1',
        beforeRecords: [
            wordRecord('m1', 'Mastered'),
            wordRecord('m2', 'Mastered'),
            wordRecord('m3', 'Mastered'),
            wordRecord('m4', 'Mastered'),
            wordRecord('m5', 'Pending'),
        ],
        afterRecords: [
            wordRecord('m1', 'Mastered'),
            wordRecord('m2', 'Mastered'),
            wordRecord('m3', 'Mastered'),
            wordRecord('m4', 'Mastered'),
            wordRecord('m5', 'Mastered'),
        ],
        config: { smallMilestoneSize: 2, bigMilestoneSize: 5 },
    });

    assert.equal(summary.summary.bigMilestoneUnlocked, true);
    assert.deepEqual(summary.openedHabitats, ['sunny_meadow']);
    assert.deepEqual(summary.unlockedAnimals, ['momo']);
});

test('does not emit duplicate mastery rewards when nothing changed', () => {
    const summary = createSubmitRewardSummary({
        userId: 'kid-1',
        beforeRecords: [
            wordRecord('m1', 'Mastered'),
        ],
        afterRecords: [
            wordRecord('m1', 'Mastered'),
        ],
        config: { smallMilestoneSize: 2, bigMilestoneSize: 5 },
    });

    assert.equal(summary.summary.wordCrystalsEarned, 0);
    assert.deepEqual(summary.events, []);
});
