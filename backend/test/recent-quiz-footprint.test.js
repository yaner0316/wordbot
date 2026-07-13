const test = require('node:test');
const assert = require('node:assert/strict');

for (const name of [
    'FEISHU_APP_ID', 'FEISHU_APP_SECRET',
    'FEISHU_WORD_APP_TOKEN', 'FEISHU_WORD_TABLE_ID',
    'FEISHU_TEST_APP_TOKEN', 'FEISHU_TEST_TABLE_ID',
    'FEISHU_STATS_APP_TOKEN', 'FEISHU_STATS_TABLE_ID',
]) process.env[name] ||= 'test';

const { getRecentQuizFootprintFromRecords } = require('../feishu');

function record(testId, recordId, isCorrect) {
    const fields = {
        test_id: testId,
        record_id: recordId,
    };
    if (isCorrect !== undefined) fields.is_correct = isCorrect;
    return { fields };
}

test('recent quiz footprint excludes unsubmitted and correct answers', () => {
    const result = getRecentQuizFootprintFromRecords([
        record('real-new', 'unsubmitted'),
        record('real-new', 'correct', '正确'),
        record('real-new', 'wrong', '错误'),
        record('real-older', 'older-wrong', '错误'),
    ], 4);

    assert.deepEqual([...result.recordIds], ['wrong', 'older-wrong']);
});

test('recent quiz footprint only counts the newest wrong-answer rounds', () => {
    const result = getRecentQuizFootprintFromRecords([
        record('real-new', 'new-wrong', '错误'),
        record('real-correct', 'correct', '正确'),
        record('real-older', 'older-wrong', '错误'),
    ], 1);

    assert.deepEqual([...result.recordIds], ['new-wrong']);
});
