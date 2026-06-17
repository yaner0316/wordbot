const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildRewardConfig,
    calculateRewardProgress,
    createRewardEvents,
} = require('../reward-engine');

test('uses production milestone sizes by default and supports test overrides', () => {
    assert.deepEqual(buildRewardConfig({}), {
        smallMilestoneSize: 10,
        bigMilestoneSize: 50,
    });

    assert.deepEqual(buildRewardConfig({
        REWARD_SMALL_MILESTONE_SIZE: '2',
        REWARD_BIG_MILESTONE_SIZE: '5',
    }), {
        smallMilestoneSize: 2,
        bigMilestoneSize: 5,
    });
});

test('counts newly mastered meaning records toward milestones', () => {
    const progress = calculateRewardProgress({
        masteredMeaningCount: 1,
        newlyMasteredMeaningIds: ['meaning-a'],
        config: { smallMilestoneSize: 2, bigMilestoneSize: 5 },
    });

    assert.equal(progress.masteredMeaningCount, 2);
    assert.equal(progress.smallMilestoneUnlocked, true);
    assert.equal(progress.bigMilestoneUnlocked, false);
    assert.equal(progress.nextSmallMilestoneAt, 4);
    assert.equal(progress.nextBigMilestoneAt, 5);
});

test('does not count raw words, quiz attempts, or duplicate meaning mastery events', () => {
    const rewardEvents = createRewardEvents({
        userId: 'kid-1',
        profile: {
            masteredMeaningCount: 1,
            rewardedMeaningIds: ['meaning-a'],
            sealedMeaningIds: [],
        },
        learningEvents: [
            { type: 'raw_word_added', word: 'apple' },
            { type: 'quiz_completed', testId: 'quiz-1' },
            { type: 'meaning_mastered', meaningRecordId: 'meaning-a' },
            { type: 'meaning_mastered', meaningRecordId: 'meaning-b' },
        ],
        config: { smallMilestoneSize: 2, bigMilestoneSize: 5 },
    });

    assert.equal(rewardEvents.summary.wordCrystalsEarned, 1);
    assert.equal(rewardEvents.summary.masteredMeaningCount, 2);
    assert.deepEqual(
        rewardEvents.events.map(event => event.type),
        ['word_crystal_created', 'small_milestone_unlocked']
    );
});

test('unlocks the big milestone at five mastered meanings in test mode', () => {
    const rewardEvents = createRewardEvents({
        userId: 'kid-1',
        profile: {
            masteredMeaningCount: 4,
            rewardedMeaningIds: ['m1', 'm2', 'm3', 'm4'],
            sealedMeaningIds: [],
        },
        learningEvents: [
            { type: 'meaning_mastered', meaningRecordId: 'm5' },
        ],
        config: { smallMilestoneSize: 2, bigMilestoneSize: 5 },
    });

    assert.equal(rewardEvents.summary.masteredMeaningCount, 5);
    assert.equal(rewardEvents.summary.bigMilestoneUnlocked, true);
    assert.deepEqual(rewardEvents.openedHabitats, ['sunny_meadow']);
    assert.deepEqual(rewardEvents.unlockedAnimals, ['momo']);
});

test('review pass seals existing rewards without granting a larger independent reward', () => {
    const rewardEvents = createRewardEvents({
        userId: 'kid-1',
        profile: {
            masteredMeaningCount: 5,
            rewardedMeaningIds: ['m1', 'm2', 'm3', 'm4', 'm5'],
            sealedMeaningIds: [],
        },
        learningEvents: [
            { type: 'review_passed', meaningRecordId: 'm1' },
        ],
        config: { smallMilestoneSize: 2, bigMilestoneSize: 5 },
    });

    assert.equal(rewardEvents.summary.wordCrystalsEarned, 0);
    assert.equal(rewardEvents.summary.sealedCrystalsEarned, 1);
    assert.deepEqual(
        rewardEvents.events.map(event => event.type),
        ['reward_sealed']
    );
    assert.deepEqual(rewardEvents.unlockedItems, []);
    assert.deepEqual(rewardEvents.unlockedAnimals, []);
    assert.deepEqual(rewardEvents.openedHabitats, []);
});
