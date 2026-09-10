'use strict';

const { requestChineseSenses } = require('./supabase-translations');

function normalizeLookupWord(value) {
    const word = String(value || '').trim().toLowerCase();
    if (!/^[a-z]+(?:[ '-][a-z]+)*$/.test(word)) throw new Error('DICTIONARY_WORD_REQUIRED');
    return word;
}

function normalizeDictionarySenses(entries) {
    const seen = new Set();
    const senses = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
        const cnMeaning = String(entry?.cnMeaning || '').trim();
        const definition = String(entry?.definition || '').trim();
        const partOfSpeech = String(entry?.partOfSpeech || '').trim();
        if (!/^[\u3400-\u9fff，、；（）·]{1,20}$/.test(cnMeaning) || !definition || definition.length > 280 || seen.has(cnMeaning)) continue;
        if (!/^(noun|verb|adjective|adverb|preposition|pronoun|conjunction|interjection|determiner|phrase)$/.test(partOfSpeech)) continue;
        seen.add(cnMeaning);
        senses.push({ partOfSpeech, definition, cnMeaning });
        if (senses.length === 8) break;
    }
    return senses;
}

async function lookupDictionarySenses(word, { request = requestChineseSenses } = {}) {
    const normalized = normalizeLookupWord(word);
    if (normalized.length > 80) throw new Error('DICTIONARY_WORD_REQUIRED');
    const prompt = [
        '你是严谨的英汉学习词典。为以下英文单词或短语返回真实、常用、不同的义项，按常用程度排序。',
        JSON.stringify(normalized),
        '只返回JSON数组，最多8项，不要凑数。每项包含cnMeaning（简体中文短语，通常2至8字，最多20字）、definition（对应英文释义）、partOfSpeech（英文词性全称，小写）。',
        '中文只写简洁释义，不加英文、词性、编号、例句或解释句。合并重复义项。不是有效英文词或无法确定含义时返回空数组，不要猜测或纠正拼写。',
        '例如bank: [{"cnMeaning":"银行","definition":"a financial institution","partOfSpeech":"noun"},{"cnMeaning":"河岸","definition":"the land along a river","partOfSpeech":"noun"}]',
    ].join('\n');
    for (let attempt = 0; attempt < 2; attempt++) {
        const raw = await request(prompt);
        let parsed;
        try { parsed = JSON.parse(String(raw).replace(/^```(?:json)?\s*|\s*```$/gi, '').trim()); } catch { continue; }
        if (Array.isArray(parsed) && !parsed.length) throw new Error('DICTIONARY_SENSES_NOT_FOUND');
        const senses = normalizeDictionarySenses(parsed);
        if (senses.length) return senses;
    }
    throw new Error('DICTIONARY_LOOKUP_FAILED');
}

module.exports = { lookupDictionarySenses, normalizeDictionarySenses };
