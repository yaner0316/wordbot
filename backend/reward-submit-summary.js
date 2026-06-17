const {
    createLearningEventsFromWordStatusChange,
    isMasteredStatus,
} = require('./reward-learning-events');
const {
    buildRewardConfig,
    createRewardEvents,
} = require('./reward-engine');

function createSubmitRewardSummary({
    userId,
    beforeRecords,
    afterRecords,
    config = buildRewardConfig(),
}) {
    const learningEvents = createLearningEventsFromWordStatusChange({
        beforeRecords,
        afterRecords,
    });
    const masteredMeaningCount = (beforeRecords || [])
        .filter(record => isMasteredStatus(record?.fields?.Status))
        .length;
    const rewardedMeaningIds = (beforeRecords || [])
        .filter(record => isMasteredStatus(record?.fields?.Status))
        .map(record => record.record_id)
        .filter(Boolean);

    return createRewardEvents({
        userId,
        profile: {
            masteredMeaningCount,
            rewardedMeaningIds,
            sealedMeaningIds: [],
        },
        learningEvents,
        config,
    });
}

module.exports = {
    createSubmitRewardSummary,
};
