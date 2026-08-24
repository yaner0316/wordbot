const crypto = require('crypto');

const SESSION_COOKIE = 'wordbot_session';
const SESSION_TTL_MS = 30 * 60 * 1000;
const DEVELOPMENT_SESSION_SECRET = 'wordbot-development-session-secret';

function normalizeUser(value) {
    return String(value || '').trim().toLowerCase();
}

function parseCookies(header) {
    return Object.fromEntries(String(header || '').split(';').map(part => {
        const index = part.indexOf('=');
        return index < 0 ? [part.trim(), ''] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
    }).filter(([key]) => key));
}

function base64UrlEncode(value) {
    return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value) {
    return Buffer.from(String(value || ''), 'base64url').toString('utf8');
}

function sessionSecret(explicitSecret) {
    return String(explicitSecret || process.env.WORDBOT_SESSION_SECRET || process.env.WORDBOT_ADMIN_TOKEN || DEVELOPMENT_SESSION_SECRET);
}

function signSession(payload, secret) {
    return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function createSessionStore({ ttlMs = SESSION_TTL_MS, secret } = {}) {
    const configuredSecret = sessionSecret(secret);
    function issue(user, role = 'user') {
        const expiresAt = Date.now() + ttlMs;
        const payload = base64UrlEncode(JSON.stringify({
            user: normalizeUser(user),
            role,
            expiresAt,
        }));
        return `${payload}.${signSession(payload, configuredSecret)}`;
    }
    function read(req) {
        const token = parseCookies(req.get('cookie'))[SESSION_COOKIE];
        if (!token) return null;
        const [payload, signature] = String(token).split('.');
        if (!payload || !signature) return null;
        const expected = signSession(payload, configuredSecret);
        const actualBuffer = Buffer.from(signature);
        const expectedBuffer = Buffer.from(expected);
        if (actualBuffer.length !== expectedBuffer.length
            || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;
        try {
            const session = JSON.parse(base64UrlDecode(payload));
            if (!session.user || !session.expiresAt || Number(session.expiresAt) <= Date.now()) return null;
            return {
                user: normalizeUser(session.user),
                role: session.role || 'user',
                expiresAt: Number(session.expiresAt),
            };
        } catch {
            return null;
        }
    }
    function cookie(token) {
        const production = process.env.NODE_ENV === 'production';
        const crossSite = production ? '; SameSite=None; Secure; Partitioned' : '; SameSite=Lax';
        return SESSION_COOKIE + '=' + encodeURIComponent(token) + '; Path=/; HttpOnly; Max-Age=' + Math.floor(ttlMs / 1000) + crossSite;
    }
    return { issue, read, cookie };
}

module.exports = { createSessionStore, normalizeUser };
