const crypto = require('crypto');

const HASH_ITERATIONS = 120000;
const HASH_KEY_LENGTH = 32;
const HASH_DIGEST = 'sha256';
const GENERIC_LOGIN_ERROR = 'username/password error';
const GENERIC_PARENT_LOGIN_ERROR = 'parent username/password error';

function normalizeUsername(value) {
    return String(value || '').trim().replace(/\s+/g, '');
}

function usernameKey(value) {
    return normalizeUsername(value).toLowerCase();
}

function validateUsername(user) {
    if (!user) throw new Error('username is required');
    if (/^\d{11}$/.test(user)) throw new Error('username cannot be a phone number');
}

function shouldEnsureAccountFields(error) {
    return /field|字段/i.test(String(error?.message || ''));
}

function validateCredentials(username, password) {
    const user = normalizeUsername(username);
    validateUsername(user);
    if (!password || String(password).length < 4) throw new Error('password must be at least 4 characters');
    return { user, password: String(password) };
}

function validateRegistration({ username, password }) {
    return validateCredentials(username, password);
}

function validateParentIdentity(parentUsername, password) {
    const parent = normalizeUsername(parentUsername);
    if (!parent) throw new Error('parent username is required');
    if (!password || String(password).length < 4) throw new Error('parent password must be at least 4 characters');
    return { parentUsername: parent, password: String(password) };
}

function withTimeout(promise, timeoutMs, message) {
    if (!timeoutMs || timeoutMs <= 0) return promise;
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs)),
    ]);
}

function extractText(v) {
    if (Array.isArray(v)) return extractText(v[0]);
    if (v && typeof v === 'object') return String(v.text ?? v.value ?? '');
    return String(v ?? '');
}

function accountUser(record) {
    return normalizeUsername(extractText(record?.fields?.user));
}

function accountParentUsername(record) {
    return normalizeUsername(extractText(record?.fields?.parent_username));
}

function hashPassword(password, salt) {
    return crypto.pbkdf2Sync(
        String(password),
        String(salt),
        HASH_ITERATIONS,
        HASH_KEY_LENGTH,
        HASH_DIGEST
    ).toString('hex');
}

function safeCompareHex(actualHex, expectedHex) {
    if (!/^[0-9a-f]+$/i.test(expectedHex) || actualHex.length !== expectedHex.length) return false;
    return crypto.timingSafeEqual(Buffer.from(actualHex, 'hex'), Buffer.from(expectedHex, 'hex'));
}

function verifyPassword(fields, password, prefix) {
    const hash = extractText(fields?.[prefix + '_hash']);
    const salt = extractText(fields?.[prefix + '_salt']);
    if (!hash || !salt) return false;
    const actual = hashPassword(password, salt);
    return safeCompareHex(actual, hash);
}

function createPasswordFields(password, randomBytes, prefix, timestampField) {
    const salt = randomBytes(16).toString('hex');
    return {
        [prefix + '_salt']: salt,
        [prefix + '_hash']: hashPassword(password, salt),
        [timestampField]: Date.now(),
    };
}

function createAuthService({
    listAccountRecords,
    findAccountRecord,
    addAccountRecord,
    updateAccountRecord,
    ensureAccountFields = async () => {},
    randomBytes = crypto.randomBytes,
    logger = console,
    fieldPreparationTimeoutMs = 3000,
}) {
    async function lookupAccountByUsername(user) {
        if (typeof findAccountRecord === 'function') {
            try {
                return await findAccountRecord(user);
            } catch (error) {
                logger.warn('targeted auth lookup failed, falling back to full scan');
            }
        }
        const records = await listAccountRecords();
        const key = usernameKey(user);
        return records.find(record => usernameKey(accountUser(record)) === key) || null;
    }

    async function writeAccountFields(existing, fields) {
        async function writeCredentials() {
            if (existing) {
                await updateAccountRecord(existing.record_id, fields);
            } else {
                await addAccountRecord(fields);
            }
        }

        try {
            await writeCredentials();
        } catch (error) {
            if (!shouldEnsureAccountFields(error)) throw error;
            logger.warn('auth credential write failed, ensuring account fields');
            await withTimeout(
                ensureAccountFields(),
                fieldPreparationTimeoutMs,
                'auth account field preparation timed out'
            );
            await writeCredentials();
        }
    }

    async function register(input) {
        const { user, password: rawPassword } = validateRegistration(input || {});
        const existing = await lookupAccountByUsername(user);
        if (existing?.fields?.auth_password_hash) throw new Error('user already registered');
        const fields = {
            user,
            ...createPasswordFields(rawPassword, randomBytes, 'auth_password', 'auth_created_at'),
        };
        await writeAccountFields(existing, fields);
        return { user: existing ? accountUser(existing) || user : user };
    }

    async function login({ username, password }) {
        const { user, password: rawPassword } = validateCredentials(username, password);
        const account = await lookupAccountByUsername(user);
        if (!account) throw new Error(GENERIC_LOGIN_ERROR);
        if (!account.fields?.auth_password_hash || !account.fields?.auth_password_salt) {
            throw new Error('user has no password yet; register first');
        }
        if (!verifyPassword(account.fields, rawPassword, 'auth_password')) throw new Error(GENERIC_LOGIN_ERROR);
        return { user: accountUser(account) };
    }

    async function verifyParentLogin({ user, parentUsername, password }) {
        const student = normalizeUsername(user);
        validateUsername(student);
        const input = validateParentIdentity(parentUsername, password);
        const account = await lookupAccountByUsername(student);
        if (!account) throw new Error(GENERIC_PARENT_LOGIN_ERROR);
        if (usernameKey(accountParentUsername(account)) !== usernameKey(input.parentUsername)) {
            throw new Error(GENERIC_PARENT_LOGIN_ERROR);
        }
        if (!verifyPassword(account.fields, input.password, 'parent_password')) {
            throw new Error(GENERIC_PARENT_LOGIN_ERROR);
        }
        return { ok: true, user: accountUser(account), parentUsername: accountParentUsername(account) };
    }

    async function setParentCredentials({
        user,
        childPassword,
        parentUsername,
        parentPassword,
        currentParentUsername = '',
        currentParentPassword = '',
    } = {}) {
        const { user: student, password: rawChildPassword } = validateCredentials(user, childPassword);
        const parent = validateParentIdentity(parentUsername, parentPassword);
        const account = await lookupAccountByUsername(student);
        if (!account) throw new Error(GENERIC_LOGIN_ERROR);
        if (!verifyPassword(account.fields, rawChildPassword, 'auth_password')) throw new Error(GENERIC_LOGIN_ERROR);
        if (account.fields?.parent_password_hash) {
            try {
                await verifyParentLogin({
                    user: student,
                    parentUsername: currentParentUsername,
                    password: currentParentPassword,
                });
            } catch (error) {
                throw new Error(GENERIC_PARENT_LOGIN_ERROR);
            }
        }
        const fields = {
            parent_username: parent.parentUsername,
            ...createPasswordFields(parent.password, randomBytes, 'parent_password', 'parent_created_at'),
        };
        await writeAccountFields(account, fields);
        return { ok: true, user: accountUser(account), parentUsername: parent.parentUsername };
    }


    async function resetChildPassword({
        user,
        parentUsername,
        parentPassword,
        newPassword,
    } = {}) {
        const student = normalizeUsername(user);
        validateUsername(student);
        if (!newPassword || String(newPassword).length < 4) throw new Error('password must be at least 4 characters');
        await verifyParentLogin({ user: student, parentUsername, password: parentPassword });
        const account = await lookupAccountByUsername(student);
        if (!account) throw new Error(GENERIC_PARENT_LOGIN_ERROR);
        await writeAccountFields(account, createPasswordFields(newPassword, randomBytes, 'auth_password', 'auth_created_at'));
        return { ok: true, user: accountUser(account) };
    }

    async function initializeParentCredentials({ user, parentUsername, parentPassword } = {}) {
        const student = normalizeUsername(user);
        validateUsername(student);
        const parent = validateParentIdentity(parentUsername, parentPassword);
        const account = await lookupAccountByUsername(student);
        if (!account) throw new Error('user not found');
        const fields = {
            parent_username: parent.parentUsername,
            ...createPasswordFields(parent.password, randomBytes, 'parent_password', 'parent_created_at'),
        };
        await writeAccountFields(account, fields);
        return { ok: true, user: accountUser(account), parentUsername: parent.parentUsername };
    }

    return { login, register, verifyParentLogin, setParentCredentials, initializeParentCredentials, resetChildPassword };
}

module.exports = {
    createAuthService,
    hashPassword,
    normalizeUsername,
    usernameKey,
};
