'use strict';

const MAX_CHINESE_MEANING_LENGTH = 20;

function isConciseChineseMeaning(value) {
    const text = String(value ?? '').trim();
    return text.length > 0 && Array.from(text).length <= MAX_CHINESE_MEANING_LENGTH;
}

function normalizeChineseMeaning(value) {
    const text = String(value ?? '').trim();
    if (Array.from(text).length > MAX_CHINESE_MEANING_LENGTH) {
        const error = new Error('中文释义最多20字，请使用简短译词或短语');
        error.code = 'CHINESE_MEANING_TOO_LONG';
        error.statusCode = 400;
        throw error;
    }
    return text;
}

module.exports = { MAX_CHINESE_MEANING_LENGTH, isConciseChineseMeaning, normalizeChineseMeaning };
