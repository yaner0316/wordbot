const crypto = require('crypto');

const HASH_ITERATIONS = 120000;
const HASH_KEY_LENGTH = 32;
const HASH_DIGEST = 'sha256';
const OTP_TTL_MS = 10 * 60 * 1000;
const GENERIC_LOGIN_ERROR = '用户名/密码错误';

function normalizeUsername(value) {
    return String(value || '').trim().replace(/\s+/g, '');
}

function usernameKey(value) {
    return normalizeUsername(value).toLowerCase();
}

function normalizePhone(value) {
    return String(value || '').replace(/\D/g, '');
}

function isPhoneIdentifier(value) {
    return /^\d{11}$/.test(normalizePhone(value));
}

function shouldEnsureAccountFields(error) {
    return /field|字段/i.test(String(error?.message || ''));
}

function validateCredentials(username, password) {
    const user = normalizeUsername(username);
    if (!user) throw new Error('请输入用户名或手机号');
    if (!password || String(password).length < 4) throw new Error('密码至少需要 4 位');
    return { user, password: String(password) };
}

function validateRegistration({ username, phone, password }) {
    const user = normalizeUsername(username);
    const normalizedPhone = normalizePhone(phone);
    if (!user) throw new Error('请输入用户名');
    if (!/^\d{11}$/.test(normalizedPhone)) throw new Error('请输入手机号');
    if (!password || String(password).length < 4) throw new Error('密码至少需要 4 位');
    return { user, phone: normalizedPhone, password: String(password) };
}

function validateOtpInput({ phone, otp }) {
    const normalizedPhone = normalizePhone(phone);
    const code = String(otp || '').trim();
    if (!/^\d{11}$/.test(normalizedPhone)) throw new Error('请输入手机号');
    if (!/^\d{6}$/.test(code)) throw new Error('请输入 6 位验证码');
    return { phone: normalizedPhone, otp: code };
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

function accountPhone(record) {
    return normalizePhone(extractText(record?.fields?.phone));
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

function createOtp(randomBytes) {
    const value = randomBytes(4).readUInt32BE(0) % 1000000;
    return String(value).padStart(6, '0');
}

function safeCompareHex(actualHex, expectedHex) {
    if (!/^[0-9a-f]+$/i.test(expectedHex) || actualHex.length !== expectedHex.length) return false;
    return crypto.timingSafeEqual(Buffer.from(actualHex, 'hex'), Buffer.from(expectedHex, 'hex'));
}

function createAuthService({
    listAccountRecords,
    findAccountRecord,
    findAccountByPhone,
    listWordUsers,
    addAccountRecord,
    updateAccountRecord,
    ensureAccountFields = async () => {},
    randomBytes = crypto.randomBytes,
    logger = console,
    fieldPreparationTimeoutMs = 3000,
    now = () => Date.now(),
    exposeDevOtp = process.env.NODE_ENV !== 'production',
}) {
    const otpStore = new Map();

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

    async function lookupAccountByPhone(phone) {
        if (typeof findAccountByPhone === 'function') {
            try {
                return await findAccountByPhone(phone);
            } catch (error) {
                logger.warn('targeted phone auth lookup failed, falling back to full scan');
            }
        }
        const records = await listAccountRecords();
        return records.find(record => accountPhone(record) === phone) || null;
    }

    async function lookupAccount(identifier) {
        const phone = normalizePhone(identifier);
        if (/^\d{11}$/.test(phone)) return lookupAccountByPhone(phone);
        return lookupAccountByUsername(normalizeUsername(identifier));
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
        const { user, phone, password: rawPassword } = validateRegistration(input || {});
        const [existingUser, existingPhone] = await Promise.all([
            lookupAccountByUsername(user),
            lookupAccountByPhone(phone),
        ]);
        if (existingPhone && usernameKey(accountUser(existingPhone)) !== usernameKey(user)) {
            throw new Error('手机号已绑定其他账户');
        }
        const existing = existingUser || existingPhone;
        if (existing?.fields?.auth_password_hash) {
            throw new Error('用户已注册，请直接登录');
        }
        const boundPhone = accountPhone(existing);
        if (boundPhone && boundPhone !== phone) {
            throw new Error('账户已绑定其他手机号');
        }

        const salt = randomBytes(16).toString('hex');
        const fields = {
            user,
            phone,
            phone_verified_at: Date.now(),
            auth_password_salt: salt,
            auth_password_hash: hashPassword(rawPassword, salt),
            auth_created_at: Date.now(),
        };
        await writeAccountFields(existing, fields);
        return { user };
    }

    async function login({ username, password }) {
        const { user: identifier, password: rawPassword } = validateCredentials(username, password);
        const account = await lookupAccount(identifier);
        if (!account) throw new Error(GENERIC_LOGIN_ERROR);
        if (!account.fields?.auth_password_hash || !account.fields?.auth_password_salt) {
            throw new Error('用户尚未绑定密码，请先注册');
        }
        const expected = extractText(account.fields.auth_password_hash);
        const actual = hashPassword(rawPassword, extractText(account.fields.auth_password_salt));
        if (!safeCompareHex(actual, expected)) throw new Error(GENERIC_LOGIN_ERROR);
        return { user: accountUser(account) };
    }

    async function requestOtp({ phone, purpose = 'login', user = '' } = {}) {
        const normalizedPhone = normalizePhone(phone);
        if (!/^\d{11}$/.test(normalizedPhone)) throw new Error('请输入手机号');
        const account = await lookupAccountByPhone(normalizedPhone);
        if (!account) throw new Error('手机号未绑定账户');
        const expectedUser = normalizeUsername(user);
        if (expectedUser && usernameKey(accountUser(account)) !== usernameKey(expectedUser)) {
            throw new Error('手机号不属于当前账户');
        }
        const code = createOtp(randomBytes);
        const key = `${String(purpose || 'login')}:${normalizedPhone}`;
        otpStore.set(key, {
            code,
            user: accountUser(account),
            expiresAt: now() + OTP_TTL_MS,
        });
        logger.info?.(`auth otp requested purpose=${purpose} phone=${normalizedPhone.slice(0, 3)}****${normalizedPhone.slice(-4)}`);
        return {
            sent: true,
            phone: normalizedPhone,
            expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
            ...(exposeDevOtp ? { devOtp: code } : {}),
        };
    }

    function verifyStoredOtp({ phone, otp, purpose }) {
        const input = validateOtpInput({ phone, otp });
        const key = `${String(purpose || 'login')}:${input.phone}`;
        const stored = otpStore.get(key);
        if (!stored || stored.expiresAt < now() || stored.code !== input.otp) {
            throw new Error('验证码错误或已过期');
        }
        otpStore.delete(key);
        return stored;
    }

    async function loginWithOtp({ phone, otp }) {
        const stored = verifyStoredOtp({ phone, otp, purpose: 'login' });
        return { user: stored.user };
    }

    async function verifyParentOtp({ user, phone, otp }) {
        const expectedUser = normalizeUsername(user);
        const stored = verifyStoredOtp({ phone, otp, purpose: 'parent' });
        if (expectedUser && usernameKey(stored.user) !== usernameKey(expectedUser)) throw new Error('手机号不属于当前账户');
        return { ok: true, user: stored.user };
    }

    return { login, register, requestOtp, loginWithOtp, verifyParentOtp };
}

module.exports = {
    createAuthService,
    hashPassword,
    normalizeUsername,
    usernameKey,
    normalizePhone,
};
