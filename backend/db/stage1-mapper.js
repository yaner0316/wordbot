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

function mapQuestionCacheRecord(record, batch) {
    const fields = record?.fields || {};
    const feishuRecordId = String(record?.record_id || record?.recordId || '').trim();
    const originalUser = getOriginalUser(record);
    const userKey = normalizeUserKey(originalUser);
    const word = firstField(fields, ['word', 'Word']);
    if (!feishuRecordId || !userKey || !word) return null;
    return {
        feishu_record_id: feishuRecordId,
        raw_fields: fields,
        sync_batch: batch.id,
        synced_at: batch.syncedAt,
        user_key: userKey,
        original_user: originalUser,
        display_name: originalUser,
        word,
        word_record_id: firstField(fields, ['word_record_id', 'wordRecordId']) || null,
        level: firstField(fields, ['level', 'learning_level', 'learningLevel']) || null,
        round_type: firstField(fields, ['round_type', 'roundType']) || null,
        quality_status: firstField(fields, ['quality_status', 'qualityStatus']) || null,
        status: firstField(fields, ['status', 'Status']) || null,
        question_text: firstField(fields, ['question_text', 'questionText']) || null,
        options: parseJsonValue(fields.options),
        answer: firstField(fields, ['answer', 'Answer']) || null,
        option_meanings: parseJsonValue(fields.option_meanings),
        correct_meaning: firstField(fields, ['correct_meaning', 'correctMeaning']) || null,
        used_count: Number(firstField(fields, ['used_count', 'usedCount']) || 0) || 0,
        generated_at: toTimestamp(firstField(fields, ['generated_at', 'generatedAt'])),
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

module.exports = { collectUserAliases, findDuplicateMeanings, firstField, getFieldValue, mapQuestionCacheRecord, normalizeUserKey, toTimestamp };
