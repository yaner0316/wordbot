const ELEMENTARY_LEVEL = String.fromCharCode(0x5c0f, 0x5b66);
const JUNIOR_HIGH_LEVEL = String.fromCharCode(0x4e2d, 0x5b66);
const HIGH_LEVEL = String.fromCharCode(0x9ad8, 0x4e2d);
const DEFAULT_LEARNING_LEVEL = JUNIOR_HIGH_LEVEL;
const LEVELS = [ELEMENTARY_LEVEL, JUNIOR_HIGH_LEVEL, HIGH_LEVEL, 'CET4_6_TOEFL'];

const LEVEL_ALIASES = new Map([
    ['CET/TOEFL', 'CET4_6_TOEFL'],
    ['CET4_6_TOEFL', 'CET4_6_TOEFL'],
    ['elementary', ELEMENTARY_LEVEL],
    ['middle', JUNIOR_HIGH_LEVEL],
    ['junior_high', JUNIOR_HIGH_LEVEL],
    ['high', HIGH_LEVEL],
    ['senior_high', HIGH_LEVEL],
    ['??', ELEMENTARY_LEVEL],
    [String.fromCodePoint(0x0421, 0x0467), ELEMENTARY_LEVEL],
    [String.fromCharCode(0x704f, 0x5fd3, 0xe15f), ELEMENTARY_LEVEL],
    [String.fromCharCode(0x4e36, 0x6d93, 0xe15f), JUNIOR_HIGH_LEVEL],
    [String.fromCharCode(0x696d, 0x6a3a, 0x8151), HIGH_LEVEL],
    [String.fromCharCode(0x6942, 0x6a39, 0x8151), HIGH_LEVEL],
]);

function normalizeLevel(level, { allowNull = false, defaultLevel = DEFAULT_LEARNING_LEVEL } = {}) {
    const value = String(level || '').trim();
    if (!value) return allowNull ? null : defaultLevel;
    const normalized = LEVEL_ALIASES.get(value) || value;
    if (!LEVELS.includes(normalized)) {
        throw new Error(`invalid learning level: ${value}`);
    }
    return normalized;
}

module.exports = {
    DEFAULT_LEARNING_LEVEL,
    ELEMENTARY_LEVEL,
    HIGH_LEVEL,
    JUNIOR_HIGH_LEVEL,
    LEVELS,
    normalizeLevel,
    normalizeLearningLevel: normalizeLevel,
};
