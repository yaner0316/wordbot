const test = require('node:test');
const assert = require('node:assert/strict');
const { lookupDictionarySenses, normalizeDictionarySenses } = require('../dictionary-senses');

test('normalizes a dictionary response into distinct selectable senses', () => {
    const senses = normalizeDictionarySenses([
        { partOfSpeech: 'noun', definition: 'the side of a river', cnMeaning: '河岸' },
        { partOfSpeech: 'noun', definition: 'the side of a river', cnMeaning: '河岸' },
        { partOfSpeech: 'noun', definition: 'a financial institution', cnMeaning: '银行' },
    ]);

    assert.deepEqual(senses, [
        { partOfSpeech: 'noun', definition: 'the side of a river', cnMeaning: '河岸' },
        { partOfSpeech: 'noun', definition: 'a financial institution', cnMeaning: '银行' },
    ]);
});

test('merges synonymous labels for the same definition without merging different meanings', () => {
    assert.deepEqual(normalizeDictionarySenses([
        { partOfSpeech: 'noun', definition: 'A person with exceptional ability.', cnMeaning: '天才' },
        { partOfSpeech: 'noun', definition: 'a person with exceptional ability', cnMeaning: '天才人物' },
        { partOfSpeech: 'noun', definition: 'exceptional natural ability', cnMeaning: '天赋' },
    ]).map(sense => sense.cnMeaning), ['天才', '天赋']);
});

test('keeps a short Chinese usage note but never exposes an English usage note', () => {
    const senses = normalizeDictionarySenses([
        { partOfSpeech: 'noun', definition: 'a person with exceptional ability', cnMeaning: '天才', usageNote: '指能力非凡的人' },
        { partOfSpeech: 'noun', definition: 'exceptional natural ability', cnMeaning: '天赋', usageNote: 'natural ability' },
    ]);
    assert.equal(senses[0].usageNote, '指能力非凡的人');
    assert.equal(senses[1].usageNote, undefined);
});

test('rejects blank and excessively long definitions from a dictionary response', () => {
    const senses = normalizeDictionarySenses([
        { partOfSpeech: 'verb', definition: '', cnMeaning: '放置' },
        { partOfSpeech: 'verb', definition: 'x'.repeat(281), cnMeaning: '放置' },
        { partOfSpeech: 'verb', definition: 'to rest on a surface', cnMeaning: '放置' },
        { partOfSpeech: 'noun', definition: 'bank', cnMeaning: 'noun 银行' },
        { partOfSpeech: 'noun', definition: 'bank', cnMeaning: '<b>银行</b>' },
    ]);

    assert.deepEqual(senses, [{ partOfSpeech: 'verb', definition: 'to rest on a surface', cnMeaning: '放置' }]);
});

test('looks up a single English word and returns selectable dictionary senses', async () => {
    let requestedPrompt = '';
    const senses = await lookupDictionarySenses('bank', {
        request: async prompt => {
            requestedPrompt = prompt;
            return JSON.stringify([{ partOfSpeech: 'noun', definition: 'a financial institution', cnMeaning: '银行' }]);
        },
    });

    assert.match(requestedPrompt, /"bank"/);
    assert.deepEqual(senses, [{ partOfSpeech: 'noun', definition: 'a financial institution', cnMeaning: '银行' }]);
});

test('refuses a non-word before making a dictionary request', async () => {
    await assert.rejects(
        () => lookupDictionarySenses('bank/river', { request: async () => { throw new Error('must not fetch'); } }),
        /DICTIONARY_WORD_REQUIRED/
    );
});

test('English-only output never becomes a selectable sense and retries are bounded', async () => {
    let calls = 0;
    await assert.rejects(lookupDictionarySenses('bank', { request: async () => {
        calls++;
        return JSON.stringify([{ partOfSpeech: 'noun', definition: 'a financial institution', cnMeaning: 'bank' }]);
    } }), /DICTIONARY_LOOKUP_FAILED/);
    assert.equal(calls, 2);
});
test('unknown words return a distinct not-found error', async () => {
    await assert.rejects(lookupDictionarySenses('zzqqxx', { request: async () => '[]' }), /DICTIONARY_SENSES_NOT_FOUND/);
});
