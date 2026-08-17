'use strict';

const { usernameKey } = require('./auth-service');

const PAGE_SIZE = 1000;
const USER_COLUMNS = 'username, username_key';
const WORD_COLUMNS = [
    'id',
    'feishu_record_id',
    'user_id',
    'word',
    'meaning_en',
    'meaning_zh',
    'context_en',
    'context_zh',
    'distractors',
    'mastery_status',
    'quality_flags',
    'quality_note',
    'level',
    'entered_at',
].join(', ');

function adminDatabaseError(operation, error) {
    const wrapped = new Error('admin data service unavailable');
    wrapped.code = 'ADMIN_DATABASE_ERROR';
    wrapped.operation = operation;
    wrapped.cause = error;
    return wrapped;
}

function ensureNoError(error, operation) {
    if (error) throw adminDatabaseError(operation, error);
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

function normalizeFlags(value) {
    if (Array.isArray(value)) {
        return value.map(flag => String(flag || '').trim()).filter(Boolean);
    }
    const text = String(value || '').trim();
    if (!text) return [];
    if (text.startsWith('[')) {
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) return normalizeFlags(parsed);
        } catch {
            // Fall through to comma-separated input.
        }
    }
    return text.split(',').map(flag => flag.trim()).filter(Boolean);
}

function hasReviewMarker(row) {
    return normalizeFlags(row?.quality_flags).length > 0 || String(row?.quality_note || '').trim() !== '';
}

function mapReviewWord(row, user) {
    const flags = normalizeFlags(row?.quality_flags);
    return {
        word: String(row?.word || '').trim(),
        meaning: String(row?.meaning_en || '').trim(),
        cnMeaning: String(row?.meaning_zh || '').trim(),
        context: String(row?.context_en || '').trim(),
        contextCN: String(row?.context_zh || '').trim(),
        distractors: Array.isArray(row?.distractors)
            ? row.distractors.join(',')
            : String(row?.distractors || '').trim(),
        status: String(row?.mastery_status || '').trim().toLowerCase() === 'mastered' ? 'optF5P0W3O' : 'Pending',
        mastery_status: row?.mastery_status || 'pending',
        qualityFlags: flags.join(','),
        qualityNote: String(row?.quality_note || '').trim(),
        level: row?.level || '',
        entered_at: row?.entered_at || null,
        record_id: row?.feishu_record_id || row?.id || '',
        word_id: row?.id || '',
        user: user?.username || '',
        POS: '',
        parts_of_speech: [],
    };
}

function createSupabaseAdminAdapter(client) {
    if (!client || typeof client.from !== 'function') {
        throw new TypeError('Supabase client is required');
    }

    async function listUsers() {
        return fetchAllRows(
            () => client.from('users').select(USER_COLUMNS).order('username_key', { ascending: true }),
            'list Supabase users'
        );
    }

    async function findUser(username) {
        const key = usernameKey(username);
        if (!key) return null;
        const { data, error } = await client
            .from('users')
            .select(USER_COLUMNS.replace('username_key', 'username_key, id'))
            .eq('username_key', key)
            .maybeSingle();
        ensureNoError(error, 'find Supabase user');
        return data || null;
    }

    async function getAllUsers() {
        const users = await listUsers();
        return users.map(user => String(user.username || '').trim()).filter(Boolean);
    }

    async function getReviewWords(username = '') {
        let users;
        let targetUser = null;
        if (String(username || '').trim()) {
            targetUser = await findUser(username);
            if (!targetUser) return [];
            users = [targetUser];
        } else {
            users = await fetchAllRows(
                () => client.from('users').select('id, username, username_key').order('username_key', { ascending: true }),
                'list review users'
            );
        }

        const usersById = new Map(users.map(user => [user.id, user]));
        const rows = await fetchAllRows(
            () => {
                let query = client.from('words').select(WORD_COLUMNS);
                if (targetUser) query = query.eq('user_id', targetUser.id);
                return query.order('entered_at', { ascending: true }).order('id', { ascending: true });
            },
            'list review words'
        );

        return rows
            .filter(row => usersById.has(row.user_id))
            .filter(hasReviewMarker)
            .filter(row => String(row.mastery_status || '').trim().toLowerCase() !== 'mastered')
            .map(row => mapReviewWord(row, usersById.get(row.user_id)))
            .sort((left, right) => left.user.localeCompare(right.user) || left.word.localeCompare(right.word));
    }

    async function requireOwnedWord(recordId, username) {
        if (!usernameKey(username)) throw new Error('WORD_OWNER_REQUIRED');
        const user = await findUser(username);
        if (!user) throw new Error('WORD_NOT_FOUND');

        const normalizedRecordId = String(recordId || '').trim();
        if (!normalizedRecordId) throw new Error('WORD_NOT_FOUND');
        for (const column of ['feishu_record_id', 'id']) {
            const { data, error } = await client
                .from('words')
                .select('id, feishu_record_id, user_id')
                .eq(column, normalizedRecordId)
                .eq('user_id', user.id)
                .maybeSingle();
            ensureNoError(error, 'find owned review word');
            if (data) return { user, word: data };
        }
        throw new Error('WORD_NOT_FOUND');
    }

    async function updateOwnedReviewWord(recordId, username, payload) {
        const { user, word } = await requireOwnedWord(recordId, username);
        const { data, error } = await client
            .from('words')
            .update(payload)
            .eq('id', word.id)
            .eq('user_id', user.id)
            .select('id')
            .maybeSingle();
        ensureNoError(error, 'update owned review word');
        if (!data) throw new Error('WORD_NOT_FOUND');
        return { success: true };
    }

    async function markWordForReview(recordId, flags, note, username = '') {
        const normalizedFlags = normalizeFlags(flags);
        return updateOwnedReviewWord(recordId, username, {
            quality_flags: normalizedFlags.length ? normalizedFlags : ['manual_review'],
            quality_note: String(note || ''),
        });
    }

    async function clearWordReview(recordId, username = '') {
        return updateOwnedReviewWord(recordId, username, {
            quality_flags: [],
            quality_note: '',
        });
    }

    return {
        getAllUsers,
        getReviewWords,
        markWordForReview,
        clearWordReview,
    };
}

module.exports = {
    createSupabaseAdminAdapter,
    normalizeFlags,
    mapReviewWord,
};
