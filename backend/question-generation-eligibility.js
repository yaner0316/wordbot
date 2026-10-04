'use strict';

// Match the existing claim RPC's btrim + English spelling gate exactly.
// In particular, tabs/newlines are invalid, not silently stripped as spaces.
function normalizeGenerationWord(value) {
    return String(value ?? '').replace(/^ +| +$/g, '');
}

function isValidGenerationWord(value) {
    const spelling = normalizeGenerationWord(value);
    const match = spelling.match(/^[a-z]+(?:[ '-][a-z]+)*$/i);
    return spelling.toLowerCase() !== 'genaine' && Boolean(match && match[0] === spelling);
}

function invalidGenerationWordError() {
    const error = new Error('单词格式不支持生成正式题目，请使用英文字母、空格、连字符或撇号，并检查拼写。');
    error.code = 'INVALID_GENERATION_WORD';
    return error;
}

// Read-side classification only: no job status or historical row is rewritten.
function classifyGenerationJobs(rows, words) {
    if (!Array.isArray(words)) return rows || [];
    const byId = new Map(words.map(word => [String(word.id), word]));
    return (rows || []).map(row => {
        const word = byId.get(String(row.word_id));
        if (!word || String(word.user_id) !== String(row.user_id)
            || !['pending', 'generating', 'validating', 'repairing', 'retry_wait'].includes(row.status)
            || ['mastered', 'deleted'].includes(String(word.mastery_status || '').trim().toLowerCase())
            || word.deleted_at
            || !Number.isFinite(Number(row.word_version)) || Number(row.word_version) < 1
            || Number(word.question_generation_version) !== Number(row.word_version)
            || isValidGenerationWord(word.word)) return row;
        return { ...row, generationBlockReason: 'INVALID_GENERATION_WORD' };
    });
}

module.exports = { normalizeGenerationWord, isValidGenerationWord, invalidGenerationWordError, classifyGenerationJobs };
