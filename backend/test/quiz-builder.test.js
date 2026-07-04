const test = require('node:test');
const assert = require('node:assert/strict');

const { createQuizBuilder } = require('../quiz-builder');
const { normalizeArticleContext } = require('../article-context');
const { getFormKey, inflectWord } = require('../word-inflector');

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

function createInflectingBuilder() {
    return createQuizBuilder({
        choose: (items, count) => items.slice(0, count),
        escapeRegExp: text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        getWordForms: word => [word, inflectWord(word, 'past')],
        isContextUsableForWord: (word, context) => {
            const forms = [word, inflectWord(word, 'past')].join('|');
            return new RegExp(`\\b(${forms})\\b`, 'i').test(context || '');
        },
        normalizeArticleContext,
        getFormKey,
        inflectWord,
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

test('inflects all fill-in options to match the context surface form', () => {
    const buildQuizQuestion = createInflectingBuilder();

    const question = buildQuizQuestion(
        'rec-inflect',
        {
            word: 'abandon',
            context: 'They abandoned the project after the storm damaged the site.',
            distractors: ['accept', 'support', 'continue'],
            CN_Meaning: '放弃',
        },
        1,
        'test-inflect',
        ['A', 'B', 'C', 'D']
    );

    assert.equal(question.context, 'They _____ the project after the storm damaged the site.');
    assert.deepEqual(question.options, [
        'A. abandoned',
        'B. accepted',
        'C. supported',
        'D. continued',
    ]);
    assert.equal(question.answer, 'A');
});

test('rejects fill-in questions with obvious plural list and singular target mismatch', () => {
    const buildQuizQuestion = createBuilder();

    const question = buildQuizQuestion(
        'rec-1b',
        {
            word: 'peach',
            context: 'When preparing the fruit mixture, I combined candied bitter orange peels, green raisins, dried apricots, figs, and peach.',
            distractors: ['eager', 'attribute', 'compute'],
            CN_Meaning: '桃子',
        },
        1,
        'test-1b',
        ['A', 'B', 'C', 'D']
    );

    assert.equal(question, null);
});

test('rejects fill-in questions with numeric quantity and singular target mismatch', () => {
    const buildQuizQuestion = createBuilder();

    const question = buildQuizQuestion(
        'rec-1c',
        {
            word: 'corn',
            context: 'He paid her the nominal fee of two corn of barley.',
            distractors: ['pump', 'cheek', 'kitten'],
            CN_Meaning: '谷物',
        },
        1,
        'test-1c',
        ['A', 'B', 'C', 'D']
    );

    assert.equal(question, null);
});

test('definition questions carry translated stem explanations when available', () => {
    const buildQuizQuestion = createBuilder();

    const question = buildQuizQuestion(
        'rec-def-cn',
        {
            word: 'noun',
            meaning: 'A word that can refer to a person, animal, place, thing, or idea.',
            Meaning_CN: '可以指人、动物、地方、事物或想法的词。',
            distractors: ['verb', 'adjective', 'adverb'],
            CN_Meaning: '名词',
        },
        2,
        'test-def-cn',
        ['A', 'B', 'C', 'D']
    );

    assert.equal(question.contextCN, '可以指人、动物、地方、事物或想法的词。');
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

test('rejects definition questions that contain AI meta-response text', () => {
    const buildQuizQuestion = createBuilder();

    const question = buildQuizQuestion(
        'rec-meta',
        {
            word: 'chick',
            CN_Meaning: "The text you've shared looks like a long passage in Chinese characters. Could you let me know whether you want a translation or decoding?",
            distractors: ['roll', 'handsome', 'cow'],
        },
        3,
        'test-meta',
        ['A', 'B', 'C', 'D']
    );

    assert.equal(question, null);
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


test('does not mix fallback distractors when local distractors are sufficient', () => {
    const buildQuizQuestion = createQuizBuilder({
        choose: (items, count) => items.slice(-count),
        escapeRegExp: text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        getWordForms: word => [word],
        isContextUsableForWord: (word, context) =>
            new RegExp(`\\b${word}\\b`, 'i').test(context || ''),
        normalizeArticleContext,
        getFallbackDistractors: () => ['test_word', 'aware', 'milk'],
    });

    const question = buildQuizQuestion(
        'rec-section',
        {
            word: 'section',
            meaning: 'one of the parts of something',
            distractors: ['introduction', 'conclusion', 'appendix'],
            CN_Meaning: 'part',
        },
        2,
        'test-section',
        ['A', 'B', 'C', 'D']
    );

    assert.deepEqual(
        question.options.map(option => option.replace(/^[A-D]\.\s*/, '')),
        ['section', 'introduction', 'conclusion', 'appendix']
    );
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


test('fill-in questions skip phrase distractors when enough clean single-word options remain', () => {
    const buildQuizQuestion = createQuizBuilder({
        choose: (items, count) => items.slice(0, count),
        escapeRegExp: text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        getWordForms: word => [word],
        isContextUsableForWord: (word, context) =>
            new RegExp(`\\b${word}\\b`, 'i').test(context || ''),
        normalizeArticleContext,
        getFallbackDistractors: () => ['orange', 'grape', 'melon'],
    });

    const question = buildQuizQuestion(
        'rec-phrase-filter',
        {
            word: 'apple',
            meaning: 'fruit',
            context: 'I ate an apple after lunch.',
            distractors: ['agree to', 'pear', 'banana'],
            CN_Meaning: String.fromCharCode(0x82f9, 0x679c),
        },
        1,
        'test-phrase-filter',
        ['A', 'B', 'C', 'D']
    );

    assert.ok(question);
    assert.equal(question.type, 1);
    assert.ok(!question.options.some(option => option.includes('agree to')));
});

test('rejects definition questions that contain Chinese AI meta-response text', () => {
    const buildQuizQuestion = createBuilder();

    const question = buildQuizQuestion(
        'rec-meta-cn',
        {
            word: 'corn',
            CN_Meaning: '您好！您提供的内容非常长，目前没有明确说明您希望我如何处理。您是想让我帮您翻译、摘要或提取关键信息？请告诉我您的具体需求，我将竭诚为您提供帮助！',
            distractors: ['lamb', 'clap', 'eraser'],
        },
        3,
        'test-meta-cn',
        ['A', 'B', 'C', 'D']
    );

    assert.equal(question, null);
});

test('rejects definition questions that contain English AI task-request text', () => {
    const buildQuizQuestion = createBuilder();

    const question = buildQuizQuestion(
        'rec-meta-en-task',
        {
            word: 'lamb',
            CN_Meaning: 'It looks like the message you sent contains a large amount of garbled or encoded text. Could you please let me know what you would like me to do with it?',
            distractors: ['kitten', 'cow', 'foal'],
        },
        3,
        'test-meta-en-task',
        ['A', 'B', 'C', 'D']
    );

    assert.equal(question, null);
});


test('rejects terse English AI garbled-text explanations', () => {
    const buildQuizQuestion = createBuilder();

    const question = buildQuizQuestion(
        'rec-meta-en-garbled',
        {
            word: 'eraser',
            CN_Meaning: "I'm sorry, but I can't make sense of the text you've provided - it appears to be corrupted or garbled.",
            distractors: ['kitten', 'cow', 'foal'],
        },
        3,
        'test-meta-en-garbled',
        ['A', 'B', 'C', 'D']
    );

    assert.equal(question, null);
});
