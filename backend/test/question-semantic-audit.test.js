const test = require('node:test');
const assert = require('node:assert/strict');
const { auditUniqueAnswer } = require('../question-semantic-audit');

const question = { context: 'Passengers must pay the bus _____ before sitting down.', options: ['A. fare', 'B. charge', 'C. fee', 'D. route'], optionMeanings: ['票价', '费用', '费用', '路线'], answer: 'A' };

test('semantic audit approves only one certain answer matching the configured answer', async () => {
    const result = await auditUniqueAnswer(question, { callModel: async () => '{"validLetters":["A"],"certain":true,"reason":"unique"}' });
    assert.equal(result.approved, true);
    assert.equal(result.status, 'approved');
    assert.equal(result.policyVersion, 'unique-answer-v2');
});

test('semantic audit rejects multiple valid synonyms and uncertain results', async () => {
    const multiple = await auditUniqueAnswer(question, { callModel: async () => '{"validLetters":["A","C"],"certain":true,"reason":"both fit"}' });
    const uncertain = await auditUniqueAnswer(question, { callModel: async () => '{"validLetters":["A"],"certain":false}' });
    assert.equal(multiple.approved, false);
    assert.equal(uncertain.approved, false);
});

test('semantic audit instructs the reviewer to reject every plausible alternate completion', async () => {
    let prompt = '';
    const result = await auditUniqueAnswer({
        context: 'After the bell rang, the library was _____ as students opened their books to study.',
        options: ['A. chaotic', 'B. crowded', 'C. empty', 'D. quiet'],
        optionMeanings: ['混乱的', '拥挤的', '空荡的', '安静的'],
        answer: 'D',
    }, {
        callModel: async value => {
            prompt = value;
            return '{"validLetters":["B","D"],"certain":true,"reason":"both complete the sentence"}';
        },
    });

    assert.match(prompt, /plausibly complete the sentence/i);
    assert.equal(result.approved, false);
    assert.deepEqual(result.validLetters, ['B', 'D']);
});

test('semantic audit rejects the reported schoolyard sports question when several options fit', async () => {
    const result = await auditUniqueAnswer({
        context: 'After school, my brother and I usually play _____ in the schoolyard.',
        options: ['A. soccer', 'B. hockey', 'C. badminton', 'D. tennis'],
        optionMeanings: ['足球', '曲棍球', '羽毛球', '网球'],
        answer: 'A',
    }, { callModel: async () => '{"validLetters":["A","B","C","D"],"certain":true,"reason":"several sports fit"}' });

    assert.equal(result.approved, false);
    assert.deepEqual(result.validLetters, ['A', 'B', 'C', 'D']);
});

test('semantic audit rejects the reported haircut question when its configured answer is wrong', async () => {
    const result = await auditUniqueAnswer({
        context: 'My older brother called my new haircut a _____, but I think it looks pretty cool for middle school.',
        options: ['A. stunt', 'B. test', 'C. quiz', 'D. joke'],
        optionMeanings: ['特技', '测试', '小测验', '笑话'],
        answer: 'C',
    }, { callModel: async () => '{"validLetters":["D"],"certain":true,"reason":"only joke fits"}' });

    assert.equal(result.approved, false);
    assert.deepEqual(result.validLetters, ['D']);
});

test('semantic audit fails closed when the model is unavailable or malformed', async () => {
    const unavailable = await auditUniqueAnswer(question, { callModel: async () => { throw new Error('offline'); } });
    const malformed = await auditUniqueAnswer(question, { callModel: async () => 'not json' });
    assert.equal(unavailable.status, 'unavailable');
    assert.equal(malformed.approved, false);
});
