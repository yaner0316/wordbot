const test = require('node:test');
const assert = require('node:assert/strict');
const { auditUniqueAnswer } = require('../question-semantic-audit');

const question = { context: 'Passengers must pay the bus _____ before sitting down.', options: ['A. fare', 'B. charge', 'C. fee', 'D. route'], optionMeanings: ['票价', '费用', '费用', '路线'], answer: 'A' };

test('semantic audit approves only one certain answer matching the configured answer', async () => {
    const result = await auditUniqueAnswer(question, { callModel: async () => '{"validLetters":["A"],"certain":true,"reason":"unique"}' });
    assert.equal(result.approved, true);
    assert.equal(result.status, 'approved');
});

test('semantic audit rejects multiple valid synonyms and uncertain results', async () => {
    const multiple = await auditUniqueAnswer(question, { callModel: async () => '{"validLetters":["A","C"],"certain":true,"reason":"both fit"}' });
    const uncertain = await auditUniqueAnswer(question, { callModel: async () => '{"validLetters":["A"],"certain":false}' });
    assert.equal(multiple.approved, false);
    assert.equal(uncertain.approved, false);
});

test('semantic audit fails closed when the model is unavailable or malformed', async () => {
    const unavailable = await auditUniqueAnswer(question, { callModel: async () => { throw new Error('offline'); } });
    const malformed = await auditUniqueAnswer(question, { callModel: async () => 'not json' });
    assert.equal(unavailable.status, 'unavailable');
    assert.equal(malformed.approved, false);
});
