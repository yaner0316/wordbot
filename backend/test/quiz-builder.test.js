const test = require('node:test');
const assert = require('node:assert/strict');

const { createQuizBuilder } = require('../quiz-builder');
const { normalizeArticleContext } = require('../article-context');

function createBuilder() {
    return createQuizBuilder({
        choose: (items, count) => items.slice(0, count),
        escapeRegExp: text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        getWordForms: word => [word],
        isContextUsableForWord: (word, context) =>
            new RegExp(`\\b${word}\\b`, 'i').test(context || ''),
        normalizeArticleContext,
    });
}

function createBuilderWithPool() {
    return createQuizBuilder({
        choose: (items, count) => items.slice(0, count),
        escapeRegExp: text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        getWordForms: word => [word],
        isContextUsableForWord: (word, context) =>
            new RegExp(`\\b${word}\\b`, 'i').test(context || ''),
        normalizeArticleContext,
        getFallbackDistractors: () => ['fresh-a', 'fresh-b', 'fresh-c'],
    });
}

test('builds a fill-in question and neutralizes the indefinite article', () => {
    const buildQuizQuestion = createBuilder();

    const question = buildQuizQuestion(
        'rec-1',
        {
            word: 'opportunity',
            context: 'It was an opportunity to learn.',
            distractors: ['abandon', 'significant', 'genuine'],
            CN_Meaning: '机会',
        },
        1,
        'test-1',
        ['A', 'B', 'C', 'D']
    );

    assert.deepEqual(question, {
        type: 1,
        word: 'opportunity',
        context: 'It was a(n) _____ to learn.',
        options: [
            'A. opportunity',
            'B. abandon',
            'C. significant',
            'D. genuine',
        ],
        answer: 'A',
        articleNormalized: true,
        correctMeaning: '机会',
        testId: 'test-1',
        record_id: 'rec-1',
    });
});

test('builds a definition question from the first semicolon-separated meaning', () => {
    const buildQuizQuestion = createBuilder();

    const question = buildQuizQuestion(
        'rec-2',
        {
            word: 'resilient',
            meaning: 'able to recover quickly; elastic',
            distractors: ['fragile', 'silent', 'ordinary'],
            CN_Meaning: '有韧性的',
        },
        2,
        'test-2',
        ['A', 'B', 'C', 'D']
    );

    assert.equal(question.context, 'able to recover quickly');
    assert.equal(question.answer, 'A');
    assert.equal(question.correctMeaning, '有韧性的');
});

test('rejects a question when fewer than three usable distractors remain', () => {
    const buildQuizQuestion = createBuilder();

    const question = buildQuizQuestion(
        'rec-3',
        {
            word: 'act',
            context: 'They act quickly.',
            distractors: ['acting', 'action', 'act'],
        },
        1,
        'test-3',
        ['A', 'B', 'C', 'D']
    );

    assert.equal(question, null);
});

test('uses forced distractors after excluding previously used options', () => {
    const buildQuizQuestion = createBuilder();

    const question = buildQuizQuestion(
        'rec-4',
        {
            word: 'target',
            meaning: 'the intended object',
            distractors: ['old-a', 'old-b', 'old-c', 'fresh-a', 'fresh-b', 'fresh-c'],
        },
        2,
        'review-1',
        ['A', 'B', 'C', 'D'],
        {
            excludedDistractors: ['old-a', 'old-b', 'old-c'],
            forcedDistractors: ['fresh-a', 'fresh-b', 'fresh-c'],
        }
    );

    assert.deepEqual(question.options, [
        'A. target',
        'B. fresh-a',
        'C. fresh-b',
        'D. fresh-c',
    ]);
});

test('rejects invalid forced distractors instead of reusing old ones', () => {
    const buildQuizQuestion = createBuilder();

    const question = buildQuizQuestion(
        'rec-5',
        {
            word: 'target',
            meaning: 'the intended object',
            distractors: ['old-a', 'old-b', 'old-c'],
        },
        2,
        'review-2',
        ['A', 'B', 'C', 'D'],
        {
            excludedDistractors: ['old-a', 'old-b', 'old-c'],
            forcedDistractors: ['new-a', 'new-a', 'new-b'],
        }
    );

    assert.equal(question, null);
});

test('uses fallback distractors when local distractors were already used in this quiz', () => {
    const buildQuizQuestion = createBuilderWithPool();

    const question = buildQuizQuestion(
        'rec-6',
        {
            word: 'target',
            meaning: 'the intended object',
            distractors: ['old-a', 'old-b', 'old-c'],
        },
        2,
        'test-6',
        ['A', 'B', 'C', 'D'],
        {
            excludedDistractors: ['old-a', 'old-b', 'old-c'],
        }
    );

    assert.deepEqual(question.options, [
        'A. target',
        'B. fresh-a',
        'C. fresh-b',
        'D. fresh-c',
    ]);
});
