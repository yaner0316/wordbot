'use strict';

const { createAuthService, usernameKey } = require('./auth-service');

const USER_COLUMNS = [
    'id',
    'username',
    'username_key',
    'password_hash',
    'password_salt',
    'auth_created_at',
    'parent_username',
    'parent_username_key',
    'parent_password_hash',
    'parent_password_salt',
    'parent_created_at',
].join(', ');

function toMillis(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function toIsoString(value) {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) throw new Error('invalid authentication timestamp');
    return new Date(parsed).toISOString();
}

function toAccountRecord(row) {
    if (!row) return null;
    return {
        record_id: row.id,
        fields: {
            user: row.username,
            auth_password_hash: row.password_hash,
            auth_password_salt: row.password_salt,
            auth_created_at: toMillis(row.auth_created_at),
            parent_username: row.parent_username,
            parent_password_hash: row.parent_password_hash,
            parent_password_salt: row.parent_password_salt,
            parent_created_at: toMillis(row.parent_created_at),
        },
    };
}

function copyMappedField(target, source, sourceKey, targetKey = sourceKey) {
    if (Object.prototype.hasOwnProperty.call(source, sourceKey)) {
        target[targetKey] = source[sourceKey];
    }
}

function toUserWrite(fields, { includeUsername = true } = {}) {
    const row = {};
    if (includeUsername) copyMappedField(row, fields, 'user', 'username');
    copyMappedField(row, fields, 'auth_password_hash', 'password_hash');
    copyMappedField(row, fields, 'auth_password_salt', 'password_salt');
    copyMappedField(row, fields, 'parent_username');
    copyMappedField(row, fields, 'parent_password_hash');
    copyMappedField(row, fields, 'parent_password_salt');
    if (Object.prototype.hasOwnProperty.call(fields, 'auth_created_at')) {
        row.auth_created_at = toIsoString(fields.auth_created_at);
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'parent_created_at')) {
        row.parent_created_at = toIsoString(fields.parent_created_at);
    }
    return row;
}

function authDatabaseError(label, error) {
    if (String(error?.code || '') === '23505') return new Error('user already registered');
    const wrapped = new Error('authentication service unavailable');
    wrapped.code = 'AUTH_DATABASE_ERROR';
    wrapped.operation = label;
    wrapped.cause = error;
    return wrapped;
}

function createSupabaseAccountRepository(client) {
    if (!client || typeof client.from !== 'function') {
        throw new TypeError('Supabase client is required');
    }

    return {
        async listAccountRecords() {
            const { data, error } = await client.from('users').select(USER_COLUMNS);
            if (error) throw authDatabaseError('list Supabase users failed', error);
            return (data || []).map(toAccountRecord);
        },

        async findAccountRecord(user) {
            const { data, error } = await client
                .from('users')
                .select(USER_COLUMNS)
                .eq('username_key', usernameKey(user))
                .maybeSingle();
            if (error) throw authDatabaseError('find Supabase user failed', error);
            return toAccountRecord(data);
        },

        async addAccountRecord(fields) {
            const { error } = await client.from('users').insert(toUserWrite(fields));
            if (error) throw authDatabaseError('create Supabase user failed', error);
        },

        async updateAccountRecord(recordId, fields) {
            const { error } = await client
                .from('users')
                .update(toUserWrite(fields, { includeUsername: false }))
                .eq('id', recordId);
            if (error) throw authDatabaseError('update Supabase user failed', error);
        },
    };
}

function createSupabaseAuthAdapter(client, options = {}) {
    const repository = createSupabaseAccountRepository(client);
    return createAuthService({
        ...repository,
        ...options,
    });
}

module.exports = {
    createSupabaseAccountRepository,
    createSupabaseAuthAdapter,
    toAccountRecord,
    toUserWrite,
};
