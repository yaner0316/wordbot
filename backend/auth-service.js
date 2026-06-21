const crypto = require('crypto');

const HASH_ITERATIONS = 120000;
const HASH_KEY_LENGTH = 32;
const HASH_DIGEST = 'sha256';

function normalizeUsername(value) {
    return String(value || '').trim().replace(/\s+/g, '');
}

function validateCredentials(username, password) {
    const user = normalizeUsername(username);
    if (!user) throw new Error('请输入用户名');
    if (!password || String(password).length < 4) throw new Error('密码至少需要 4 位');
    return { user, password: String(password) };
}

function withTimeout(promise, timeoutMs, message) {
    if (!timeoutMs || timeoutMs <= 0) return promise;
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs)),
    ]);
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

function createAuthService({
    listAccountRecords,
    findAccountRecord,
    listWordUsers,
    addAccountRecord,
    updateAccountRecord,
    ensureAccountFields = async () => {},
    randomBytes = crypto.randomBytes,
    logger = console,
    fieldPreparationTimeoutMs = 3000,
}) {
    function findAccount(records, user) {
        return records.find(record => String(record.fields?.user || '') === user) || null;
    }

    async function lookupAccount(user) {
        if (typeof findAccountRecord === 'function') {
            try {
                return await findAccountRecord(user);
            } catch (error) {
                logger.warn('targeted auth lookup failed, falling back to full scan');
            }
        }
        const records = await listAccountRecords();
        return findAccount(records, user);
    }

    async function register({ username, password }) {
        const { user, password: rawPassword } = validateCredentials(username, password);
        const existing = await lookupAccount(user);
        if (existing?.fields?.auth_password_hash) {
            throw new Error('用户已注册，请直接登录');
        }

        const salt = randomBytes(16).toString('hex');
        const fields = {
            user,
            auth_password_salt: salt,
            auth_password_hash: hashPassword(rawPassword, salt),
            auth_created_at: Date.now(),
        };
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
            logger.warn('auth credential write failed, ensuring account fields');
            await withTimeout(
                ensureAccountFields(),
                fieldPreparationTimeoutMs,
                'auth account field preparation timed out'
            );
            await writeCredentials();
        }
        return { user };
    }

    async function login({ username, password }) {
        const { user, password: rawPassword } = validateCredentials(username, password);
        const account = await lookupAccount(user);
        if (!account?.fields?.auth_password_hash || !account?.fields?.auth_password_salt) {
            throw new Error('用户不存在或尚未注册密码');
        }
        const expected = String(account.fields.auth_password_hash);
        const actual = hashPassword(rawPassword, account.fields.auth_password_salt);
        const ok = crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
        if (!ok) throw new Error('密码错误');
        return { user };
    }

    return { login, register };
}

module.exports = {
    createAuthService,
    hashPassword,
    normalizeUsername,
};