const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const supabase = require('./supabase-client');
const { isRealAssessment, getAssessmentMode } = require('./assessment-mode');
const { isMeaningAnswerCorrect } = require('./meaning-review');
const { summarizeReviewRound } = require('./review-session');
const {
    getCacheQuestionReadinessIssues,
    summarizeCacheStatus,
} = require('./question-cache');
const {
    generateElementaryDistractors,
    generateElementaryTemplateContext,
} = require('./elementary-context');
const { isBadQuizWord } = require('./question-quality');
const {
    DEFAULT_LEARNING_LEVEL,
    ELEMENTARY_LEVEL,
    HIGH_LEVEL,
    JUNIOR_HIGH_LEVEL,
    LEVELS,
    normalizeLevel,
} = require('./learning-level');

const PAGE_SIZE = 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_CORRECTNESS = new Set(['correct', 'wrong']);
const VALID_CONFIDENCE = new Set(['sure', 'guess']);
const VALID_MASTERY_STATUS = new Set(['pending', 'recognized', 'consolidating', 'mastered']);
const VALID_LEARNING_LEVELS = new Set(LEVELS);
const LEVEL_CHANGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
const QUIZ_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function canonicalUsernameKey(value) {
    return String(value || '').trim().replace(/\s+/g, '').toLowerCase();
}

function requireUsername(username) {
    const key = canonicalUsernameKey(username);
    if (!key) throw new Error('USERNAME_REQUIRED');
    return key;
}

function ensureNoError(error, label) {
    if (error) {
        throw new Error(`${label}: ${error.message}`);
    }
}

function isUuid(value) {
    return UUID_RE.test(String(value || '').trim());
}

function toIsoString(value = Date.now()) {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return new Date(numeric).toISOString();
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
    return new Date().toISOString();
}

function toMillis(value = Date.now()) {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Date.now();
}

function learningDay(value) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date(toIsoString(value)));
}

function normalizeQuestionType(value) {
    const text = String(value || '').trim();
    if (!['1', '2', '3', '4'].includes(text)) throw new Error('QUESTION_TYPE_REQUIRED');
    return text;
}

function normalizeCorrectness(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!VALID_CORRECTNESS.has(text)) throw new Error('CORRECTNESS_REQUIRED');
    return text;
}

function normalizeConfidence(value) {
    const text = String(value || 'sure').trim().toLowerCase();
    if (!VALID_CONFIDENCE.has(text)) throw new Error('ANSWER_CONFIDENCE_REQUIRED');
    return text;
}

function normalizeMasteryStatus(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!VALID_MASTERY_STATUS.has(text)) throw new Error('MASTERY_STATUS_REQUIRED');
    return text;
}

function normalizeLearningLevel(value) {
    const normalized = normalizeLevel(value);
    if (!VALID_LEARNING_LEVELS.has(normalized)) throw new Error(`invalid learning level: ${value}`);
    return normalized;
}

function normalizeOptionalLearningLevel(value) {
    return normalizeLevel(value, { allowNull: true });
}

function buildLearningSettingsFromUser(user, { now = Date.now() } = {}) {
    const learningLevel = normalizeLearningLevel(user?.learning_level || DEFAULT_LEARNING_LEVEL);
    const levelChangedAt = user?.level_changed_at ? toMillis(user.level_changed_at) : 0;
    const nextLevelChangeAt = levelChangedAt ? levelChangedAt + LEVEL_CHANGE_COOLDOWN_MS : now;
    return {
        userId: user?.username || '',
        learningLevel,
        levelChangedAt: levelChangedAt || null,
        nextLevelChangeAt,
        canChangeLevel: !levelChangedAt || now >= nextLevelChangeAt,
        questionCacheStatus: 'not_started',
    };
}

function normalizePartsOfSpeech(value) {
    const raw = Array.isArray(value) ? value.join(',') : String(value || '');
    if (!raw.trim()) return [];
    const abbreviations = new Map([
        ['n.', 'noun'], ['n', 'noun'],
        ['v.', 'verb'], ['v', 'verb'],
        ['adj.', 'adjective'], ['adj', 'adjective'],
        ['adv.', 'adverb'], ['adv', 'adverb'],
    ]);
    return raw
        .split(',')
        .map(part => part.trim().toLowerCase())
        .filter(Boolean)
        .map(part => abbreviations.get(part) || part);
}

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasWholeWord(context, word) {
    const key = String(word || '').trim();
    if (!key || !/^[a-z]+$/i.test(key)) return false;
    return new RegExp(`\\b${escapeRegExp(key)}\\b`, 'i').test(String(context || ''));
}

function fallbackElementaryContext(word, meaning) {
    const key = String(word || '').trim().toLowerCase();
    const clue = String(meaning || '').split(/[.;!?]/)[0].trim()
        .replace(new RegExp('\\b' + escapeRegExp(key) + '\\b', 'ig'), '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!clue) return '';
    return 'In class, the word ' + key + ' means ' + clue + '.';
}

function blankWordInContext(context, word) {
    return String(context || '').replace(new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i'), '_____');
}

function shuffled(values) {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index--) {
        const swapIndex = crypto.randomInt(0, index + 1);
        [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
}

function uniqueWords(values, correctWord) {
    const correct = String(correctWord || '').trim().toLowerCase();
    const seen = new Set();
    const result = [];
    for (const value of values || []) {
        const word = String(value || '').trim().toLowerCase();
        if (!word || word === correct || seen.has(word)) continue;
        if (!/^[a-z]+(?:'[a-z]+)?$/i.test(word)) continue;
        seen.add(word);
        result.push(word);
    }
    return result;
}

function normalizeWordInput(input) {
    if (typeof input === 'string') {
        const [wordPart, ...meaningParts] = input.split('|');
        const meaning = meaningParts.join('|').trim();
        return {
            word: String(wordPart || '').trim().toLowerCase(),
            meaning: meaning || String(wordPart || '').trim().toLowerCase(),
            meaningZh: meaning || null,
            raw: input,
        };
    }
    const word = String(input?.word || input?.Word || '').trim().toLowerCase();
    const meaning = String(input?.meaning || input?.Meaning || input?.meaningEn || input?.Meaning_EN || '').trim();
    const meaningZh = String(input?.meaningZh || input?.cnMeaning || input?.CN_Meaning || '').trim();
    return {
        word,
        meaning: meaning || meaningZh || word,
        meaningZh: meaningZh || null,
        context: input?.context || input?.Context || input?.contextEn,
        contextZh: input?.contextZh || input?.Context_CN,
        level: input?.level || input?.Level,
        partsOfSpeech: input?.partsOfSpeech || input?.pos || input?.POS,
        recordTime: input?.recordTime || input?.record_time,
        raw: input,
    };
}

function normalizeWordInputs(words) {
    return (words || []).map(normalizeWordInput).filter(entry => entry.word);
}

async function fetchAllRows(buildQuery, label) {
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
        const to = from + PAGE_SIZE - 1;
        const { data, error } = await buildQuery().range(from, to);
        ensureNoError(error, label);
        rows.push(...(data || []));
        if (!data || data.length < PAGE_SIZE) break;
    }
    return rows;
}

async function getUserByUsernameWithClient(client, username) {
    const usernameKey = requireUsername(username);
    const { data, error } = await client
        .from('users')
        .select('*')
        .eq('username_key', usernameKey)
        .maybeSingle();
    ensureNoError(error, 'getUserByUsername');
    return data ? { ...data, username_key: data.username_key || usernameKey } : null;
}

async function requireUserByUsername(client, username) {
    const user = await getUserByUsernameWithClient(client, username);
    if (!user) throw new Error(`USER_NOT_FOUND: ${username}`);
    return user;
}

async function getUserByUsername(username) {
    return getUserByUsernameWithClient(supabase, username);
}

async function getPartsOfSpeechByWordId(wordIds) {
    if (!wordIds.length) return new Map();
    const rows = await fetchAllRows(
        () => supabase
            .from('word_parts_of_speech')
            .select('word_id, position, parts_of_speech(code, display_name)')
            .in('word_id', wordIds)
            .order('position', { ascending: true }),
        'getWordsForUser.partsOfSpeech'
    );
    const byWordId = new Map();
    for (const row of rows) {
        const part = row.parts_of_speech;
        const value = part?.display_name || part?.code || '';
        if (!value) continue;
        if (!byWordId.has(row.word_id)) byWordId.set(row.word_id, []);
        byWordId.get(row.word_id).push(value);
    }
    return byWordId;
}

async function getWordsForUser(username, level) {
    return getWordsForUserWithClient(supabase, username, level);
}

async function getWordsForUserWithClient(client, username, level) {
    const user = await getUserByUsernameWithClient(client, username);
    if (!user) return [];
    const effectiveLevel = normalizeOptionalLearningLevel(level);
    const rows = await fetchAllRows(
        () => {
            let query = client
                .from('words')
                .select('*')
                .eq('user_id', user.id)
                .order('entered_at', { ascending: true })
                .order('id', { ascending: true });
            if (effectiveLevel) query = query.eq('level', effectiveLevel);
            return query;
        },
        'getWordsForUser'
    );
    const posByWordId = await getPartsOfSpeechByWordIdWithClient(client, rows.map((row) => row.id));
    return rows.map((row) => {
        const partsOfSpeech = posByWordId.get(row.id) || [];
        return {
            ...row,
            username: user.username,
            username_key: user.username_key,
            POS: partsOfSpeech.join(', '),
            parts_of_speech: partsOfSpeech,
        };
    });
}

async function getAssessmentsForUser(username) {
    return getAssessmentsForUserWithClient(supabase, username);
}

async function getAssessmentsForUserWithClient(client, username) {
    const user = await getUserByUsernameWithClient(client, username);
    if (!user) return [];
    const rows = await fetchAllRows(
        () => client
            .from('assessments')
            .select('*')
            .eq('user_id', user.id)
            .order('assessed_at', { ascending: true })
            .order('id', { ascending: true }),
        'getAssessmentsForUser'
    );
    return decorateAssessmentRows(rows, user);
}

function decorateAssessmentRows(rows, user) {
    return (rows || []).map((row) => ({
        ...row,
        username: user?.username || row.username || '',
        username_key: user?.username_key || row.username_key || '',
        correctness: row.is_correct,
        timestamp: row.assessed_at,
    }));
}

async function getAssessmentsForTestWithClient(client, username, testId) {
    const user = await getUserByUsernameWithClient(client, username);
    if (!user) return [];
    const rows = await fetchAllRows(
        () => client
            .from('assessments')
            .select('*')
            .eq('user_id', user.id)
            .eq('test_id', requireTestId(testId))
            .order('assessed_at', { ascending: true })
            .order('id', { ascending: true }),
        'getAssessmentsForTest'
    );
    return decorateAssessmentRows(rows, user);
}

async function getMasteryAssessmentsForWordsWithClient(client, username, sourceWordRecordIds = []) {
    const user = await getUserByUsernameWithClient(client, username);
    if (!user) return [];
    const ids = [...new Set((sourceWordRecordIds || []).map(id => String(id || '').trim()).filter(Boolean))];
    if (!ids.length) return [];
    const rows = await fetchAllRows(
        () => client
            .from('assessments')
            .select('*')
            .eq('user_id', user.id)
            .in('source_word_record_id', ids)
            .order('assessed_at', { ascending: true })
            .order('id', { ascending: true }),
        'getMasteryAssessmentsForWords'
    );
    return decorateAssessmentRows(rows, user);
}

async function getAssessmentsByTestIdWithClient(client, testId) {
    const rows = await fetchAllRows(
        () => client
            .from('assessments')
            .select('*')
            .eq('test_id', requireTestId(testId))
            .order('assessed_at', { ascending: true })
            .order('id', { ascending: true }),
        'getAssessmentsByTestId'
    );
    if (!rows.length) return [];
    const users = await fetchAllRows(
        () => client.from('users').select('*').in('id', [...new Set(rows.map(row => row.user_id).filter(Boolean))]),
        'getAssessmentsByTestId.users'
    );
    const usersById = new Map(users.map(user => [user.id, user]));
    return rows.map(row => ({
        ...row,
        username: usersById.get(row.user_id)?.username || '',
        username_key: usersById.get(row.user_id)?.username_key || '',
        correctness: row.is_correct,
        timestamp: row.assessed_at,
    }));
}

async function getPartsOfSpeechByWordIdWithClient(client, wordIds) {
    if (!wordIds.length) return new Map();
    const rows = await fetchAllRows(
        () => client
            .from('word_parts_of_speech')
            .select('word_id, position, parts_of_speech(code, display_name)')
            .in('word_id', wordIds)
            .order('position', { ascending: true }),
        'getWordsForUser.partsOfSpeech'
    );
    const byWordId = new Map();
    for (const row of rows) {
        const part = row.parts_of_speech;
        const value = part?.display_name || part?.code || '';
        if (!value) continue;
        if (!byWordId.has(row.word_id)) byWordId.set(row.word_id, []);
        byWordId.get(row.word_id).push(value);
    }
    return byWordId;
}

async function getWordsById(wordIds) {
    return getWordsByIdWithClient(supabase, wordIds);
}

async function getWordsByIdWithClient(client, wordIds) {
    const uniqueIds = [...new Set(wordIds.filter(Boolean))];
    if (!uniqueIds.length) return new Map();
    const rows = await fetchAllRows(
        () => client
            .from('words')
            .select('id, feishu_record_id, word')
            .in('id', uniqueIds),
        'getQuestionCache.words'
    );
    return new Map(rows.map((row) => [row.id, row]));
}

function toQuestionCacheStatusRecord(row, { user, word }) {
    const sourceWordRecordId = row.source_word_record_id || word?.feishu_record_id || row.word_id || '';
    return {
        record_id: row.feishu_record_id || row.id || '',
        fields: {
            user: user?.username || '',
            word_record_id: sourceWordRecordId,
            word: word?.word || row.word || '',
            level: row.level || '',
            round_type: row.round_type || 'primary',
            quality_status: row.quality_status || 'pending',
            question_type: row.question_type || '',
            question_text: row.question_text || '',
            context_cn: row.context_zh || '',
            suffix: row.suffix || '',
            options: JSON.stringify(row.options || []),
            answer: row.answer || '',
            option_meanings: JSON.stringify(row.option_meanings || []),
            correct_meaning: row.correct_meaning || '',
            used_count: Number(row.used_count || 0),
            generated_at: toMillis(row.generated_at || row.created_at),
        },
    };
}

async function toQuestionCacheStatusRecordsWithClient(client, user, rows) {
    const wordsById = await getWordsByIdWithClient(client, rows.map(row => row.word_id));
    return rows.map(row => toQuestionCacheStatusRecord(row, {
        user,
        word: wordsById.get(row.word_id),
    }));
}

async function getQuestionCacheStatusWithClient(client, username) {
    const user = await getUserByUsernameWithClient(client, username);
    if (!user) return { configured: true, total: 0, ready: 0, byLevel: {}, byRoundType: {} };
    const rows = await fetchAllRows(
        () => client
            .from('question_cache')
            .select('*')
            .eq('user_id', user.id)
            .order('generated_at', { ascending: true })
            .order('id', { ascending: true }),
        'getQuestionCacheStatus'
    );
    const statusRows = await toQuestionCacheStatusRecordsWithClient(client, user, rows);
    return {
        configured: true,
        ...summarizeCacheStatus(statusRows),
    };
}

async function getUserLearningSettingsWithClient(client, username) {
    const user = await requireUserByUsername(client, username);
    const settings = buildLearningSettingsFromUser(user);
    const status = await getQuestionCacheStatusWithClient(client, username);
    const readyForLevel = Number(status?.byLevel?.[settings.learningLevel]?.ready || 0);
    return {
        ...settings,
        questionCacheStatus: readyForLevel >= 10 ? 'ready' : (readyForLevel > 0 ? 'partial' : 'not_started'),
    };
}


async function isMigratedUnassignedVocabularyLevelRepair(client, user, currentLevel, nextLevel) {
    if (currentLevel !== ELEMENTARY_LEVEL || nextLevel === ELEMENTARY_LEVEL) return false;
    const rows = await fetchAllRows(
        () => client
            .from('words')
            .select('id, level')
            .eq('user_id', user.id)
            .order('entered_at', { ascending: true })
            .order('id', { ascending: true }),
        'updateUserLearningSettings.migratedWords'
    );
    const levelCounts = rows.reduce((counts, row) => {
        const rowLevel = normalizeOptionalLearningLevel(row.level);
        if (!rowLevel) counts.unassigned += 1;
        else if (rowLevel === nextLevel) counts.target += 1;
        else if (rowLevel === currentLevel) counts.current += 1;
        return counts;
    }, { unassigned: 0, target: 0, current: 0 });
    const allRowsUnassignedOrTarget = rows.every(row => {
        const rowLevel = normalizeOptionalLearningLevel(row.level);
        return !rowLevel || rowLevel === nextLevel;
    });
    const targetLevelDominatesCurrent = levelCounts.target >= 10 && levelCounts.target > levelCounts.current;
    return rows.length > 0 && (allRowsUnassignedOrTarget || targetLevelDominatesCurrent);
}
async function updateUserLearningSettingsWithClient(client, username, requestedLevel) {
    const user = await requireUserByUsername(client, username);
    const now = Date.now();
    const hasStoredLearningLevel = Boolean(user.learning_level);
    const currentLevel = normalizeLearningLevel(user.learning_level || DEFAULT_LEARNING_LEVEL);
    const nextLevel = normalizeLearningLevel(requestedLevel);
    const levelChangedAt = user.level_changed_at ? toMillis(user.level_changed_at) : 0;
    const nextAllowedAt = levelChangedAt ? levelChangedAt + LEVEL_CHANGE_COOLDOWN_MS : now;
    if (hasStoredLearningLevel && nextLevel !== currentLevel && levelChangedAt && now < nextAllowedAt) {
        const isMigrationRepair = await isMigratedUnassignedVocabularyLevelRepair(client, user, currentLevel, nextLevel);
        if (!isMigrationRepair) {
            return {
                success: false,
                error: 'cooldown',
                settings: {
                    ...buildLearningSettingsFromUser(user, { now }),
                    nextLevelChangeAt: nextAllowedAt,
                    canChangeLevel: false,
                },
            };
        }
    }
    const changed = !hasStoredLearningLevel || nextLevel !== currentLevel;
    const payload = {
        learning_level: nextLevel,
        ...(changed ? { level_changed_at: new Date(now).toISOString() } : {}),
    };
    const { data, error } = await client
        .from('users')
        .update(payload)
        .eq('id', user.id)
        .select('id, username, username_key, learning_level, level_changed_at')
        .single();
    ensureNoError(error, 'updateUserLearningSettings');
    if (changed) {
        await deleteQuestionCacheRowsWithClient(client, data.username, null);
    }
    return {
        success: true,
        settings: {
            ...buildLearningSettingsFromUser(data, { now }),
            questionCacheStatus: changed ? 'building' : 'not_started',
        },
    };
}

async function getQuestionCacheDiagnosticsWithClient(client, username) {
    const user = username ? await getUserByUsernameWithClient(client, username) : null;
    const rows = await fetchAllRows(
        () => {
            let query = client
                .from('question_cache')
                .select('*')
                .order('generated_at', { ascending: true })
                .order('id', { ascending: true });
            if (user) query = query.eq('user_id', user.id);
            return query;
        },
        'getQuestionCacheDiagnostics'
    );
    const userRows = user ? [user] : await fetchAllRows(
        () => client.from('users').select('id, username, username_key, learning_level'),
        'getQuestionCacheDiagnostics.users'
    );
    const usersById = new Map(userRows.map(row => [row.id, row]));
    const wordsById = await getWordsByIdWithClient(client, rows.map(row => row.word_id));
    const groups = new Map();
    for (const row of rows) {
        const rowUser = usersById.get(row.user_id);
        const statusRecord = toQuestionCacheStatusRecord(row, {
            user: rowUser,
            word: wordsById.get(row.word_id),
        });
        const fields = statusRecord.fields;
        const key = `${String(fields.user || '').trim().toLowerCase()}::${fields.level}::${fields.round_type}`;
        if (!groups.has(key)) {
            groups.set(key, {
                userId: fields.user,
                level: fields.level,
                roundType: fields.round_type,
                type1Ready: 0,
                type2Ready: 0,
                type3Ready: 0,
                totalReady: 0,
            });
        }
        if (getCacheQuestionReadinessIssues(statusRecord).length) continue;
        const group = groups.get(key);
        const type = Number(fields.question_type);
        if (type === 1) group.type1Ready += 1;
        if (type === 2) group.type2Ready += 1;
        if (type === 3) group.type3Ready += 1;
        group.totalReady += 1;
    }
    const results = [...groups.values()]
        .map(group => ({
            ...group,
            selectedReady: Math.min(group.totalReady, 10),
            quotaCanBeMet: group.totalReady >= 10,
            willUseFallback: group.totalReady < 10,
        }))
        .sort((a, b) =>
            String(a.userId).localeCompare(String(b.userId)) ||
            String(a.level).localeCompare(String(b.level)) ||
            String(a.roundType).localeCompare(String(b.roundType))
        );
    return { configured: true, results };
}

async function getQuestionCache(username, level, roundType) {
    return getQuestionCacheWithClient(supabase, username, level, roundType);
}

async function getQuestionCacheWithClient(client, username, level, roundType) {
    const user = await getUserByUsernameWithClient(client, username);
    if (!user) return [];
    const effectiveLevel = normalizeOptionalLearningLevel(level);
    const rows = await fetchAllRows(
        () => {
            let query = client
                .from('question_cache')
                .select('*')
                .eq('user_id', user.id)
                .eq('quality_status', 'ready')
                .order('used_count', { ascending: true })
                .order('generated_at', { ascending: true })
                .order('id', { ascending: true });
            if (effectiveLevel) query = query.eq('level', effectiveLevel);
            if (roundType) query = query.eq('round_type', roundType);
            return query;
        },
        'getQuestionCache'
    );
    const wordsById = await getWordsByIdWithClient(client, rows.map((row) => row.word_id));
    return rows.map((row) => {
        const word = wordsById.get(row.word_id);
        return {
            ...row,
            username: user.username,
            username_key: user.username_key,
            word: word?.word || '',
            word_feishu_record_id: word?.feishu_record_id || '',
            source_word_record_id: row.source_word_record_id || word?.feishu_record_id || row.word_id,
        };
    });
}

function hasChineseText(value) {
    return /[\u3400-\u9fff]/.test(String(value || ''));
}

function cleanChineseMeaningForCache(word) {
    const meaning = String(word?.meaning_zh || '').trim();
    return hasChineseText(meaning) ? meaning : '';
}

function stableWordOffset(word, size) {
    if (!size) return 0;
    let hash = 0;
    for (const char of String(word || '')) {
        hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
    }
    return hash % size;
}

function rotateFallbackDistractors(pool, word) {
    const offset = stableWordOffset(word, pool.length);
    return [...pool.slice(offset), ...pool.slice(0, offset)];
}function buildType3CacheQuestionRowsForWord({ user, word, level, roundType, now = Date.now(), fallbackDistractors = [] }) {
    const wordText = String(word.word || '').trim().toLowerCase();
    if (!wordText || !/^[a-z]+$/i.test(wordText) || isBadQuizWord(wordText)) return [];
    const meaning = cleanChineseMeaningForCache(word);
    if (!meaning) return [];
    const distractorPool = uniqueWords([
        ...(word.distractors || []),
        ...(word.old_distractors || []),
        ...(fallbackDistractors || []),
    ], wordText).filter(option => !isBadQuizWord(option));
    const distractors = rotateFallbackDistractors(distractorPool, wordText).slice(0, 3);
    if (distractors.length < 3) return [];
    const optionWords = shuffled([wordText, ...distractors]);
    const letters = ['A', 'B', 'C', 'D'];
    const answer = letters[optionWords.indexOf(wordText)];
    const options = optionWords.map((option, index) => `${letters[index]}. ${option}`);
    const optionMeanings = optionWords.map(option => option === wordText ? meaning : option);
    const base = {
        user_id: user.id,
        word_id: word.id,
        source_word_record_id: word.feishu_record_id || word.id,
        level,
        quality_status: 'ready',
        question_type: '3',
        question_text: meaning,
        context_zh: null,
        suffix: null,
        options,
        answer,
        option_meanings: optionMeanings,
        correct_meaning: meaning,
        ai_audit_status: 'skipped',
        source_version: 'supabase-rebuild-v1',
        used_count: 0,
        generated_at: toIsoString(now),
        last_used_at: null,
    };
    const rows = ['primary', 'review'].map(type => ({ ...base, round_type: roundType || type }));
    return rows.filter(row => getCacheQuestionReadinessIssues(toQuestionCacheStatusRecord(row, { user, word })).length === 0);
}
function buildCacheQuestionRowsForWord({ user, word, level, roundType, now = Date.now(), fallbackDistractors = [] }) {
    const wordText = String(word.word || '').trim().toLowerCase();
    if (!wordText || !/^[a-z]+$/i.test(wordText)) return [];
    const meaning = word.meaning_zh || word.meaning_en || wordText;
    const templateContext = level === ELEMENTARY_LEVEL
        ? generateElementaryTemplateContext(wordText, word.meaning_en || word.meaning_zh || '')
        : '';
    const fallbackContext = level === ELEMENTARY_LEVEL
        ? fallbackElementaryContext(wordText, word.meaning_en || word.meaning_zh || '')
        : '';
    const sourceContext = templateContext || word.context_en || fallbackContext;
    if (!hasWholeWord(sourceContext, wordText)) {
        if (level !== ELEMENTARY_LEVEL) {
            return buildType3CacheQuestionRowsForWord({ user, word, level, roundType, now, fallbackDistractors });
        }
        return [];
    }
    const context = blankWordInContext(sourceContext, wordText);
    const levelFallbackDistractors = level === ELEMENTARY_LEVEL
        ? [...generateElementaryDistractors(wordText), 'apple', 'book', 'cat', 'dog', 'house', 'school']
        : [];
    const distractors = uniqueWords([
        ...levelFallbackDistractors,
        ...(word.distractors || []),
        ...(word.old_distractors || []),
    ], wordText).slice(0, 3);
    if (distractors.length < 3) return [];
    const optionWords = shuffled([wordText, ...distractors]);
    const letters = ['A', 'B', 'C', 'D'];
    const answer = letters[optionWords.indexOf(wordText)];
    const options = optionWords.map((option, index) => `${letters[index]}. ${option}`);
    const optionMeanings = optionWords.map(option => option === wordText ? String(meaning || wordText) : option);
    const base = {
        user_id: user.id,
        word_id: word.id,
        source_word_record_id: word.feishu_record_id || word.id,
        level,
        quality_status: 'ready',
        question_type: '1',
        question_text: context,
        context_zh: word.context_zh || null,
        suffix: null,
        options,
        answer,
        option_meanings: optionMeanings,
        correct_meaning: String(meaning || ''),
        ai_audit_status: 'skipped',
        source_version: 'supabase-rebuild-v1',
        used_count: 0,
        generated_at: toIsoString(now),
        last_used_at: null,
    };
    const rows = ['primary', 'review'].map(type => ({ ...base, round_type: roundType || type }));
    const readyRows = rows.filter(row => getCacheQuestionReadinessIssues(toQuestionCacheStatusRecord(row, { user, word })).length === 0);
    if (readyRows.length) return readyRows;
    if (level !== ELEMENTARY_LEVEL) {
        return buildType3CacheQuestionRowsForWord({ user, word, level, roundType, now, fallbackDistractors });
    }
    if (sourceContext === fallbackContext) return readyRows;
    const fallbackRows = rows.map(row => ({
        ...row,
        question_text: blankWordInContext(fallbackContext, wordText),
    }));
    return fallbackRows.filter(row => getCacheQuestionReadinessIssues(toQuestionCacheStatusRecord(row, { user, word })).length === 0);
}

async function deleteQuestionCacheRowsWithClient(client, username, type = null) {
    const user = await getUserByUsernameWithClient(client, username);
    if (!user) return { deleted: 0 };
    let query = client
        .from('question_cache')
        .delete()
        .eq('user_id', user.id);
    if (type !== null && type !== undefined) query = query.eq('question_type', String(type));
    const { data, error } = await query.select('id');
    ensureNoError(error, 'deleteQuestionCacheRows');
    return { deleted: (data || []).length };
}

async function rebuildQuestionCacheForUserWithClient(client, username) {
    const user = await requireUserByUsername(client, username);
    const level = normalizeOptionalLearningLevel(user.learning_level);
    if (!level) return { configured: true, skipped: true, level: null, count: 0 };
    const words = await getWordsForUserWithClient(client, username);
    const candidateWords = words
        .filter(row => {
            const wordLevel = normalizeOptionalLearningLevel(row.level);
            return !wordLevel || wordLevel === level;
        })
        .filter(row => row.mastery_status !== 'mastered')
        .sort((left, right) => toMillis(left.entered_at || left.created_at) - toMillis(right.entered_at || right.created_at));
    let deleteQuery = client
        .from('question_cache')
        .delete()
        .eq('user_id', user.id)
        .eq('level', level);
    const { error: deleteError } = await deleteQuery.select('id');
    ensureNoError(deleteError, 'rebuildQuestionCache.deleteExisting');
    const rows = [];
    const fallbackDistractors = candidateWords
        .filter(word => cleanChineseMeaningForCache(word))
        .filter(word => !isBadQuizWord(word.word))
        .map(word => word.word);
    for (const word of candidateWords) {
        rows.push(...buildCacheQuestionRowsForWord({ user, word, level, fallbackDistractors }));
    }
    if (rows.length) {
        const { error } = await client
            .from('question_cache')
            .insert(rows)
            .select('id');
        ensureNoError(error, 'rebuildQuestionCache.insert');
    }
    const statusRows = await toQuestionCacheStatusRecordsWithClient(client, user, rows);
    return {
        configured: true,
        level,
        count: rows.length,
        status: summarizeCacheStatus(statusRows),
    };
}

async function resolveWordRows(client, userId, word, options = {}) {
    const sourceWordRecordId = String(options.sourceWordRecordId || options.wordRecordId || '').trim();
    if (options.wordId) {
        const { data, error } = await client
            .from('words')
            .select('*')
            .eq('id', options.wordId)
            .eq('user_id', userId)
            .maybeSingle();
        ensureNoError(error, 'resolveWordRows.wordId');
        if (data) return [data];
    }
    if (sourceWordRecordId && isUuid(sourceWordRecordId)) {
        const { data, error } = await client
            .from('words')
            .select('*')
            .eq('id', sourceWordRecordId)
            .eq('user_id', userId)
            .maybeSingle();
        ensureNoError(error, 'resolveWordRows.sourceUuid');
        if (data) return [data];
    }
    if (sourceWordRecordId) {
        const { data, error } = await client
            .from('words')
            .select('*')
            .eq('feishu_record_id', sourceWordRecordId)
            .eq('user_id', userId)
            .maybeSingle();
        ensureNoError(error, 'resolveWordRows.sourceFeishu');
        if (data) return [data];
    }

    const normalizedWord = String(word || '').trim();
    if (!normalizedWord) throw new Error('WORD_REQUIRED');
    const rows = await fetchAllRows(
        () => client
            .from('words')
            .select('*')
            .eq('user_id', userId)
            .order('entered_at', { ascending: true })
            .order('id', { ascending: true }),
        'resolveWordRows.word'
    );
    const target = normalizedWord.toLowerCase();
    const matches = rows.filter(row => String(row.word || '').trim().toLowerCase() === target);
    if (!matches.length) throw new Error(`WORD_NOT_FOUND: ${normalizedWord}`);
    return matches;
}

async function resolveCacheRow(client, cacheId) {
    const id = String(cacheId || '').trim();
    if (!id) throw new Error('CACHE_ID_REQUIRED');
    if (isUuid(id)) {
        const { data, error } = await client
            .from('question_cache')
            .select('*')
            .eq('id', id)
            .maybeSingle();
        ensureNoError(error, 'resolveCacheRow.uuid');
        if (data) return data;
    }
    let { data, error } = await client
        .from('question_cache')
        .select('*')
        .eq('feishu_record_id', id)
        .maybeSingle();
    ensureNoError(error, 'resolveCacheRow.feishu');
    if (!data) {
        ({ data, error } = await client
            .from('question_cache')
            .select('*')
            .eq('source_word_record_id', id)
            .eq('round_type', 'primary')
            .maybeSingle());
        ensureNoError(error, 'resolveCacheRow.sourceWord');
    }
    if (!data) throw new Error('QUESTION_CACHE_NOT_FOUND: ' + id);
    return data;
}

async function submitAssessmentWithClient(client, input) {
    const user = await requireUserByUsername(client, input.username);
    const [wordRow] = await resolveWordRows(client, user.id, input.word, input);
    const assessedAt = toIsoString(input.recordTime);
    const row = {
        user_id: user.id,
        word_id: wordRow.id,
        source_word_record_id: input.sourceWordRecordId || input.wordRecordId || wordRow.feishu_record_id || null,
        test_id: String(input.testId || '').trim(),
        is_real_assessment: isRealAssessment(input.testId),
        assessed_at: assessedAt,
        learning_day: learningDay(assessedAt),
        question_type: normalizeQuestionType(input.questionType),
        level: normalizeOptionalLearningLevel(input.level || wordRow.level),
        word_snapshot: String(input.word || wordRow.word || '').trim(),
        question_text: input.questionText || input.context || null,
        options: Array.isArray(input.options) ? input.options : [],
        correct_answer: input.correctAnswer || null,
        submitted_answer: String(input.yourAnswer || '').trim(),
        answer_confidence: normalizeConfidence(input.confidence),
        is_correct: normalizeCorrectness(input.correctness),
        source: input.source || null,
        assessment_kind: input.assessmentKind || null,
    };
    if (!row.test_id) throw new Error('TEST_ID_REQUIRED');
    if (!row.word_snapshot) throw new Error('WORD_REQUIRED');
    const { data, error } = await client
        .from('assessments')
        .insert(row)
        .select('*')
        .single();
    ensureNoError(error, 'submitAssessment');
    return data;
}

function isSubmittedAssessmentRow(row) {
    return row && row.submitted_answer !== null && row.submitted_answer !== undefined && row.is_correct;
}

function isCorrectAssessmentRow(row) {
    return String(row?.is_correct || '').trim().toLowerCase() === 'correct';
}

async function getWordInfoForReview(client, userId, row) {
    let query = client.from('words').select('*');
    if (row.word_id) query = query.eq('id', row.word_id);
    else query = query.eq('user_id', userId).eq('feishu_record_id', row.source_word_record_id);
    const { data, error } = await query.maybeSingle();
    ensureNoError(error, 'getWordInfoForReview');
    if (!data) throw new Error('Word record not found for review generation');
    return data;
}

function isMissingReviewParentColumnError(error) {
    const message = [error?.message, error?.details, error?.hint].map(value => String(value || '').toLowerCase()).join(' ');
    return message.includes('parent_review_id') && (error?.code === 'PGRST204' || message.includes('column') || message.includes('schema cache'));
}

async function findExistingReviewRoundWithClient(client, user, sourceTestId, parentReviewId = '') {
    const loadRows = includeParent => fetchAllRows(() => {
        let query = client.from('assessments').select('*').eq('user_id', user.id).eq('source_test_id', sourceTestId).eq('review_status', 'active').order('assessed_at', { ascending: true }).order('id', { ascending: true });
        if (includeParent) query = query.eq('parent_review_id', parentReviewId);
        return query;
    }, 'findExistingReviewRound');
    let rows;
    try { rows = await loadRows(Boolean(parentReviewId)); }
    catch (error) { if (!isMissingReviewParentColumnError(error)) throw error; rows = await loadRows(false); }
    if (parentReviewId) rows = rows.filter(row => !Object.prototype.hasOwnProperty.call(row, 'parent_review_id') || row.parent_review_id === parentReviewId);
    if (!rows.length) return null;
    return buildSupabaseReviewRoundResponse(decorateAssessmentRows(rows, user), rows[0].test_id);
}
function buildSupabaseReviewRoundResponse(rows, reviewId) {
    if (!rows.length) return null;
    const first = rows[0];
    return {
        reviewId,
        sourceTestId: first.source_test_id || '',
        parentReviewId: first.parent_review_id || '',
        round: Number(first.review_round || 1),
        mode: getAssessmentMode(reviewId),
        status: first.review_status || 'active',
        questions: rows.map(row => ({
            recordId: row.source_word_record_id || row.word_id || '',
            type: Number(row.question_type) || 4,
            word: row.word_snapshot || '',
            context: row.question_text || '',
            options: Array.isArray(row.options) ? row.options : [],
            answer: Number(row.question_type) === 4 ? undefined : row.correct_answer,
            answerMode: Number(row.question_type) === 4 ? 'cn_meaning' : undefined,
            correctMeaning: row.correct_answer || '',
            correctMeanings: null,
        })),
    };
}

async function createReviewRoundWithClient(client, { userId, sourceTestId, parentReviewId = '' }) {
    const user = await requireUserByUsername(client, userId);
    const sourceRows = await getAssessmentsForTestWithClient(client, userId, parentReviewId || sourceTestId);
    if (!sourceRows.length) throw new Error('Review source records not found');
    if (!sourceRows.every(row => row.user_id === user.id)) throw new Error('Review source does not belong to current user');
    if (!sourceRows.every(isSubmittedAssessmentRow)) throw new Error('Source assessment must be submitted before review');

    const existing = await findExistingReviewRoundWithClient(client, user, sourceTestId, parentReviewId);
    if (existing) return existing;

    const wrongRows = sourceRows.filter(row => !isCorrectAssessmentRow(row));
    if (!wrongRows.length) return { sourceTestId, parentReviewId, complete: true, questions: [] };

    const mode = getAssessmentMode(sourceTestId);
    const reviewId = mode + '-review-' + crypto.randomUUID().split('-')[0];
    const round = parentReviewId ? Number(sourceRows[0].review_round || 0) + 1 : 1;
    const assessedAtBase = Date.now();
    const insertRows = [];
    for (let index = 0; index < wrongRows.length; index++) {
        const row = wrongRows[index];
        const word = await getWordInfoForReview(client, user.id, row);
        const correctMeaning = String(word.meaning_zh || row.correct_answer || word.meaning_en || word.word || '').trim();
        const assessedAt = toIsoString(assessedAtBase + index);
        insertRows.push({
            user_id: user.id,
            word_id: word.id,
            source_word_record_id: row.source_word_record_id || word.feishu_record_id || word.id,
            test_id: reviewId,
            is_real_assessment: isRealAssessment(reviewId),
            assessed_at: assessedAt,
            learning_day: learningDay(assessedAt),
            question_type: '4',
            level: normalizeOptionalLearningLevel(row.level || word.level),
            word_snapshot: String(row.word_snapshot || word.word || '').trim(),
            question_text: '',
            options: [],
            correct_answer: correctMeaning,
            submitted_answer: null,
            answer_confidence: null,
            is_correct: null,
            source: 'review',
            assessment_kind: 'review',
            review_round: String(round),
            review_status: 'active',
            source_question_id: row.id || row.feishu_record_id || '',
            source_test_id: sourceTestId,
            parent_review_id: parentReviewId,
        });
    }
    let { data, error } = await client.from('assessments').insert(insertRows).select('*');
    if (isMissingReviewParentColumnError(error)) {
        const compatibleRows = insertRows.map(row => {
            const compatibleRow = { ...row };
            delete compatibleRow.parent_review_id;
            return compatibleRow;
        });
        ({ data, error } = await client.from('assessments').insert(compatibleRows).select('*'));
    }
    ensureNoError(error, 'createReviewRound');
    return buildSupabaseReviewRoundResponse(decorateAssessmentRows(data || [], user), reviewId);
}

async function prebuildWrongQuestionCacheWithClient() {
    return { prepared: 0, skipped: true, source: 'supabase-review-round' };
}

async function submitReviewRoundWithClient(client, { userId, reviewId, answers }) {
    const user = await requireUserByUsername(client, userId);
    const rows = await getAssessmentsForTestWithClient(client, userId, reviewId);
    if (!rows.length) throw new Error('Review records not found');
    if (!rows.every(row => row.user_id === user.id)) throw new Error('Review source does not belong to current user');
    const sorted = [...rows].sort((left, right) => Number(toMillis(left.assessed_at)) - Number(toMillis(right.assessed_at)));
    const results = [];
    for (let index = 0; index < sorted.length; index++) {
        const row = sorted[index];
        const answer = answers?.[index] || {};
        const submitted = String(answer.text ?? '').trim();
        const expected = String(row.correct_answer || '').trim();
        const correct = isMeaningAnswerCorrect(submitted, expected);
        const { data, error } = await client
            .from('assessments')
            .update({
                submitted_answer: submitted,
                answer_confidence: answer.confidence || 'sure',
                is_correct: correct ? 'correct' : 'wrong',
            })
            .eq('id', row.id)
            .select('*')
            .single();
        ensureNoError(error, 'submitReviewRound.updateAnswer');
        results.push({
            q: index + 1,
            word: row.word_snapshot || '',
            recordId: row.source_word_record_id || row.word_id || '',
            your: submitted,
            answer: expected,
            correct,
            confidence: answer.confidence || '',
        });
        Object.assign(row, data || {});
    }
    const summary = summarizeReviewRound(results);
    await Promise.all(sorted.map(row => client
        .from('assessments')
        .update({ review_status: summary.status })
        .eq('id', row.id)
        .select('*')
        .single()
        .then(({ error }) => ensureNoError(error, 'submitReviewRound.updateStatus'))
    ));
    const total = results.length;
    const correct = results.filter(result => result.correct).length;
    return {
        mode: getAssessmentMode(reviewId),
        results,
        correct,
        total,
        accuracy: total ? ((correct / total) * 100).toFixed(1) + '%' : '0.0%',
        masteredWords: [],
        ...summary,
        reviewId,
        sourceTestId: sorted[0].source_test_id || '',
        round: Number(sorted[0].review_round || 1),
    };
}


async function getActiveReviewRoundWithClient(client, { userId, sourceTestId }) {
    const user = await requireUserByUsername(client, userId);
    return findExistingReviewRoundWithClient(client, user, sourceTestId, '');
}
async function deferReviewRoundWithClient(client, { userId, reviewId }) {
    const user = await requireUserByUsername(client, userId);
    const rows = await getAssessmentsForTestWithClient(client, userId, reviewId);
    if (!rows.length) throw new Error('Review records not found');
    const remainingRecordIds = rows.filter(row => !isCorrectAssessmentRow(row)).map(row => row.source_word_record_id).filter(Boolean);
    if (!remainingRecordIds.length) throw new Error('No review words remain deferred');
    const { error } = await client.from('assessments').update({ review_status: 'deferred' }).eq('user_id', user.id).eq('test_id', reviewId).eq('review_status', 'active').select('*');
    ensureNoError(error, 'deferReviewRound');
    return { reviewId, deferred: true, remainingRecordIds };
}
async function getReviewSummaryWithClient(client, { userId, sourceTestId }) {
    const user = await requireUserByUsername(client, userId);
    const rows = await fetchAllRows(() => client.from('assessments').select('*').eq('user_id', user.id).eq('source_test_id', sourceTestId).order('assessed_at', { ascending: true }).order('id', { ascending: true }), 'getReviewSummary');
    const reviewedRecordIds = [...new Set(rows.map(row => row.source_word_record_id).filter(Boolean))];
    const deferredRecordIds = [...new Set(rows.filter(row => row.review_status === 'deferred').map(row => row.source_word_record_id).filter(Boolean))];
    return { sourceTestId, reviewedRecordIds, deferredRecordIds, reviewed: reviewedRecordIds.length, deferred: deferredRecordIds.length };
}
const reviewRoundCreationLocks = new Map();
function reviewRoundLockKey({ userId, sourceTestId, parentReviewId = '' }) { return [userId, sourceTestId, parentReviewId].map(value => String(value || '').trim().toLowerCase()).join(':'); }
async function createReviewRoundWithLock(client, input) {
    const key = reviewRoundLockKey(input); const previous = reviewRoundCreationLocks.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(() => createReviewRoundWithClient(client, input)); reviewRoundCreationLocks.set(key, current);
    try { return await current; } finally { if (reviewRoundCreationLocks.get(key) === current) reviewRoundCreationLocks.delete(key); }
}

const cacheUsageWrites = new Map();

function incrementCacheUsedCountWithClient(client, cacheId) {
    const key = String(cacheId || '').trim();
    const previous = cacheUsageWrites.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
        const cacheRow = await resolveCacheRow(client, cacheId);
        const nextUsedCount = Number(cacheRow.used_count || 0) + 1;
        const { data, error } = await client
            .from('question_cache')
            .update({
                used_count: nextUsedCount,
                last_used_at: new Date().toISOString(),
            })
            .eq('id', cacheRow.id)
            .select('*')
            .single();
        ensureNoError(error, 'incrementCacheUsedCount');
        return data;
    });
    cacheUsageWrites.set(key, current);
    return current.finally(() => {
        if (cacheUsageWrites.get(key) === current) cacheUsageWrites.delete(key);
    });
}

async function updateWordMasteryWithClient(client, username, word, newMasteryStatus, options = {}) {
    const user = await requireUserByUsername(client, username);
    const masteryStatus = normalizeMasteryStatus(newMasteryStatus);
    const rows = await resolveWordRows(client, user.id, word, options);
    const updated = [];
    for (const row of rows) {
        const payload = {
            mastery_status: masteryStatus,
            updated_at: new Date().toISOString(),
        };
        if (masteryStatus === 'mastered' && !row.remembered_at) {
            payload.remembered_at = new Date().toISOString();
        }
        const { data, error } = await client
            .from('words')
            .update(payload)
            .eq('id', row.id)
            .select('*')
            .single();
        ensureNoError(error, 'updateWordMastery');
        updated.push(data);
    }
    return updated;
}

async function ensurePartOfSpeechRows(client, codes) {
    const uniqueCodes = [...new Set(codes)];
    if (!uniqueCodes.length) return new Map();
    const { data: existing, error } = await client
        .from('parts_of_speech')
        .select('id,code')
        .in('code', uniqueCodes);
    ensureNoError(error, 'addWord.partsOfSpeech.lookup');
    const byCode = new Map((existing || []).map(row => [row.code, row]));
    const missing = uniqueCodes.filter(code => !byCode.has(code));
    if (missing.length) {
        const { data: inserted, error: insertError } = await client
            .from('parts_of_speech')
            .insert(missing.map(code => ({ code, display_name: code })))
            .select('id,code');
        ensureNoError(insertError, 'addWord.partsOfSpeech.insert');
        for (const row of inserted || []) byCode.set(row.code, row);
    }
    return byCode;
}

async function addWordWithClient(client, input) {
    const user = await requireUserByUsername(client, input.username);
    const word = String(input.word || '').trim();
    const meaning = String(input.meaning || '').trim();
    if (!word || !meaning) throw new Error('WORD_AND_MEANING_REQUIRED');

    const row = {
        user_id: user.id,
        word,
        meaning_en: meaning,
        meaning_zh: input.meaningZh || input.cnMeaning || null,
        context_en: input.context || input.contextEn || null,
        context_zh: input.contextZh || null,
        level: normalizeOptionalLearningLevel(input.level || user.learning_level),
        mastery_status: 'pending',
        entered_at: toIsoString(input.recordTime),
    };
    const { data, error } = await client
        .from('words')
        .insert(row)
        .select('*')
        .single();
    ensureNoError(error, 'addWord.words');

    const parts = normalizePartsOfSpeech(input.partsOfSpeech || input.pos || input.POS);
    if (parts.length) {
        const partRows = await ensurePartOfSpeechRows(client, parts);
        const junctionRows = parts.map((part, index) => ({
            word_id: data.id,
            part_of_speech_id: partRows.get(part).id,
            position: index + 1,
        }));
        const { error: junctionError } = await client
            .from('word_parts_of_speech')
            .insert(junctionRows);
        ensureNoError(junctionError, 'addWord.wordPartsOfSpeech');
    }
    return data;
}

async function addWordsWithClient(client, targetUser, words, options = {}) {
    const entries = normalizeWordInputs(words);
    const duplicateInputWords = new Set();
    const seen = new Set();
    for (const entry of entries) {
        if (seen.has(entry.word)) duplicateInputWords.add(entry.word);
        seen.add(entry.word);
    }
    const entriesToAdd = options.skipDuplicateWords
        ? entries.filter(entry => !duplicateInputWords.has(entry.word))
        : entries;
    const errors = [];
    let count = 0;

    for (const entry of entriesToAdd) {
        try {
            await addWordWithClient(client, {
                username: targetUser,
                ...entry,
            });
            count++;
        } catch (error) {
            errors.push(`${entry.word}: ${error.message}`);
        }
    }

    return {
        count,
        success: errors.length === 0,
        errors,
        ...(errors.length ? { error: `Some words failed to add: ${errors.join('; ')}` } : {}),
        skippedDuplicateWords: options.skipDuplicateWords ? [...duplicateInputWords] : [],
    };
}

function requireTestId(testId) {
    const value = String(testId || '').trim();
    if (!value) throw new Error('TEST_ID_REQUIRED');
    return value;
}

function requireQuestions(questions) {
    if (!Array.isArray(questions) || questions.length === 0) throw new Error('QUESTIONS_REQUIRED');
    return questions;
}

async function saveQuizSessionWithClient(client, username, testId, questions, options = {}) {
    const user = await requireUserByUsername(client, username);
    const createdAt = toIsoString(options.now ? options.now() : Date.now());
    const expiresAt = toIsoString(toMillis(createdAt) + QUIZ_SESSION_TTL_MS);
    const row = {
        test_id: requireTestId(testId),
        user_id: user.id,
        questions: requireQuestions(questions),
        created_at: createdAt,
        expires_at: expiresAt,
    };
    const { data, error } = await client
        .from('quiz_sessions')
        .upsert(row, { onConflict: 'test_id' })
        .select('*')
        .single();
    ensureNoError(error, 'saveQuizSession');
    return data;
}

async function getQuizSessionWithClient(client, username, testId, options = {}) {
    const user = await getUserByUsernameWithClient(client, username);
    if (!user) return null;
    const { data, error } = await client
        .from('quiz_sessions')
        .select('*')
        .eq('test_id', requireTestId(testId))
        .eq('user_id', user.id)
        .gt('expires_at', toIsoString(options.now ? options.now() : Date.now()))
        .maybeSingle();
    ensureNoError(error, 'getQuizSession');
    if (!data) return null;
    return {
        ...data,
        questions: Array.isArray(data.questions) ? data.questions : [],
    };
}

async function deleteQuizSessionWithClient(client, username, testId) {
    const user = await getUserByUsernameWithClient(client, username);
    if (!user) return { deleted: 0 };
    const { data, error } = await client
        .from('quiz_sessions')
        .delete()
        .eq('test_id', requireTestId(testId))
        .eq('user_id', user.id)
        .select('test_id');
    ensureNoError(error, 'deleteQuizSession');
    return { deleted: (data || []).length };
}

async function cleanupExpiredQuizSessionsWithClient(client, options = {}) {
    const { data, error } = await client
        .from('quiz_sessions')
        .delete()
        .lt('expires_at', toIsoString(options.now ? options.now() : Date.now()))
        .select('test_id');
    ensureNoError(error, 'cleanupExpiredQuizSessions');
    return { deleted: (data || []).length };
}

function createSupabaseDataAdapter(client = supabase) {
    return {
        name: 'supabase',
        canonicalUsernameKey,
        getUserByUsername: username => getUserByUsernameWithClient(client, username),
        getUserLearningSettings: username => getUserLearningSettingsWithClient(client, username),
        updateUserLearningSettings: (username, requestedLevel) =>
            updateUserLearningSettingsWithClient(client, username, requestedLevel),
        getWordsForUser: (username, level) => getWordsForUserWithClient(client, username, level),
        getAssessmentsForUser: username => getAssessmentsForUserWithClient(client, username),
        getAssessmentsForTest: (username, testId) => getAssessmentsForTestWithClient(client, username, testId),
        getMasteryAssessmentsForWords: (username, sourceWordRecordIds) =>
            getMasteryAssessmentsForWordsWithClient(client, username, sourceWordRecordIds),
        getQuestionCache: (username, level, roundType) => getQuestionCacheWithClient(client, username, level, roundType),
        submitAssessment: input => submitAssessmentWithClient(client, input),
        updateWordMastery: (username, word, newMasteryStatus, options) =>
            updateWordMasteryWithClient(client, username, word, newMasteryStatus, options),
        incrementCacheUsedCount: cacheId => incrementCacheUsedCountWithClient(client, cacheId),
        getQuestionCacheStatus: username => getQuestionCacheStatusWithClient(client, username),
        getQuestionCacheDiagnostics: username => getQuestionCacheDiagnosticsWithClient(client, username),
        deleteQuestionCacheRows: (username, type) => deleteQuestionCacheRowsWithClient(client, username, type),
        rebuildQuestionCacheForUser: username => rebuildQuestionCacheForUserWithClient(client, username),
        addWord: input => addWordWithClient(client, input),
        addWords: (targetUser, words, options) => addWordsWithClient(client, targetUser, words, options),
        saveQuizSession: (username, testId, questions, options) =>
            saveQuizSessionWithClient(client, username, testId, questions, options),
        getQuizSession: (username, testId, options) =>
            getQuizSessionWithClient(client, username, testId, options),
        deleteQuizSession: (username, testId) =>
            deleteQuizSessionWithClient(client, username, testId),
        cleanupExpiredQuizSessions: options =>
            cleanupExpiredQuizSessionsWithClient(client, options),
        createReviewRound: input => createReviewRoundWithLock(client, input),
        getActiveReviewRound: input => getActiveReviewRoundWithClient(client, input),
        deferReviewRound: input => deferReviewRoundWithClient(client, input),
        getReviewSummary: input => getReviewSummaryWithClient(client, input),
        prebuildWrongQuestionCache: input => prebuildWrongQuestionCacheWithClient(client, input),
        submitReviewRound: input => submitReviewRoundWithClient(client, input),
    };
}

const defaultAdapter = createSupabaseDataAdapter(supabase);

module.exports = {
    name: 'supabase',
    canonicalUsernameKey,
    createSupabaseDataAdapter,
    getUserByUsername: defaultAdapter.getUserByUsername,
    getUserLearningSettings: defaultAdapter.getUserLearningSettings,
    updateUserLearningSettings: defaultAdapter.updateUserLearningSettings,
    getWordsForUser: defaultAdapter.getWordsForUser,
    getAssessmentsForUser: defaultAdapter.getAssessmentsForUser,
    getAssessmentsForTest: defaultAdapter.getAssessmentsForTest,
    getMasteryAssessmentsForWords: defaultAdapter.getMasteryAssessmentsForWords,
    getQuestionCache: defaultAdapter.getQuestionCache,
    submitAssessment: defaultAdapter.submitAssessment,
    updateWordMastery: defaultAdapter.updateWordMastery,
    incrementCacheUsedCount: defaultAdapter.incrementCacheUsedCount,
    getQuestionCacheStatus: defaultAdapter.getQuestionCacheStatus,
    getQuestionCacheDiagnostics: defaultAdapter.getQuestionCacheDiagnostics,
    deleteQuestionCacheRows: defaultAdapter.deleteQuestionCacheRows,
    rebuildQuestionCacheForUser: defaultAdapter.rebuildQuestionCacheForUser,
    addWord: defaultAdapter.addWord,
    addWords: defaultAdapter.addWords,
    saveQuizSession: defaultAdapter.saveQuizSession,
    getQuizSession: defaultAdapter.getQuizSession,
    deleteQuizSession: defaultAdapter.deleteQuizSession,
    cleanupExpiredQuizSessions: defaultAdapter.cleanupExpiredQuizSessions,
    createReviewRound: defaultAdapter.createReviewRound,
    getActiveReviewRound: defaultAdapter.getActiveReviewRound,
    deferReviewRound: defaultAdapter.deferReviewRound,
    getReviewSummary: defaultAdapter.getReviewSummary,
    prebuildWrongQuestionCache: defaultAdapter.prebuildWrongQuestionCache,
    submitReviewRound: defaultAdapter.submitReviewRound,
};
