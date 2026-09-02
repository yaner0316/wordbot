'use strict';

const MAX_DEFINITION_LENGTH = 280;
const MAX_SENSE_COUNT = 12;

function normalizeLookupWord(value) {
    const word = String(value || '').trim().toLowerCase();
    if (!/^[a-z]+(?:[ '-][a-z]+)*$/.test(word)) throw new Error('DICTIONARY_WORD_REQUIRED');
    return word;
}

function normalizeDictionarySenses(entries) {
    const seen = new Set();
    const senses = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
        for (const meaning of Array.isArray(entry?.meanings) ? entry.meanings : []) {
            const partOfSpeech = String(meaning?.partOfSpeech || '').trim();
            for (const item of Array.isArray(meaning?.definitions) ? meaning.definitions : []) {
                const definition = String(item?.definition || '').replace(/\s+/g, ' ').trim();
                const key = `${partOfSpeech}\u0000${definition}`.toLowerCase();
                if (!definition || definition.length > MAX_DEFINITION_LENGTH || seen.has(key)) continue;
                seen.add(key);
                senses.push({ partOfSpeech, definition });
                if (senses.length >= MAX_SENSE_COUNT) return senses;
            }
        }
    }
    return senses;
}

async function lookupDictionarySenses(word, { fetchImpl = globalThis.fetch } = {}) {
    const normalized = normalizeLookupWord(word);
    if (typeof fetchImpl !== 'function') throw new Error('DICTIONARY_UNAVAILABLE');
    const response = await fetchImpl(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(normalized)}`);
    if (!response?.ok) throw new Error('DICTIONARY_LOOKUP_FAILED');
    const senses = normalizeDictionarySenses(await response.json());
    if (!senses.length) throw new Error('DICTIONARY_SENSES_NOT_FOUND');
    return senses;
}

module.exports = { lookupDictionarySenses, normalizeDictionarySenses };
