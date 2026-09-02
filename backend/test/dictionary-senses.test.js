const test = require('node:test');
const assert = require('node:assert/strict');
const { lookupDictionarySenses, normalizeDictionarySenses } = require('../dictionary-senses');

test('normalizes a dictionary response into distinct selectable senses', () => {
    const senses = normalizeDictionarySenses([
        { meanings: [
            { partOfSpeech: 'noun', definitions: [{ definition: 'the side of a river' }, { definition: 'the side of a river' }] },
            { partOfSpeech: 'noun', definitions: [{ definition: 'a financial institution' }] },
        ] },
    ]);

    assert.deepEqual(senses, [
        { partOfSpeech: 'noun', definition: 'the side of a river' },
        { partOfSpeech: 'noun', definition: 'a financial institution' },
    ]);
});

test('rejects blank and excessively long definitions from a dictionary response', () => {
    const senses = normalizeDictionarySenses([{ meanings: [{
        partOfSpeech: 'verb',
        definitions: [{ definition: '' }, { definition: 'x'.repeat(281) }, { definition: 'to rest on a surface' }],
    }] }]);

    assert.deepEqual(senses, [{ partOfSpeech: 'verb', definition: 'to rest on a surface' }]);
});

test('looks up a single English word and returns selectable dictionary senses', async () => {
    let requestedUrl = '';
    const senses = await lookupDictionarySenses('bank', {
        fetchImpl: async url => {
            requestedUrl = url;
            return { ok: true, json: async () => [{ meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'a financial institution' }] }] }] };
        },
    });

    assert.equal(requestedUrl, 'https://api.dictionaryapi.dev/api/v2/entries/en/bank');
    assert.deepEqual(senses, [{ partOfSpeech: 'noun', definition: 'a financial institution' }]);
});

test('refuses a non-word before making a dictionary request', async () => {
    await assert.rejects(
        () => lookupDictionarySenses('bank/river', { fetchImpl: async () => { throw new Error('must not fetch'); } }),
        /DICTIONARY_WORD_REQUIRED/
    );
});
