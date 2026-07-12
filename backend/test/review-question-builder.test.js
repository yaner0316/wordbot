const test = require('node:test');
const assert = require('node:assert/strict');

const { createReviewQuestionBuilder } = require('../review-question-builder');

function makeBuilder(overrides = {}) {
    const buildCalls = [];
    const builder = createReviewQuestionBuilder({
        buildQuizQuestion: (
            recordId,
            info,
            type,
            reviewId,
            letters,
            options
        ) => {
            buildCalls.push({ recordId, info, type, reviewId, letters, options });
            const distractors = options.forcedDistractors;
            return {
                type,
                word: info.word,
                context: info.context || info.meaning || info.CN_Meaning,
                options: [info.word, ...distractors],
                answer: 'A',
                correctMeaning: info.CN_Meaning || '',
                record_id: recordId,
            };
        },
        rewriteContext: async ({ info }) => ({
            ...info,
            context: `A new context containing ${info.word} for careful review.`,
        }),
        generateDistractors: async () => ['new-a', 'new-b', 'new-c'],
        chooseType: types => types[0],
        ...overrides,
    });
    return { builder, buildCalls };
}

test('changes question type when another valid type exists', async () => {
    const { builder } = makeBuilder();

    const question = await builder({
        reviewId: 'real-review-r1',
        source: {
            type: 1,
            recordId: 'word-1',
            options: ['A. target', 'B. old-a', 'C. old-b', 'D. old-c'],
        },
        info: {
            word: 'target',
            context: 'This sentence contains target with enough useful clues.',
            meaning: 'the intended object',
            CN_Meaning: '目标',
        },
        usedDistractors: new Set(),
    });

    assert.notEqual(question.type, 1);
});

test('can preserve the source question type and rewrite it even when alternatives exist', async () => {
    const { builder, buildCalls } = makeBuilder({
        preferSourceType: true,
    });

    const question = await builder({
        reviewId: 'real-review-r1',
        source: {
            type: 1,
            recordId: 'word-1',
            context: 'Old target context with enough useful clue words.',
            options: ['A. target', 'B. old-a', 'C. old-b', 'D. old-c'],
        },
        info: {
            word: 'target',
            context: 'Old target context with enough useful clue words.',
            meaning: 'the intended object',
            CN_Meaning: '目标',
        },
        usedDistractors: new Set(),
    });

    assert.equal(question.type, 1);
    assert.equal(buildCalls[0].type, 1);
    assert.notEqual(
        buildCalls[0].info.context,
        'Old target context with enough useful clue words.'
    );
});
test('replaces all three wrong options and excludes earlier review options', async () => {
    let exclusions;
    const { builder, buildCalls } = makeBuilder({
        generateDistractors: async input => {
            exclusions = input.excludedDistractors;
            return ['fresh-a', 'fresh-b', 'fresh-c'];
        },
    });

    await builder({
        reviewId: 'real-review-r1',
        source: {
            type: 2,
            recordId: 'word-1',
            options: ['A. target', 'B. old-a', 'C. old-b', 'D. old-c'],
        },
        info: {
            word: 'target',
            context: 'This sentence contains target with enough useful clues.',
            meaning: 'the intended object',
            CN_Meaning: '目标',
        },
        usedDistractors: new Set(['prior-a']),
    });

    assert.deepEqual(
        [...exclusions].sort(),
        ['old-a', 'old-b', 'old-c', 'prior-a']
    );
    assert.deepEqual(
        buildCalls[0].options.forcedDistractors,
        ['fresh-a', 'fresh-b', 'fresh-c']
    );
});

test('rewrites context when the same type is the only valid type', async () => {
    const { builder, buildCalls } = makeBuilder();

    await builder({
        reviewId: 'real-review-r1',
        source: {
            type: 1,
            recordId: 'word-1',
            context: 'Old target context with enough useful clue words.',
            options: ['A. target', 'B. old-a', 'C. old-b', 'D. old-c'],
        },
        info: {
            word: 'target',
            context: 'Old target context with enough useful clue words.',
            meaning: '',
            CN_Meaning: '',
        },
        usedDistractors: new Set(),
    });

    assert.equal(buildCalls[0].type, 1);
    assert.notEqual(
        buildCalls[0].info.context,
        'Old target context with enough useful clue words.'
    );
});

test('rejects a review question without three unique new distractors', async () => {
    const { builder } = makeBuilder({
        generateDistractors: async () => ['new-a', 'new-a', 'new-b'],
    });

    await assert.rejects(
        builder({
            reviewId: 'real-review-r1',
            source: {
                type: 2,
                recordId: 'word-1',
                options: ['A. target', 'B. old-a', 'C. old-b', 'D. old-c'],
            },
            info: {
                word: 'target',
                meaning: 'the intended object',
                CN_Meaning: '目标',
            },
            usedDistractors: new Set(),
        }),
        /三个新的合格错误选项/
    );
});

test('preserves the exact meaning record and correct meaning', async () => {
    const { builder } = makeBuilder();

    const question = await builder({
        reviewId: 'real-review-r1',
        source: {
            type: 3,
            recordId: 'bank-river',
            options: ['A. bank', 'B. old-a', 'C. old-b', 'D. old-c'],
        },
        info: {
            word: 'bank',
            context: 'They sat on the bank beside the quiet river.',
            meaning: 'land beside a river',
            CN_Meaning: '河岸',
        },
        usedDistractors: new Set(),
    });

    assert.equal(question.record_id, 'bank-river');
    assert.equal(question.correctMeaning, '河岸');
});
