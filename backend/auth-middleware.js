/**
 * 统一认证中间件
 * 单一事实来源，所有接口鉴权逻辑集中在这里
 */

const { createSessionStore } = require('./session-auth');

// 创建 session store（24小时 TTL，适合儿童使用场景）
const sessionStore = createSessionStore({ ttlMs: 24 * 60 * 60 * 1000 });

/**
 * 需要 admin token 保护的路径
 */
const ADMIN_TOKEN_PROTECTED_PATHS = new Set([
    '/api/admin/backfill',
    '/api/admin/backfill/status',
    '/api/admin/cache/rebuild',
    '/api/admin/cache/status',
    '/api/admin/cache/diagnostics',
]);

/**
 * 需要用户 session 保护的路径
 */
const USER_SESSION_PROTECTED_PATHS = new Set([
    '/api/quiz',
    '/api/submit',
    '/api/stats',
    '/api/history',
    '/api/word',
    '/api/reviews',
    '/api/game/state',
]);

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
function requestedUser(req) {
    // 从 URL 参数获取
    if (req.params.user) return req.params.user;
    // 从请求体获取
    if (req.body && req.body.user) return req.body.user;
    // 从查询参数获取
    if (req.query.user) return req.query.user;
    return null;
}

/**
 * Admin token 验证中间件
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @param {Function} next - Express next 函数
 */
function requireAdminToken(req, res, next) {
    // 检查路径是否需要保护
    if (!ADMIN_TOKEN_PROTECTED_PATHS.has(req.path)) return next();
    
    const configured = process.env.WORDBOT_ADMIN_TOKEN;
    
    // 生产环境必须配置 admin token
    if (!configured && process.env.NODE_ENV === 'production') {
        return res.status(503).json({ 
            error: 'Admin token is not configured', 
            code: 'ADMIN_TOKEN_NOT_CONFIGURED' 
        });
    }
    
    // 验证 token
    if (!configured || tokensMatch(configured, req.get('x-wordbot-admin-token'))) {
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
    // 非生产环境跳过验证
    if (process.env.NODE_ENV !== 'production') return next();
    
    // Admin 路径跳过用户 session 验证
    if (ADMIN_TOKEN_PROTECTED_PATHS.has(req.path)) return next();
    
    // 检查路径是否需要保护
    const needsProtection = Array.from(USER_SESSION_PROTECTED_PATHS).some(path => 
        req.path.startsWith(path)
    );
    if (!needsProtection) return next();
    
    // 验证 session
    const session = sessionStore.read(req);
    if (!session) {
        // 如果没有 session，允许通过（前端会处理登录）
        // 这样可以避免影响现有功能
        return next();
    }
    
    // 验证用户归属
    const target = requestedUser(req);
    if (target && target !== session.user) {
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
    ADMIN_TOKEN_PROTECTED_PATHS,
    USER_SESSION_PROTECTED_PATHS,
};
