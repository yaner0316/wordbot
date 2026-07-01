const test = require('node:test');
const assert = require('node:assert/strict');

const { enrichQuestionOptionMeanings } = require('../option-meanings');

test('adds Chinese meanings for all four options and translates only missing words', async () => {
    const questions = [{
        answer: 'A',
        correctMeaning: '仁慈的',
        options: ['A. benevolent', 'B. ambiguous', 'C. resilient', 'D. compelling'],
    }];
    const records = [
        { record_id: 'ambiguous-id', fields: { Word: 'ambiguous', CN_Meaning: '模棱两可的' } },
        { record_id: 'resilient-id', fields: { Word: 'resilient', CN_Meaning: '' } },
    ];
    let requestedWords = [];
    const updates = [];

    await enrichQuestionOptionMeanings({
        questions,
        records,
        translateWords: async words => {
            requestedWords = words;
            return {
                resilient: '有韧性的',
                compelling: '令人信服的',
            };
        },
        updateRecord: async (recordId, fields) => updates.push({ recordId, fields }),
    });

    assert.deepEqual(requestedWords.sort(), ['compelling', 'resilient']);
    assert.deepEqual(questions[0].optionMeanings, [
        '仁慈的',
        '模棱两可的',
        '有韧性的',
        '令人信服的',
    ]);
    assert.deepEqual(updates, [{
        recordId: 'resilient-id',
        fields: { CN_Meaning: '有韧性的' },
    }]);
});

test('uses one translation for repeated missing options', async () => {
    const questions = [
        { options: ['A. feasible', 'B. genuine'] },
        { options: ['A. genuine', 'B. feasible'] },
    ];
    let requestedWords = [];

    await enrichQuestionOptionMeanings({
        questions,
        records: [],
        translateWords: async words => {
            requestedWords = words;
            return { feasible: '可行的', genuine: '真诚的' };
        },
    });

    assert.deepEqual(requestedWords.sort(), ['feasible', 'genuine']);
    assert.deepEqual(questions[1].optionMeanings, ['真诚的', '可行的']);
});

test('keeps the tested meaning separate for multi-definition questions', async () => {
    const questions = [
        {
            answer: 'A',
            correctMeaning: '银行',
            options: ['A. bank', 'B. shore'],
        },
        {
            answer: 'A',
            correctMeaning: '河岸',
            options: ['A. bank', 'B. finance'],
        },
    ];

    await enrichQuestionOptionMeanings({
        questions,
        records: [],
        translateWords: async () => ({ shore: '岸边', finance: '金融' }),
    });

    assert.equal(questions[0].optionMeanings[0], '银行');
    assert.equal(questions[1].optionMeanings[0], '河岸');
});

test('retries translateWords once for words that returned empty on the first call', async () => {
    const questions = [{
        answer: 'A',
        correctMeaning: '仁慈的',
        options: ['A. benevolent', 'B. stoic', 'C. resilient', 'D. candid'],
    }];
    let callCount = 0;

    await enrichQuestionOptionMeanings({
        questions,
        records: [],
        translateWords: async words => {
            callCount++;
            if (callCount === 1) return { stoic: '坚忍的' };
            return { resilient: '有韧性的', candid: '坦率的' };
        },
    });

    assert.equal(callCount, 2);
    assert.equal(questions[0].optionMeanings[1], '坚忍的');
    assert.equal(questions[0].optionMeanings[2], '有韧性的');
    assert.equal(questions[0].optionMeanings[3], '坦率的');
});
