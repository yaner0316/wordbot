function getFieldValue(value) {
    if (Array.isArray(value)) return value.map(getFieldValue).filter(Boolean).join(', ');
    if (value && typeof value === 'object') {
        if ('text' in value) return String(value.text || '').trim();
        if ('name' in value) return String(value.name || '').trim();
        if ('value' in value) return String(value.value || '').trim();
    }
    return String(value ?? '').trim();
}

function firstField(fields, names) {
    for (const name of names) {
        const value = getFieldValue(fields?.[name]);
        if (value) return value;
    }
    return '';
}

function normalizeUserKey(value) {
    return getFieldValue(value).trim().toLowerCase();
}

function getOriginalUser(record) {
    return firstField(record?.fields || record || {}, ['user', 'User', 'username', 'Username']);
}

function parseJsonValue(value) {
    if (value == null || value === '') return null;
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch { return value; }
}

function toTimestamp(value) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return new Date(number).toISOString();
    const date = new Date(String(value || ''));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const CACHE_REQUIRED_FIELDS = ['question_text', 'options', 'answer'];
const CACHE_SUPPORTING_FIELDS = ['quality_status', 'question_type', 'round_type', 'used_count', 'word_record_id', 'level'];

function inspectQuestionCacheRecord(record) {
    const fields = record?.fields || {};
    const hasRequiredShape = CACHE_REQUIRED_FIELDS.every(name => Object.hasOwn(fields, name));
    if (!hasRequiredShape) return { valid: false, reason: 'NOT_QUESTION_CACHE_SOURCE' };
    const feishuRecordId = String(record?.record_id || record?.recordId || '').trim();
    const originalUser = getOriginalUser(record);
    const word = firstField(fields, ['word', 'Word']);
    if (!feishuRecordId || !normalizeUserKey(originalUser) || !word) return { valid: false, reason: 'INVALID_CACHE_ROW' };
    return { valid: true, supportingSignals: CACHE_SUPPORTING_FIELDS.filter(name => Object.hasOwn(fields, name)) };
}

function mapQuestionCacheRecord(record, batch, lookups = {}) {
    const fields = record?.fields || {};
    const feishuRecordId = String(record?.record_id || record?.recordId || '').trim();
    const originalUser = getOriginalUser(record);
    const userKey = normalizeUserKey(originalUser);
    const word = firstField(fields, ['word', 'Word']);
    const sourceWordRecordId = firstField(fields, ['word_record_id', 'wordRecordId']);
    const user = lookups.usersByUsername?.get(userKey);
    let wordRow = sourceWordRecordId ? lookups.wordsByRecord?.get(sourceWordRecordId) : null;
    if (wordRow && user && String(wordRow.user_id) !== String(user.id)) wordRow = null;
    if (!wordRow && user) wordRow = lookups.wordsByUserWord?.get(String(user.id) + '\u0000' + word.toLowerCase());
    const options = parseJsonValue(fields.options);
    const optionMeanings = parseJsonValue(fields.option_meanings);
    const questionText = firstField(fields, ['question_text', 'questionText']);
    const answer = firstField(fields, ['answer', 'Answer']);
    if (!feishuRecordId || !user || !wordRow || !word || !questionText || !answer || !Array.isArray(options) || !Array.isArray(optionMeanings)) return null;
    const generatedAt = toTimestamp(firstField(fields, ['generated_at', 'generatedAt'])) || batch.syncedAt;
    return {
        feishu_record_id: feishuRecordId,
        user_id: user.id,
        word_id: wordRow.id,
        source_word_record_id: sourceWordRecordId || wordRow.feishu_record_id || null,
        level: firstField(fields, ['level', 'learning_level', 'learningLevel']) || user.learning_level || wordRow.level || '中学',
        question_type: String(firstField(fields, ['question_type', 'questionType']) || '1'),
        round_type: firstField(fields, ['round_type', 'roundType']) || 'primary',
        quality_status: firstField(fields, ['quality_status', 'qualityStatus']) || 'pending',
        question_text: questionText,
        context_zh: firstField(fields, ['context_cn', 'context_zh', 'contextZh']) || null,
        options,
        answer,
        option_meanings: optionMeanings,
        correct_meaning: firstField(fields, ['correct_meaning', 'correctMeaning']) || null,
        ai_audit_status: firstField(fields, ['ai_audit_status', 'aiAuditStatus']) || null,
        source_version: firstField(fields, ['source_version', 'sourceVersion']) || 'feishu-stage1',
        used_count: Number(firstField(fields, ['used_count', 'usedCount']) || 0) || 0,
        last_used_at: toTimestamp(firstField(fields, ['last_used_at', 'lastUsedAt'])),
        generated_at: generatedAt,
        ...(toTimestamp(record.created_time) ? { created_at: toTimestamp(record.created_time) } : {}),
        ...(toTimestamp(record.last_modified_time || record.updated_time) ? { updated_at: toTimestamp(record.last_modified_time || record.updated_time) } : {}),
    };
}
function collectUserAliases(records) {
    const aliases = new Map();
    for (const record of records || []) {
        const original = getOriginalUser(record);
        const key = normalizeUserKey(original);
        if (!key) continue;
        if (!aliases.has(key)) aliases.set(key, new Set());
        aliases.get(key).add(original);
    }
    return [...aliases.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([userKey, values]) => {
        const originalUsers = [...values].sort((a, b) => { const lower = a.toLowerCase().localeCompare(b.toLowerCase()); if (lower) return lower; return a === a.toUpperCase() ? -1 : 1; });
        return { userKey, displayName: originalUsers.find(value => value === value[0]?.toUpperCase() + value.slice(1)) || originalUsers[0], originalUsers };
    });
}

function findDuplicateMeanings(records) {
    const groups = new Map();
    for (const record of records || []) {
        const fields = record.fields || {};
        const userKey = normalizeUserKey(getOriginalUser(record));
        const word = firstField(fields, ['Word', 'word']);
        const meaning = firstField(fields, ['Meaning', 'meaning']);
        if (!userKey || !word || !meaning) continue;
        const key = [userKey, word.toLowerCase(), meaning.toLowerCase()].join('\\u0000');
        const item = groups.get(key) || { userKey, word, meaning, feishuCount: 0 };
        item.feishuCount += 1;
        groups.set(key, item);
    }
    return [...groups.values()].filter(item => item.feishuCount > 1);
}

module.exports = { CACHE_REQUIRED_FIELDS, collectUserAliases, findDuplicateMeanings, firstField, getFieldValue, inspectQuestionCacheRecord, mapQuestionCacheRecord, normalizeUserKey, toTimestamp };
