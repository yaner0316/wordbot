'use strict';
const crypto = require('crypto');
const { sessionSecret, normalizeUser } = require('./session-auth');
const { normalizeDictionarySenses } = require('./dictionary-senses');
const TTL = 24 * 60 * 60 * 1000;
const failure = () => Object.assign(new Error('请重新查询并选择每个单词的具体词义'), { code: 'SELECTED_SENSE_REQUIRED' });
function signature(payload, secret) {
    if (process.env.NODE_ENV === 'production' && !secret && !process.env.WORDBOT_SESSION_SECRET && !process.env.WORDBOT_ADMIN_TOKEN) {
        throw Object.assign(new Error('词义选择暂不可用，请稍后重试'), {code:'SELECTION_SIGNING_NOT_CONFIGURED'});
    }
    return crypto.createHmac('sha256', sessionSecret(secret)).update('dictionary-selection-v1.' + payload).digest('base64url');
}

function issueSenseSelection(word, sense, user, { secret, now = Date.now() } = {}) {
    const normalized = String(word || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const clean = normalizeDictionarySenses([sense], normalized)[0];
    if (!normalizeUser(user) || !clean || !/^[a-z]+(?:[ '-][a-z]+)*$/.test(normalized)) throw failure();
    const payload = Buffer.from(JSON.stringify({ user: normalizeUser(user), word: normalized,
        meaning: clean.definition, cnMeaning: clean.cnMeaning, POS: clean.partOfSpeech, expiresAt: now + TTL })).toString('base64url');
    return payload + '.' + signature(payload, secret);
}

function selectedEntries(user, entries, { secret, now = Date.now() } = {}) {
    if (!normalizeUser(user) || !Array.isArray(entries) || !entries.length || entries.length > 400) throw failure();
    const seen = new Set();
    return entries.map(entry => {
        if (!entry || typeof entry !== 'object' || typeof entry.selectionToken !== 'string' || entry.selectionToken.length > 4096) throw failure();
        const [payload, signed, extra] = entry.selectionToken.split('.');
        if (!payload || !signed || extra) throw failure();
        const actual = Buffer.from(signed), expected = Buffer.from(signature(payload, secret));
        if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw failure();
        let sense;
        try { sense = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw failure(); }
        if (sense.user !== normalizeUser(user) || !Number.isFinite(sense.expiresAt) || sense.expiresAt <= now
            || sense.word !== String(entry.word || '').trim().toLowerCase().replace(/\s+/g, ' ')) throw failure();
        for (const [field, canonical] of [['meaning','meaning'],['meaningZh','cnMeaning'],['cnMeaning','cnMeaning'],['POS','POS'],['pos','POS']]) {
            if (entry[field] !== undefined && entry[field] !== sense[canonical]) throw failure();
        }
        return { word: sense.word, meaning: sense.meaning, cnMeaning: sense.cnMeaning, POS: sense.POS };
    }).filter(entry => {
        const key = JSON.stringify(entry);
        if (seen.has(key)) return false;
        seen.add(key); return true;
    });
}
module.exports = { issueSenseSelection, selectedEntries };
