'use strict';

const { usernameKey } = require('./auth-service');
const { hasChineseSentenceTranslation } = require('./context-sentence-translation');
const { hasMeaningfulChineseMeaning } = require('./question-quality');
const { translateSupabaseContext, translateSupabaseWords } = require('./supabase-translations');

const PAGE_SIZE = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WORD_COLUMNS = 'id, user_id, meaning_en, meaning_zh, context_en, context_zh';

function maintenanceDatabaseError(operation, error) {
    const wrapped = new Error('maintenance data service unavailable');
    wrapped.code = 'MAINTENANCE_DATABASE_ERROR';
    wrapped.operation = operation;
    wrapped.cause = error;
    return wrapped;
}

function ensureNoError(error, operation) {
    if (error) throw maintenanceDatabaseError(operation, error);
}

function maintenanceInputError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

async function fetchAllRows(buildQuery, operation) {
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
        ensureNoError(error, operation);
        rows.push(...(data || []));
        if (!data || data.length < PAGE_SIZE) return rows;
    }
}

function normalizeDays(days) {
    if (days === null || days === undefined || days === '') return null;
    const value = Number(days);
    if (!Number.isFinite(value)) {
        throw maintenanceInputError('MAINTENANCE_INVALID_DAYS', 'days must be a finite number');
    }
    return value > 0 ? value : null;
}

function isEmptyDatabaseText(value) {
    return value === null || value === undefined || value === '';
}

function translatedValue(translations, source) {
    if (!translations || typeof translations !== 'object') return '';
    const exact = String(translations[source] || '').trim();
    if (exact) return exact;
    return String(translations[String(source).toLowerCase()] || '').trim();
}

function createSupabaseMaintenanceAdapter(client, options = {}) {
    if (!client || typeof client.from !== 'function') {
        throw new TypeError('Supabase client is required');
    }
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const translateWords = typeof options.translateWords === 'function'
        ? options.translateWords
        : translateSupabaseWords;
    const translateContext = typeof options.translateContext === 'function'
        ? options.translateContext
        : translateSupabaseContext;

    async function findUser(username, { required = false } = {}) {
        const key = usernameKey(username);
        if (!key) {
            if (!required) return null;
            throw maintenanceInputError('MAINTENANCE_USER_REQUIRED', 'username is required');
        }
        const { data, error } = await client
            .from('users')
            .select('id, username, username_key')
            .eq('username_key', key)
            .maybeSingle();
        ensureNoError(error, 'find maintenance user');
        return data || null;
    }

    async function deleteUserTestData(username, days = null) {
        const user = await findUser(username, { required: true });
        const recentDays = normalizeDays(days);
        if (!user) return { success: true, deleted: 0, rebuilt: 0 };

        let query = client
            .from('assessments')
            .delete()
            .eq('user_id', user.id)
            .like('test_id', 'test-%');
        if (recentDays !== null) {
            const currentTime = Number(now());
            if (!Number.isFinite(currentTime)) {
                throw maintenanceInputError('MAINTENANCE_INVALID_CLOCK', 'maintenance clock must be finite');
            }
            const cutoffTime = currentTime - recentDays * DAY_MS;
            const cutoffDate = new Date(cutoffTime);
            if (!Number.isFinite(cutoffTime) || !Number.isFinite(cutoffDate.getTime())) {
                throw maintenanceInputError('MAINTENANCE_INVALID_DAYS', 'days is outside the supported range');
            }
            query = query.gte('assessed_at', cutoffDate.toISOString());
        }
        const { data, error } = await query.select('id');
        ensureNoError(error, 'delete user test assessments');
        return { success: true, deleted: (data || []).length, rebuilt: 0 };
    }

    async function listWords(username) {
        const key = usernameKey(username);
        let user = null;
        if (key) {
            user = await findUser(username);
            if (!user) return [];
        }
        return fetchAllRows(
            () => {
                let query = client.from('words').select(WORD_COLUMNS);
                if (user) query = query.eq('user_id', user.id);
                return query;
            },
            'list words for translation backfill'
        );
    }

    async function updateStillEmpty(row, field, value) {
        let query = client
            .from('words')
            .update({ [field]: value })
            .eq('id', row.id)
            .eq('user_id', row.user_id);
        query = row[field] === null || row[field] === undefined
            ? query.is(field, null)
            : query.eq(field, '');
        const { data, error } = await query.select('id').maybeSingle();
        ensureNoError(error, `backfill ${field}`);
        return Boolean(data);
    }

    async function backfillTranslations(username = null) {
        const records = await listWords(username);
        let cnFilled = 0;
        let cnSkipped = 0;
        let ctxFilled = 0;
        let ctxSkipped = 0;

        const missingMeanings = records.filter(row =>
            isEmptyDatabaseText(row.meaning_zh) && String(row.meaning_en || '').trim()
        );
        for (let index = 0; index < missingMeanings.length; index += 20) {
            const batch = missingMeanings.slice(index, index + 20);
            const sources = batch.map(row => String(row.meaning_en).trim());
            const translations = await translateWords(sources);
            for (const row of batch) {
                const source = String(row.meaning_en).trim();
                const translation = translatedValue(translations, source);
                if (!hasMeaningfulChineseMeaning(translation)) {
                    cnSkipped++;
                    continue;
                }
                if (await updateStillEmpty(row, 'meaning_zh', translation)) cnFilled++;
                else cnSkipped++;
            }
        }

        const missingContexts = records.filter(row =>
            isEmptyDatabaseText(row.context_zh) && String(row.context_en || '').trim()
        );
        for (const row of missingContexts) {
            const translation = String(await translateContext(String(row.context_en).trim()) || '').trim();
            if (!hasChineseSentenceTranslation(translation)) {
                ctxSkipped++;
                continue;
            }
            if (await updateStillEmpty(row, 'context_zh', translation)) ctxFilled++;
            else ctxSkipped++;
        }

        return { cnFilled, cnSkipped, ctxFilled, ctxSkipped, total: records.length };
    }

    return {
        deleteUserTestData,
        backfillTranslations,
    };
}

module.exports = {
    createSupabaseMaintenanceAdapter,
    normalizeDays,
};
