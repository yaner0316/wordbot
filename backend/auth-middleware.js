/**
 * 统一认证中间件
 * 单一事实来源，所有接口鉴权逻辑集中在这里
 */

const { createSessionStore, normalizeUser } = require('./session-auth');

// 创建 session store（24小时 TTL，适合儿童使用场景）
const sessionStore = createSessionStore({ ttlMs: 24 * 60 * 60 * 1000 });

/**
 * 检查 token 是否匹配
 * @param {string} configured - 配置的 token
 * @param {string} provided - 提供的 token
 * @returns {boolean} 是否匹配
 */
function tokensMatch(configured, provided) {
    if (!configured || !provided) return false;
    return configured === provided;
}

/**
 * 从请求中获取目标用户
 * @param {Object} req - Express 请求对象
 * @returns {string|null} 目标用户
 */
function requestedUsers(req) {
    const keys = ['user', 'userId', 'targetUser', 'owner'];
    return [req.params, req.body, req.query]
        .filter(Boolean)
        .flatMap(source => keys.map(key => normalizeUser(source[key])))
        .filter(Boolean);
}

/**
 * Admin token 验证中间件
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @param {Function} next - Express next 函数
 */
function requireAdminToken(req, res, next) {
    const configured = process.env.WORDBOT_ADMIN_TOKEN;
    
    if (!configured) {
        return res.status(503).json({ 
            error: 'Admin token is not configured', 
            code: 'ADMIN_TOKEN_NOT_CONFIGURED' 
        });
    }
    
    // 验证 token
    if (tokensMatch(configured, req.get('x-wordbot-admin-token'))) {
        return next();
    }
    
    return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
}

/**
 * 用户 session 验证中间件
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @param {Function} next - Express next 函数
 */
function requireUserSession(req, res, next) {
    if (process.env.NODE_ENV === 'test' && process.env.WORDBOT_AUTH_TEST_BYPASS === '1') return next();

    // 验证 session
    const session = sessionStore.read(req);
    if (!session) {
        return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }

    // 验证用户归属
    const targets = requestedUsers(req);
    if (targets.some(target => target !== session.user)) {
        return res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
    }
    
    // 将 session 附加到请求对象
    req.wordbotSession = session;
    next();
}

/**
 * 设置 session cookie
 * @param {Object} res - Express 响应对象
 * @param {Object} result - 登录结果
 * @param {string} role - 角色（user 或 parent）
 */
function setSessionCookie(res, result, role = 'user') {
    const token = sessionStore.issue(result.user, role);
    res.setHeader('Set-Cookie', sessionStore.cookie(token));
}

module.exports = {
    requireAdminToken,
    requireUserSession,
    setSessionCookie,
    sessionStore,
};
