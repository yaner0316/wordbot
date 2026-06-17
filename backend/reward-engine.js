const DEFAULT_SMALL_MILESTONE_SIZE = 10;
const DEFAULT_BIG_MILESTONE_SIZE = 50;

const BIG_MILESTONE_REWARDS = Object.freeze([
    {
        threshold: 50,
        habitat: 'sunny_meadow',
        animal: 'momo',
        item: 'gardener_set',
    },
    {
        threshold: 100,
        habitat: 'fox_workshop',
        animal: 'nini',
        item: 'crystal_crafter_set',
    },
    {
        threshold: 150,
        habitat: 'bear_library',
        animal: 'bobo',
        item: 'library_keeper_set',
    },
    {
        threshold: 200,
        habitat: 'deer_trail',
        animal: 'luma',
        item: 'forest_explorer_set',
    },
    {
        threshold: 250,
        habitat: 'owl_observatory',
        animal: 'orin',
        item: 'star_scholar_set',
    },
]);

function readPositiveInteger(value, fallback) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : fallback;
}

function buildRewardConfig(env = process.env) {
    return {
        smallMilestoneSize: readPositiveInteger(
            env.REWARD_SMALL_MILESTONE_SIZE,
            DEFAULT_SMALL_MILESTONE_SIZE
        ),
        bigMilestoneSize: readPositiveInteger(
            env.REWARD_BIG_MILESTONE_SIZE,
            DEFAULT_BIG_MILESTONE_SIZE
        ),
    };
}

function nextMultipleAfter(value, size) {
    return (Math.floor(value / size) + 1) * size;
}

function crossedMultiple(previous, current, size) {
    if (current <= previous) return false;
    return Math.floor(previous / size) < Math.floor(current / size)
        && current % size === 0;
}

function calculateRewardProgress({
    masteredMeaningCount,
    newlyMasteredMeaningIds,
    config = buildRewardConfig(),
}) {
    const previous = Number(masteredMeaningCount) || 0;
    const gained = Array.isArray(newlyMasteredMeaningIds)
        ? new Set(newlyMasteredMeaningIds.filter(Boolean)).size
        : 0;
    const current = previous + gained;

    return {
        masteredMeaningCount: current,
        wordCrystalsEarned: gained,
        smallMilestoneUnlocked: crossedMultiple(previous, current, config.smallMilestoneSize),
        bigMilestoneUnlocked: crossedMultiple(previous, current, config.bigMilestoneSize),
        nextSmallMilestoneAt: nextMultipleAfter(current, config.smallMilestoneSize),
        nextBigMilestoneAt: nextMultipleAfter(current, config.bigMilestoneSize),
    };
}

function rewardForBigMilestone(count, config) {
    if (count % config.bigMilestoneSize !== 0) return null;
    const productionThreshold = (count / config.bigMilestoneSize) * DEFAULT_BIG_MILESTONE_SIZE;
    return BIG_MILESTONE_REWARDS.find(reward => reward.threshold === productionThreshold) || null;
}

function createRewardEvents({
    userId,
    profile = {},
    learningEvents = [],
    config = buildRewardConfig(),
}) {
    const rewardedMeaningIds = new Set(profile.rewardedMeaningIds || []);
    const sealedMeaningIds = new Set(profile.sealedMeaningIds || []);
    const newlyMasteredMeaningIds = [];
    const newlySealedMeaningIds = [];

    for (const event of learningEvents) {
        if (event?.type === 'meaning_mastered' && event.meaningRecordId) {
            if (!rewardedMeaningIds.has(event.meaningRecordId)) {
                rewardedMeaningIds.add(event.meaningRecordId);
                newlyMasteredMeaningIds.push(event.meaningRecordId);
            }
        }
        if (event?.type === 'review_passed' && event.meaningRecordId) {
            if (rewardedMeaningIds.has(event.meaningRecordId) && !sealedMeaningIds.has(event.meaningRecordId)) {
                sealedMeaningIds.add(event.meaningRecordId);
                newlySealedMeaningIds.push(event.meaningRecordId);
            }
        }
    }

    const progress = calculateRewardProgress({
        masteredMeaningCount: profile.masteredMeaningCount,
        newlyMasteredMeaningIds,
        config,
    });
    const events = [];
    const unlockedItems = [];
    const unlockedAnimals = [];
    const openedHabitats = [];

    for (const meaningRecordId of newlyMasteredMeaningIds) {
        events.push({
            type: 'word_crystal_created',
            userId,
            meaningRecordId,
        });
    }

    for (const meaningRecordId of newlySealedMeaningIds) {
        events.push({
            type: 'reward_sealed',
            userId,
            meaningRecordId,
        });
    }

    if (progress.smallMilestoneUnlocked) {
        events.push({
            type: 'small_milestone_unlocked',
            userId,
            threshold: progress.masteredMeaningCount,
        });
    }

    if (progress.bigMilestoneUnlocked) {
        const reward = rewardForBigMilestone(progress.masteredMeaningCount, config);
        events.push({
            type: 'big_milestone_unlocked',
            userId,
            threshold: progress.masteredMeaningCount,
            habitat: reward?.habitat || null,
            animal: reward?.animal || null,
            item: reward?.item || null,
        });
        if (reward?.habitat) openedHabitats.push(reward.habitat);
        if (reward?.animal) unlockedAnimals.push(reward.animal);
        if (reward?.item) unlockedItems.push(reward.item);
    }

    return {
        summary: {
            ...progress,
            sealedCrystalsEarned: newlySealedMeaningIds.length,
        },
        events,
        unlockedItems,
        unlockedAnimals,
        openedHabitats,
        state: {
            rewardedMeaningIds: [...rewardedMeaningIds],
            sealedMeaningIds: [...sealedMeaningIds],
            masteredMeaningCount: progress.masteredMeaningCount,
        },
    };
}

module.exports = {
    buildRewardConfig,
    calculateRewardProgress,
    createRewardEvents,
};
