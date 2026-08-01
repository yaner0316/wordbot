const crypto = require('crypto');

const SESSION_COOKIE = 'wordbot_session';
const SESSION_TTL_MS = 30 * 60 * 1000;

function normalizeUser(value) {
    return String(value || '').trim().toLowerCase();
}

function parseCookies(header) {
    return Object.fromEntries(String(header || '').split(';').map(part => {
        const index = part.indexOf('=');
        return index < 0 ? [part.trim(), ''] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
    }).filter(([key]) => key));
}

function createSessionStore({ ttlMs = SESSION_TTL_MS } = {}) {
    const sessions = new Map();
    function issue(user, role = 'user') {
        const token = crypto.randomBytes(32).toString('hex');
        sessions.set(token, { user: normalizeUser(user), role, expiresAt: Date.now() + ttlMs });
        return token;
    }
    function read(req) {
        const token = parseCookies(req.get('cookie'))[SESSION_COOKIE];
        const session = token && sessions.get(token);
        if (!session || session.expiresAt <= Date.now()) {
            if (token) sessions.delete(token);
            return null;
        }
        return session;
    }
    function cookie(token) {
        const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
        return SESSION_COOKIE + '=' + encodeURIComponent(token) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + Math.floor(ttlMs / 1000) + secure;
    }
    return { issue, read, cookie };
}

module.exports = { createSessionStore, normalizeUser };
