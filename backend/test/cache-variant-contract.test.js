const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCacheQuestionRowsForWord } = require('../supabase-data');

const LEVEL = String.fromCharCode(0x4e2d, 0x5b66);
const user = { id: 'user-1', username: 'qiuqiu' };
const word = {
    id: 'word-1',
    feishu_record_id: 'rec-word-1',
    word: 'apple',
    meaning_en: 'a fruit',
    meaning_zh: '苹果',
    context_en: 'The child ate an apple after school.',
    distractors: ['pear', 'desk', 'chair'],
};
const translateWords = async values => Object.fromEntries(values.map(value => [value, value === 'apple' ? '苹果' : '干扰项']));

test('cache builder publishes zero rows when it cannot build a second stem', async () => {
    const withoutGenerator = await buildCacheQuestionRowsForWord({
        user, word, level: LEVEL, roundType: 'primary', translateWords,
    });
    assert.deepEqual(withoutGenerator, []);

    const duplicateOnly = await buildCacheQuestionRowsForWord({
        user, word, level: LEVEL, roundType: 'primary', translateWords,
        generateContext: async () => word.context_en,
    });
    assert.deepEqual(duplicateOnly, []);
});

test('cache builder publishes exactly two rows only after both stems pass', async () => {
    const rows = await buildCacheQuestionRowsForWord({
        user, word, level: LEVEL, roundType: 'primary', translateWords,
        generateContext: async () => 'The child packed an apple for the long trip.',
    });
    assert.equal(rows.length, 2);
    assert.equal(new Set(rows.map(row => row.question_text)).size, 2);
    assert.equal(new Set(rows.map(row => row.question_fingerprint)).size, 2);
});
