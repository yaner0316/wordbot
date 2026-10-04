const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeQuizLearningAvailability } = require('../quiz-word-queue');
const now = Date.parse('2026-10-04T00:00:00Z');
const hour = 3600000;
function meaning(id, status, enteredAt = now - 30 * hour, user = 'student') {
    return { record_id: id, fields: { user, Word: id, Status: status, record_time: enteredAt } };
}
test('readiness distinguishes an empty library from all meanings already mastered', () => {
    const empty = summarizeQuizLearningAvailability({ userId: 'student', wordRecords: [], now, minAgeMs: 18 * hour });
    assert.equal(empty.totalMeanings, 0);
    const mastered = summarizeQuizLearningAvailability({ userId: 'student', wordRecords: [meaning('one', 'mastered'), meaning('other', 'pending', now, 'another')], now, minAgeMs: 18 * hour });
    assert.equal(mastered.totalMeanings, 1);
    assert.equal(mastered.masteredMeanings, 1);
    assert.equal(mastered.coolingMeanings, 0);
});
test('readiness reports the next cooldown boundary without promising ready questions', () => {
    const result = summarizeQuizLearningAvailability({ userId: 'student', wordRecords: [meaning('new', 'pending', now - hour), meaning('old', 'consolidating')], displayEvents: [{ user: 'student', meaningId: 'old', displayedAt: now - 2 * hour }], now, minAgeMs: 18 * hour });
    assert.equal(result.coolingMeanings, 2);
    assert.equal(result.nextCooldownEndsAt, new Date(now + 16 * hour).toISOString());
    assert.equal(result.availableMeanings, 0);
});
test('missing entry timestamps remain unavailable and are not labelled as an active cooldown', () => {
    const result = summarizeQuizLearningAvailability({ userId: 'student', wordRecords: [meaning('unknown', 'pending', 0), meaning('ready', 'recognized')], now, minAgeMs: 18 * hour });
    assert.equal(result.availableMeanings, 1);
    assert.equal(result.missingEntryTimeMeanings, 1);
    assert.equal(result.coolingMeanings, 0);
    assert.equal(result.nextCooldownEndsAt, null);
});
