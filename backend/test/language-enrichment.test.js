const test = require('node:test');
const assert = require('node:assert/strict');

const { createContextDifficultyAdapter } = require('../language-enrichment');

test('rewrites only type-one and type-two question contexts', async () => {
    const prompts = [];
    const adaptContextsByLevel = createContextDifficultyAdapter({
        callAI: async prompt => {
            prompts.push(prompt);
            return JSON.stringify({
                rewrites: [
                    { index: 1, text: 'A simple _____ sentence.' },
                    { index: 2, text: 'a simple explanation' },
                ],
            });
        },
    });
    const questions = [
        { type: 1, word: 'clear', context: 'Original _____ sentence.', options: [] },
        { type: 2, word: 'clear', context: 'original definition', options: [] },
        { type: 3, word: 'clear', context: '清楚的', options: [] },
    ];

    const applied = await adaptContextsByLevel(questions, '小学');

    assert.equal(applied, true);
    assert.equal(questions[0].context, 'A simple _____ sentence.');
    assert.equal(questions[1].context, 'a simple explanation');
    assert.equal(questions[2].context, '清楚的');
    assert.match(prompts[0], /elementary school level/);
});

test('returns true without calling AI when no adaptable questions exist', async () => {
    let calls = 0;
    const adaptContextsByLevel = createContextDifficultyAdapter({
        callAI: async () => {
            calls += 1;
            return '';
        },
    });

    const applied = await adaptContextsByLevel(
        [{ type: 3, context: '中文释义' }],
        '中学'
    );

    assert.equal(applied, true);
    assert.equal(calls, 0);
});

test('returns false and keeps contexts when the AI response is invalid', async () => {
    const adaptContextsByLevel = createContextDifficultyAdapter({
        callAI: async () => 'not json',
    });
    const questions = [
        { type: 1, word: 'clear', context: 'Original _____ sentence.', options: [] },
    ];

    const applied = await adaptContextsByLevel(questions, '高中');

    assert.equal(applied, false);
    assert.equal(questions[0].context, 'Original _____ sentence.');
});

test('rejects templated meta-language rewrites and keeps the original context', async () => {
    let calls = 0;
    const adaptContextsByLevel = createContextDifficultyAdapter({
        callAI: async () => {
            calls += 1;
            return JSON.stringify({
            rewrites: [
                {
                    index: 1,
                    text: 'The student made a _____ decision, which clearly illustrates how the word _____ is used.',
                },
            ],
        });
        },
    });
    const questions = [
        {
            type: 1,
            word: 'careful',
            context: 'The student made a _____ decision after checking every detail.',
            options: [],
        },
    ];

    const applied = await adaptContextsByLevel(questions, 'CET4_6_TOEFL');

    assert.equal(calls, 1);
    assert.equal(applied, false);
    assert.equal(
        questions[0].context,
        'The student made a _____ decision after checking every detail.'
    );
});
