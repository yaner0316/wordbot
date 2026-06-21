const DEFAULT_LEARNING_LEVEL = '中学';
const LEVELS = ['小学', '中学', '高中', 'CET4_6_TOEFL'];
const LEVEL_ALIASES = new Map([
    ['CET/TOEFL', 'CET4_6_TOEFL'],
    ['CET4_6_TOEFL', 'CET4_6_TOEFL'],
]);
const LEVEL_CHANGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeLearningLevel(level) {
    const value = String(level || '').trim() || DEFAULT_LEARNING_LEVEL;
    const normalized = LEVEL_ALIASES.get(value) || value;
    if (!LEVELS.includes(normalized)) {
        throw new Error(`invalid learning level: ${value}`);
    }
    return normalized;
}

function asTimestamp(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) && number > 0 ? number : 0;
}

function validateLearningLevelChange({ currentLevel, requestedLevel, lastChangedAt = 0, now = Date.now() }) {
    const nextLevel = normalizeLearningLevel(requestedLevel);
    const current = normalizeLearningLevel(currentLevel || DEFAULT_LEARNING_LEVEL);
    const lastChangeTime = asTimestamp(lastChangedAt);
    const nextAllowedAt = lastChangeTime ? lastChangeTime + LEVEL_CHANGE_COOLDOWN_MS : now;

    if (nextLevel === current) {
        return { ok: true, unchanged: true, learningLevel: current, nextLevelChangeAt: nextAllowedAt };
    }
    if (lastChangeTime && now < nextAllowedAt) {
        return { ok: false, reason: 'cooldown', learningLevel: current, nextLevelChangeAt: nextAllowedAt };
    }
    return { ok: true, learningLevel: nextLevel, nextLevelChangeAt: now + LEVEL_CHANGE_COOLDOWN_MS };
}

function buildLearningSettings({ userId, record, now = Date.now() }) {
    const fields = record?.fields || {};
    const learningLevel = normalizeLearningLevel(fields.Learning_Level || DEFAULT_LEARNING_LEVEL);
    const lastChangedAt = asTimestamp(fields.Level_Changed_At);
    const nextLevelChangeAt = lastChangedAt ? lastChangedAt + LEVEL_CHANGE_COOLDOWN_MS : now;
    return {
        userId,
        learningLevel,
        levelChangedAt: lastChangedAt || null,
        nextLevelChangeAt,
        canChangeLevel: !lastChangedAt || now >= nextLevelChangeAt,
        questionCacheStatus: fields.Question_Cache_Status || 'not_started',
    };
}

function createLearningSettingsOverlay({ ttlMs = 2 * 60 * 1000, now = Date.now } = {}) {
    const entries = new Map();

    function get(userId) {
        const entry = entries.get(userId);
        if (!entry) return null;
        if (now() >= entry.expiresAt) {
            entries.delete(userId);
            return null;
        }
        return entry.settings;
    }

    function set(userId, settings) {
        entries.set(userId, {
            settings,
            expiresAt: now() + ttlMs,
        });
    }

    return { get, set };
}

module.exports = {
    DEFAULT_LEARNING_LEVEL,
    LEVELS,
    LEVEL_CHANGE_COOLDOWN_MS,
    buildLearningSettings,
    createLearningSettingsOverlay,
    normalizeLearningLevel,
    validateLearningLevelChange,
};
