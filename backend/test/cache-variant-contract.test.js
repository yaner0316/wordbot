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

const translateContext = async context => context.includes('packed')
    ? '\u8fd9\u4e2a\u5b69\u5b50\u4e3a\u957f\u9014\u65c5\u884c\u88c5\u4e86\u4e00\u4e2a\u82f9\u679c\u3002'
    : '\u8fd9\u4e2a\u5b69\u5b50\u653e\u5b66\u540e\u5403\u4e86\u4e00\u4e2a\u82f9\u679c\u3002';

test('cache builder publishes zero rows when it cannot build a second stem', async () => {
    const withoutGenerator = await buildCacheQuestionRowsForWord({
        user, word, level: LEVEL, roundType: 'primary', translateWords,
        translateContext,
    });
    assert.deepEqual(withoutGenerator, []);

    const duplicateOnly = await buildCacheQuestionRowsForWord({
        user, word, level: LEVEL, roundType: 'primary', translateWords,
        translateContext,
        generateContext: async () => word.context_en,
    });
    assert.deepEqual(duplicateOnly, []);
});

test('cache builder publishes exactly two rows only after both stems pass', async () => {
    let distractorCall = 0;
    const rows = await buildCacheQuestionRowsForWord({
        user, word, level: LEVEL, roundType: 'primary', translateWords,
        translateContext,
        generateContext: async () => 'The child packed an apple for the long trip.',
        generateDistractors: async () => distractorCall++ === 0
            ? ['pear', 'banana', 'orange']
            : ['snack', 'sandwich', 'biscuit'],
    });
    assert.equal(rows.length, 2);
    assert.equal(new Set(rows.map(row => row.question_text)).size, 2);
    assert.equal(new Set(rows.map(row => row.question_fingerprint)).size, 2);
});

test('cache builder generates and uses distractors for each real stem independently', async () => {
    const calls = [];
    const generatedSets = [
        ['pear', 'banana', 'orange'],
        ['snack', 'sandwich', 'biscuit'],
    ];
    const rows = await buildCacheQuestionRowsForWord({
        user, word, level: LEVEL, roundType: 'primary', translateWords,
        translateContext,
        generateContext: async () => 'The child packed an apple for the long trip.',
        generateDistractors: async input => {
            calls.push(input);
            return generatedSets[calls.length - 1];
        },
    });

    assert.equal(rows.length, 2);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].context, 'The child ate an _____ after school.');
    assert.equal(calls[1].context, 'The child packed an _____ for the long trip.');
    assert.deepEqual(calls[1].excludedDistractors, generatedSets[0]);

    const distractorsFor = row => row.options
        .map(option => option.slice(3))
        .filter(option => option !== word.word)
        .sort();
    assert.deepEqual(distractorsFor(rows[0]), [...generatedSets[0]].sort());
    assert.deepEqual(distractorsFor(rows[1]), [...generatedSets[1]].sort());
});

test('cache builder refuses to publish two stems with the same distractor set', async () => {
    let calls = 0;
    const rows = await buildCacheQuestionRowsForWord({
        user, word, level: LEVEL, roundType: 'primary', translateWords,
        translateContext,
        generateContext: async () => 'The child packed an apple for the long trip.',
        generateDistractors: async () => {
            calls += 1;
            return ['pear', 'banana', 'orange'];
        },
    });

    assert.deepEqual(rows, []);
    assert.ok(calls > 2, 'the second stem should be retried before the pair is rejected');
});

test('cache builder rejects variants sharing two distractors', async () => {
    const generatedSets = [
        ['pear', 'banana', 'orange'],
        ['pear', 'banana', 'biscuit'],
        ['pear', 'banana', 'snack'],
        ['pear', 'banana', 'sandwich'],
    ];
    let call = 0;
    const rows = await buildCacheQuestionRowsForWord({
        user, word, level: LEVEL, roundType: 'primary', translateWords,
        translateContext,
        generateContext: async () => 'The child packed an apple for the long trip.',
        generateDistractors: async () => generatedSets[call++],
    });

    assert.deepEqual(rows, []);
});

test('cache builder permits variants sharing only one contextually valid distractor', async () => {
    const generatedSets = [
        ['pear', 'banana', 'orange'],
        ['pear', 'snack', 'biscuit'],
    ];
    let call = 0;
    const rows = await buildCacheQuestionRowsForWord({
        user, word, level: LEVEL, roundType: 'primary', translateWords,
        translateContext,
        generateContext: async () => 'The child packed an apple for the long trip.',
        generateDistractors: async () => generatedSets[call++],
    });

    assert.equal(rows.length, 2);
    assert.equal(call, 2);
    const distractorSets = rows.map(row => row.options
        .map(option => option.replace(/^[A-D]\.\s+/, ''))
        .filter(option => option !== word.word));
    assert.equal(distractorSets[0].filter(option => distractorSets[1].includes(option)).length, 1);
});

test('cache builder rejects stems that differ only by whitespace', async () => {
    let call = 0;
    const rows = await buildCacheQuestionRowsForWord({
        user, word, level: LEVEL, roundType: 'primary', translateWords,
        translateContext,
        generateContext: async () => 'The  child ate an apple after school.',
        generateDistractors: async () => call++ === 0
            ? ['pear', 'banana', 'orange']
            : ['snack', 'sandwich', 'biscuit'],
    });

    assert.deepEqual(rows, []);
});
