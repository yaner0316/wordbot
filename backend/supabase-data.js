const path = require('path');
const https = require('https');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const supabase = require('./supabase-client');
const { isRealAssessment, getAssessmentMode, normalizeAssessmentMode } = require('./assessment-mode');
const { assertFormalQuizQuestions } = require('./formal-quiz-session');
const { isMeaningAnswerCorrect } = require('./meaning-review');
const { evaluateMeaningMastery } = require('./mastery-evidence');
const { summarizeReviewRound } = require('./review-session');
const {
    getCacheQuestionReadinessIssues,
    summarizeCacheStatus,
} = require('./question-cache');
const { getReadyPrimaryPairIssues } = require('./question-cache-pair');
const {
    generateElementaryDistractors,
    generateElementaryTemplateContext,
} = require('./elementary-context');
const { hasMeaningfulChineseMeaning, isBadQuizWord } = require('./question-quality');
const { generateSupabaseDistractors } = require('./supabase-distractors');
const { buildMiniMaxRequestBody, getMiniMaxSettings } = require('./minimax-settings');
const { buildInitialVariantMetadata } = require('./cache-lifecycle');
const { fingerprintQuestion } = require('./question-generation-service');
const { summarizeQuestionGenerationJobs } = require('./question-generation-job');
const { WORD_QUIZ_COOLDOWN_MS } = require('./quiz-cooldown');
const { countEligibleReadyMeaningsByLevel } = require('./quiz-word-queue');
const {
    toFeishuWordRecord,
    toFeishuAssessmentRecord,
    toFeishuCacheRow,
} = require('./quiz-adapter');
const { translateSupabaseContext, translateSupabaseWords } = require('./supabase-translations');
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

function normalizeQualityFlags(value) {
    if (Array.isArray(value)) return value;
    const raw = String(value || '').trim();
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.map(item => String(item || '').trim()).filter(Boolean);
    } catch {}
    return raw.split(',').map(item => item.trim()).filter(Boolean);
}

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasWholeWord(context, word) {
    const key = String(word || '').trim();
    if (!key || !/^[a-z]+(?:[ '-][a-z]+)*$/i.test(key)) return false;
    return new RegExp(`\\b${escapeRegExp(key)}\\b`, 'i').test(String(context || ''));
}

function blankWordInContext(context, word) {
    return String(context || '').replace(new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i'), '_____');
}

function normalizeQuestionStem(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
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
            cache_state: row.cache_state || 'active',
            variant_slot: Number(row.variant_slot || 1),
            available_from: row.available_from || null,
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

function defaultGameState() {
    return {
        minutes: 0,
        claimIds: [],
        garden: {
            hearts: 0,
            feed: 0,
            outfit: '草帽',
            visits: 0,
            lastAction: 'idle',
            lastGain: {},
        },
    };
}

function normalizeGameState(value = {}) {
    const fallback = defaultGameState();
    const garden = value.garden && typeof value.garden === 'object' ? value.garden : {};
    return {
        minutes: Math.max(0, Math.floor(Number(value.minutes) || 0)),
        claimIds: Array.isArray(value.claimIds) ? [...new Set(value.claimIds.map(item => String(item || '').trim()).filter(Boolean))] : [],
        garden: {
            ...fallback.garden,
            ...garden,
            hearts: Math.max(0, Number(garden.hearts) || 0),
            feed: Math.max(0, Number(garden.feed) || 0),
            visits: Math.max(0, Number(garden.visits) || 0),
        },
    };
}

async function getGameStateWithClient(client, username) {
    const user = await getUserByUsernameWithClient(client, username);
    if (!user) return defaultGameState();
    const { data, error } = await client
        .from('game_states')
        .select('game_time_minutes, reward_claim_ids, garden_state')
        .eq('user_id', user.id)
        .maybeSingle();
    ensureNoError(error, 'getGameState');
    if (!data) return defaultGameState();
    return normalizeGameState({
        minutes: data.game_time_minutes,
        claimIds: data.reward_claim_ids,
        garden: data.garden_state,
    });
}

async function saveGameStateWithClient(client, username, value) {
    const user = await requireUserByUsername(client, username);
    const state = normalizeGameState(value);
    const payload = {
        user_id: user.id,
        game_time_minutes: state.minutes,
        reward_claim_ids: state.claimIds,
        garden_state: state.garden,
        updated_at: new Date().toISOString(),
    };
    const existing = await client
        .from('game_states')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle();
    ensureNoError(existing.error, 'saveGameState.lookup');
    const query = existing.data
        ? client.from('game_states').update(payload).eq('user_id', user.id).select('user_id').single()
        : client.from('game_states').insert(payload).select('user_id').single();
    const { error } = await query;
    ensureNoError(error, 'saveGameState');
    return state;
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
    const [wordRows, assessmentRows] = await Promise.all([
        getWordsForUserWithClient(client, username),
        getAssessmentsForUserWithClient(client, username),
    ]);
    const sourceRecordIdByWordId = new Map(
        wordRows.map(row => [String(row.id || ''), String(row.feishu_record_id || row.id || '')])
    );
    const wordsById = new Map(wordRows.map(row => [String(row.id || ''), row]));
    const wordRecords = wordRows.map(row => toFeishuWordRecord(row, { username: user.username }));
    const assessmentRecords = assessmentRows.map(row => toFeishuAssessmentRecord(row, {
        username: user.username,
        sourceRecordIdByWordId,
    }));
    const cacheRecords = rows.map(row => {
        const word = wordsById.get(String(row.word_id || ''));
        return toFeishuCacheRow({
            ...row,
            word: row.word || word?.word || '',
            source_word_record_id: row.source_word_record_id || word?.feishu_record_id || word?.id || row.word_id,
        }, { username: user.username });
    });
    const now = Date.now();
    const eligibleReadyMeaningsByLevel = countEligibleReadyMeaningsByLevel({
        cacheRows: cacheRecords,
        wordRecords,
        assessmentRecords,
        userId: user.username,
        levels: LEVELS,
        now,
        minAgeMs: WORD_QUIZ_COOLDOWN_MS,
    });
    const jobRows = await fetchAllRows(
        () => client.from('question_generation_jobs').select('*').eq('user_id', user.id).order('created_at', { ascending: true }),
        'getQuestionCacheStatus.jobs'
    );
    const generation = summarizeQuestionGenerationJobs(jobRows);

    return {
        configured: true,
        ...summarizeCacheStatus(statusRows),
        eligibleReadyMeanings: Number(eligibleReadyMeaningsByLevel[normalizeLearningLevel(user.learning_level || DEFAULT_LEARNING_LEVEL)] || 0),
        eligibleReadyMeaningsByLevel,
        generation,
    };
}

async function getReadyQuestionCacheCountForLevelWithClient(client, userId, level) {
    const { data, error } = await client
        .from('question_cache')
        .select('id')
        .eq('user_id', userId)
        .eq('level', normalizeLearningLevel(level))
        .eq('quality_status', 'ready')
        .in('cache_state', ['active', 'reserved_next_day'])
        .limit(10);
    ensureNoError(error, 'getUserLearningSettings.questionCache');
    return Array.isArray(data) ? data.length : 0;
}

async function getUserLearningSettingsWithClient(client, username) {
    const user = await requireUserByUsername(client, username);
    const settings = buildLearningSettingsFromUser(user);
    const readyForLevel = await getReadyQuestionCacheCountForLevelWithClient(
        client,
        user.id,
        settings.learningLevel
    );
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
    const jobRows = await fetchAllRows(
        () => {
            let query = client.from('question_generation_jobs').select('*').order('created_at', { ascending: true });
            if (user) query = query.eq('user_id', user.id);
            return query;
        },
        'getQuestionCacheDiagnostics.jobs'
    );
    const generation = summarizeQuestionGenerationJobs(jobRows);
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
            willUseFallback: false,
        }))
        .sort((a, b) =>
            String(a.userId).localeCompare(String(b.userId)) ||
            String(a.level).localeCompare(String(b.level)) ||
            String(a.roundType).localeCompare(String(b.roundType))
        );
    return { configured: true, results, generation };
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
    const fingerprintedRows = rows.filter(row => String(row.question_fingerprint || '').trim());
    const wordsById = await getWordsByIdWithClient(client, fingerprintedRows.map((row) => row.word_id));
    return fingerprintedRows.map((row) => {
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

async function buildOptionMeanings({ optionWords, correctWord, correctMeaning, translateWords }) {
    const missingWords = optionWords.filter(option =>
        option !== correctWord || !hasMeaningfulChineseMeaning(correctMeaning)
    );
    const translated = await translateWords(missingWords);
    const meanings = optionWords.map(option =>
        option === correctWord
            ? String(translated?.[option] || correctMeaning || '').trim()
            : String(translated?.[option] || '').trim()
    );
    return meanings.every(hasMeaningfulChineseMeaning) ? meanings : null;
}
function rotateFallbackDistractors(pool, word) {
    const offset = stableWordOffset(word, pool.length);
    return [...pool.slice(offset), ...pool.slice(0, offset)];
}async function buildType3CacheQuestionRowsForWord() {
    return [];
}
function countDistractorOverlap(left, right) {
    const rightSet = new Set((right || []).map(value => String(value || '').trim().toLowerCase()));
    return (left || []).filter(value => rightSet.has(String(value || '').trim().toLowerCase())).length;
}
async function buildType1CacheRow({ user, word, level, context, distractors, slot, now, translateWords, translateContext }) {
    const wordText = String(word.word || '').trim().toLowerCase();
    const meaning = word.meaning_zh || word.meaning_en || wordText;
    const blankedContext = blankWordInContext(context, wordText);
    const approvedDistractors = uniqueWords(distractors || [], wordText).slice(0, 3);
    if (approvedDistractors.length < 3) return null;
    const optionWords = shuffled([wordText, ...approvedDistractors]);
    const letters = ['A', 'B', 'C', 'D'];
    const answer = letters[optionWords.indexOf(wordText)];
    const options = optionWords.map((option, index) => letters[index] + '. ' + option);
    const optionMeanings = await buildOptionMeanings({
        optionWords,
        correctWord: wordText,
        correctMeaning: String(meaning || wordText),
        translateWords,
    });
    if (!optionMeanings) return null;
    const contextTranslation = typeof translateContext === 'function'
        ? String(await translateContext(context).catch(() => '') || '').trim()
        : '';
    if (!contextTranslation) return null;

    const row = {
        user_id: user.id,
        word_id: word.id,
        source_word_record_id: word.feishu_record_id || word.id,
        level,
        round_type: 'primary',
        quality_status: 'ready',
        question_type: '1',
        question_text: blankedContext,
        context_zh: contextTranslation,
        suffix: null,
        options,
        answer,
        option_meanings: optionMeanings,
        correct_meaning: optionMeanings[optionWords.indexOf(wordText)] || String(meaning || ''),
        ai_audit_status: 'skipped',
        source_version: 'supabase-contextual-variant-v2',
        used_count: 0,
        generated_at: toIsoString(now),
        last_used_at: null,
        ...buildInitialVariantMetadata({ slot, now }),
    };
    row.question_fingerprint = fingerprintQuestion(row, word.id);
    return getCacheQuestionReadinessIssues(toQuestionCacheStatusRecord(row, { user, word })).length
        ? null
        : row;
}

async function buildCacheQuestionRowsForWord({ user, word, level, roundType, now = Date.now(), generateDistractors, translateWords, translateContext, generateContext }) {
    const wordText = String(word.word || '').trim().toLowerCase();
    if (!wordText || !/^[a-z]+(?:[ '-][a-z]+)*$/i.test(wordText) || isBadQuizWord(wordText)) return [];
    let cacheWord = word;
    if (!cleanChineseMeaningForCache(cacheWord) && typeof translateWords === 'function') {
        const translated = await translateWords([wordText]);
        const candidate = String(translated?.[wordText] || '').trim();
        if (hasMeaningfulChineseMeaning(candidate)) cacheWord = { ...word, meaning_zh: candidate };
    }
    const meaning = cacheWord.meaning_zh || cacheWord.meaning_en || wordText;
    let firstContext = level === ELEMENTARY_LEVEL
        ? generateElementaryTemplateContext(wordText, cacheWord.meaning_en || cacheWord.meaning_zh || '')
        : word.context_en || '';
    let generatedFirstContext = false;
    if (!hasWholeWord(firstContext, wordText) && typeof generateContext === 'function') {
        firstContext = await generateContext(wordText, meaning, level, '').catch(() => '');
        generatedFirstContext = hasWholeWord(firstContext, wordText);
    }
    if (!hasWholeWord(firstContext, wordText)) return [];
    const shouldGenerateSecondContext = typeof generateContext === 'function';
    let secondContext = firstContext;
    if (shouldGenerateSecondContext) {
        const firstContextKey = normalizeQuestionStem(firstContext);
        secondContext = '';
        for (let attempt = 0; attempt < 3 && !secondContext; attempt++) {
            const candidate = await generateContext(wordText, meaning, level, firstContext).catch(() => '');
            const candidateKey = normalizeQuestionStem(candidate);
            if (hasWholeWord(candidate, wordText) && candidateKey !== firstContextKey) secondContext = candidate;
        }
    }
    const duplicateGeneratedContext = shouldGenerateSecondContext && normalizeQuestionStem(secondContext) === normalizeQuestionStem(firstContext);
    if (!hasWholeWord(secondContext, wordText) || duplicateGeneratedContext) return [];
    if (!shouldGenerateSecondContext) return [];

    const levelReferenceDistractors = level === ELEMENTARY_LEVEL
        ? [...generateElementaryDistractors(wordText), 'apple', 'book', 'cat', 'dog', 'house', 'school']
        : [];
    const candidateDistractors = uniqueWords([
        ...levelReferenceDistractors,
        ...(cacheWord.distractors || []),
        ...(cacheWord.old_distractors || []),
    ], wordText).slice(0, 8);
    const generateForContext = async (context, excludedDistractors = []) => {
        if (typeof generateDistractors !== 'function') return null;
        const questionStem = blankWordInContext(context, wordText);
        for (let attempt = 0; attempt < 3; attempt++) {
            const generated = await generateDistractors({
                word: wordText,
                meaning,
                level,
                context: questionStem,
                candidates: candidateDistractors,
                excludedDistractors: [...excludedDistractors],
            }).catch(() => null);
            const normalized = uniqueWords(generated || [], wordText).slice(0, 3);
            if (normalized.length !== 3) continue;
            if (countDistractorOverlap(normalized, excludedDistractors) > 1) continue;
            return normalized;
        }
        return null;
    };

    const firstDistractors = await generateForContext(firstContext);
    if (!firstDistractors) return [];
    const secondDistractors = await generateForContext(secondContext, firstDistractors);
    if (!secondDistractors) return [];

    const first = await buildType1CacheRow({ user, word: cacheWord, level, context: firstContext, distractors: firstDistractors, slot: 1, now, translateWords, translateContext });
    const second = await buildType1CacheRow({ user, word: cacheWord, level, context: secondContext, distractors: secondDistractors, slot: 2, now, translateWords, translateContext });
    if (!first) return [];
    return second ? [first, second] : [];
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

const EXECUTABLE_QUESTION_GENERATION_JOB_STATUSES = new Set([
    'pending',
    'generating',
    'validating',
    'repairing',
    'retry_wait',
]);

async function isolatePrimaryCachePairForReplacementWithClient(client, userId, wordId) {
    const { error } = await client
        .from('question_cache')
        .update({
            cache_state: 'replace_pending',
            updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('word_id', wordId)
        .eq('round_type', 'primary')
        .eq('question_type', '1')
        .eq('quality_status', 'ready')
        .in('cache_state', ['active', 'reserved_next_day'])
        .select('id');
    ensureNoError(error, 'rebuildQuestionCache.isolateBadPair');
}

async function enqueueQuestionGenerationJobWithConfirmation(client, { userId, wordId, reason }) {
    const { data, error } = await client.rpc(
        'enqueue_question_generation_job_if_needed',
        {
            p_user_id: userId,
            p_word_id: wordId,
            p_reason: reason,
        },
    );
    ensureNoError(error, 'rebuildQuestionCache.enqueueJob');
    if (data === true) return;

    const { data: job, error: jobError } = await client
        .from('question_generation_jobs')
        .select('id,status')
        .eq('user_id', userId)
        .eq('word_id', wordId)
        .maybeSingle();
    ensureNoError(jobError, 'rebuildQuestionCache.confirmEnqueueJob');
    const status = String(job?.status || '').trim().toLowerCase();
    if (!job || status === 'needs_manual_review') {
        const now = new Date().toISOString();
        const { data: requeued, error: requeueError } = await client
            .from('question_generation_jobs')
            .upsert({
                user_id: userId,
                word_id: wordId,
                status: 'pending',
                reason: reason || 'cache_backfill',
                attempt_count: 0,
                next_attempt_at: now,
                lease_owner: null,
                lease_expires_at: null,
                last_error_code: null,
                last_error_detail: null,
                rejection_reasons: {},
                updated_at: now,
            }, { onConflict: 'word_id' })
            .select('id,status')
            .maybeSingle();
        ensureNoError(requeueError, 'rebuildQuestionCache.ensurePendingJob');
        if (requeued?.status === 'pending') return;
    }
    if (!job || !EXECUTABLE_QUESTION_GENERATION_JOB_STATUSES.has(status)) {
        throw new Error(`rebuildQuestionCache.enqueueJob: durable job was not confirmed for word ${wordId}`);
    }
}
async function rebuildQuestionCacheForUserWithClient(client, username, distractorGenerator = null, translator = null, contextTranslator = null, contextGenerator = null) {
    const user = await requireUserByUsername(client, username);
    const level = normalizeOptionalLearningLevel(user.learning_level) || normalizeLearningLevel(user.learning_level || DEFAULT_LEARNING_LEVEL);
    const defaultWordLevel = level;
    const words = await getWordsForUserWithClient(client, username);
    const wordsById = new Map(words.map(word => [word.id, word]));
    const assessmentRows = await getAssessmentsForUserWithClient(client, username);
    const sourceRecordIdByWordId = new Map(
        words.map(word => [String(word.id || ''), String(word.feishu_record_id || word.id || '').trim()])
    );
    const assessmentRecords = assessmentRows.map(row => toFeishuAssessmentRecord(row, {
        username: user.username,
        sourceRecordIdByWordId,
    }));
    const assessmentRecordsBySourceId = new Map();
    for (const record of assessmentRecords) {
        const sourceRecordId = String(record.fields?.record_id || '').trim();
        if (!sourceRecordId) continue;
        if (!assessmentRecordsBySourceId.has(sourceRecordId)) assessmentRecordsBySourceId.set(sourceRecordId, []);
        assessmentRecordsBySourceId.get(sourceRecordId).push(record);
    }
    const masteryByWordId = new Map(words.map(word => {
        const sourceRecordId = sourceRecordIdByWordId.get(String(word.id || ''));
        const evidence = assessmentRecordsBySourceId.get(sourceRecordId) || [];
        return [word.id, evaluateMeaningMastery(evidence, isCorrectStatsValue)];
    }));
    const isEvidenceMastered = word => Boolean(word && masteryByWordId.get(word.id)?.mastered);
    const candidateWords = words
        .filter(row => !isEvidenceMastered(row))
        .sort((left, right) => {
            const priority = { pending: 0, recognized: 1, consolidating: 2, mastered: 3 };
            const leftPriority = priority[masteryByWordId.get(left.id)?.stage] ?? 1;
            const rightPriority = priority[masteryByWordId.get(right.id)?.stage] ?? 1;
            return leftPriority - rightPriority || toMillis(left.entered_at || left.created_at) - toMillis(right.entered_at || right.created_at);
        });
    const { data: existingCacheRows, error: existingCacheError } = await client
        .from('question_cache')
        .select('*')
        .eq('user_id', user.id);
    ensureNoError(existingCacheError, 'rebuildQuestionCache.readExisting');
    const staleMasteredCacheIds = (existingCacheRows || [])
        .filter(row => isEvidenceMastered(wordsById.get(row.word_id)))
        .map(row => row.id)
        .filter(Boolean);
    if (staleMasteredCacheIds.length) {
        const { error: staleDeleteError } = await client
            .from('question_cache')
            .delete()
            .eq('user_id', user.id)
            .in('id', staleMasteredCacheIds)
            .select('id');
        ensureNoError(staleDeleteError, 'rebuildQuestionCache.deleteStaleMastered');
    }

    const staleMasteredCacheIdSet = new Set(staleMasteredCacheIds);
    const nonMasteredCacheRows = (existingCacheRows || [])
        .filter(row => !staleMasteredCacheIdSet.has(row.id));
    const existingStatusRows = await toQuestionCacheStatusRecordsWithClient(
        client,
        user,
        nonMasteredCacheRows
    );
    const badTranslationIssueCodes = new Set([
        'missing_context_translation',
        'context_translation_is_meaning',
        'context_translation_too_short',
    ]);
    const badTranslationCacheIds = existingStatusRows
        .filter(row => getCacheQuestionReadinessIssues(row)
            .some(issue => badTranslationIssueCodes.has(issue)))
        .map(row => row.record_id)
        .filter(Boolean);

    const rawCacheRowByStatusRecordId = new Map(nonMasteredCacheRows.map(row => [
        String(row.feishu_record_id || row.id || '').trim(),
        row,
    ]));
    const badTranslationCacheIdSet = new Set(badTranslationCacheIds);
    const readyPrimaryRowsBySourceId = new Map();
    for (const statusRow of existingStatusRows) {
        if (badTranslationCacheIdSet.has(statusRow.record_id)) continue;
        if (getCacheQuestionReadinessIssues(statusRow).length) continue;
        const fields = statusRow.fields || {};
        if (fields.round_type !== 'primary' || String(fields.question_type) !== '1') continue;
        // A complete pair generated for a previous learning level is stale
        // for formal use and must be rebuilt at the user's current level.
        if (normalizeOptionalLearningLevel(fields.level) !== defaultWordLevel) continue;
        const sourceId = String(fields.word_record_id || '').trim();
        if (!sourceId) continue;
        const rawRow = rawCacheRowByStatusRecordId.get(String(statusRow.record_id || '').trim());
        if (!rawRow) continue;
        if (!readyPrimaryRowsBySourceId.has(sourceId)) readyPrimaryRowsBySourceId.set(sourceId, []);
        readyPrimaryRowsBySourceId.get(sourceId).push(rawRow);
    }
    {
        const sourceByWordId = new Map(candidateWords.map(word => [String(word.id || ''), String(word.feishu_record_id || word.id || '').trim()]));
        const assessmentState = new Map();
        for (const assessment of assessmentRows) {
            const testId = String(assessment.test_id || '');
            if (!testId.startsWith('real-') && testId !== 'real') continue;
            if (!isSubmittedAssessmentRow(assessment)) continue;
            const sourceId = String(assessment.source_word_record_id || sourceByWordId.get(String(assessment.word_id || '')) || '').trim();
            if (!sourceId) continue;
            const state = assessmentState.get(sourceId) || { hasBeforeToday: false, hasToday: false };
            if (learningDay(assessment.assessed_at || assessment.created_at) === learningDay(Date.now())) state.hasToday = true;
            else state.hasBeforeToday = true;
            assessmentState.set(sourceId, state);
        }
        const rebuildPriority = word => {
            const sourceId = String(word.feishu_record_id || word.id || '').trim();
            const state = assessmentState.get(sourceId);
            if (state?.hasBeforeToday && !state.hasToday) return 0;
            if (!state || (!state.hasBeforeToday && !state.hasToday)) return 1;
            return 2;
        };
        candidateWords.sort((left, right) => rebuildPriority(left) - rebuildPriority(right));
    }
    const wordsNeedingRebuild = candidateWords.filter(word =>
        getReadyPrimaryPairIssues(
            readyPrimaryRowsBySourceId.get(String(word.feishu_record_id || word.id || '').trim()) || []
        ).length > 0
    );

    const rows = [];
    const seededPrimaryWordIds = new Set();
    const generateDistractors = async input => {
        try {
            return await distractorGenerator(input);
        } catch (error) {
            return null;
        }
    };
    const translationCache = new Map();
    const translateWords = async words => {
        const uniqueWords = [...new Set((words || []).map(word => String(word || '').trim().toLowerCase()).filter(Boolean))];
        const missingWords = uniqueWords.filter(word => !translationCache.has(word));
        if (missingWords.length) {
            try {
                const translated = await translator(missingWords);
                for (const word of missingWords) {
                    const meaning = String(translated?.[word] || '').trim();
                    if (meaning) translationCache.set(word, meaning);
                }
            } catch (error) {
                // Keep failed translations uncached so a later row can retry.
            }
        }
        return Object.fromEntries(uniqueWords.map(word => [word, translationCache.get(word) || '']));
    };
    const translationWords = [...new Set(wordsNeedingRebuild.flatMap(word => [
        ...(word.distractors || []),
        ...(word.old_distractors || []),
    ]).map(word => String(word || "").trim().toLowerCase()).filter(Boolean))];
    for (let index = 0; index < translationWords.length; index += 40) {
        await translateWords(translationWords.slice(index, index + 40));
    }
    for (const word of wordsNeedingRebuild) {
        // Formal question quality follows the child's current learning level;
        // a word's historical import level must never gate formal selection.
        const wordLevel = defaultWordLevel;
        const wordId = String(word.id || '').trim();
        const hasSelectablePrimaryRows = nonMasteredCacheRows.some(row =>
            String(row.word_id || '').trim() === wordId
            && row.round_type === 'primary'
            && String(row.question_type) === '1'
            && row.quality_status === 'ready'
            && ['active', 'reserved_next_day'].includes(row.cache_state)
        );
        if (hasSelectablePrimaryRows) {
            await isolatePrimaryCachePairForReplacementWithClient(client, user.id, word.id);
        }
        const wordRows = await buildCacheQuestionRowsForWord({ user, word, level: wordLevel, generateDistractors, translateWords, translateContext: contextTranslator, generateContext: contextGenerator });
        const primaryRows = wordRows.filter(row => row.round_type === 'primary' && row.quality_status === 'ready');
        if (!primaryRows.length) {
            await enqueueQuestionGenerationJobWithConfirmation(client, {
                userId: user.id,
                wordId: word.id,
                reason: 'cache_backfill',
            });
            continue;
        }
        const primaryWordId = String(primaryRows[0].source_word_record_id || primaryRows[0].word_id || '').trim();
        if (!primaryWordId || seededPrimaryWordIds.has(primaryWordId)) continue;
        seededPrimaryWordIds.add(primaryWordId);
        rows.push(...wordRows);
    }

    const wordIdForRow = row => String(row?.word_id || '').trim();
    const fingerprintForRow = row => String(row?.question_fingerprint || '').trim();
    const cacheIdentity = row => `${wordIdForRow(row)}|${fingerprintForRow(row)}`;
    const requestedRowCountsByWordId = new Map();
    const requestedFingerprints = new Set();
    const existingRowsByIdentity = new Map(nonMasteredCacheRows
        .filter(row => wordIdForRow(row) && fingerprintForRow(row))
        .map(row => [cacheIdentity(row), row]));
    for (const row of rows) {
        const wordId = wordIdForRow(row);
        const fingerprint = fingerprintForRow(row);
        if (!wordId || !fingerprint) {
            throw new Error('rebuildQuestionCache.upsert: generated row is missing its word id or fingerprint');
        }
        requestedRowCountsByWordId.set(wordId, (requestedRowCountsByWordId.get(wordId) || 0) + 1);
        requestedFingerprints.add(cacheIdentity(row));
        const existing = existingRowsByIdentity.get(cacheIdentity(row));
        if (existing) {
            row.used_count = Math.max(0, Number(existing.used_count) || 0);
            row.last_used_at = existing.last_used_at || row.last_used_at || null;
        }
    }

    let publishedRows = [];
    if (rows.length) {
        const rebuiltWordIds = new Set(requestedRowCountsByWordId.keys());
        const retiredAt = new Date().toISOString();
        const retirementRowsByIdentity = new Map();
        for (const row of nonMasteredCacheRows) {
            const wordId = wordIdForRow(row);
            const fingerprint = fingerprintForRow(row);
            if (row.round_type !== 'primary'
                || !rebuiltWordIds.has(wordId)
                || !fingerprint
                || requestedFingerprints.has(cacheIdentity(row))) continue;
            retirementRowsByIdentity.set(cacheIdentity(row), {
                ...row,
                cache_state: 'retired',
                updated_at: retiredAt,
            });
        }
        const writeRows = [...rows, ...retirementRowsByIdentity.values()];
        const { data, error: upsertError } = await client
            .from('question_cache')
            .upsert(writeRows, { onConflict: 'user_id,word_id,question_fingerprint', defaultToNull: false })
            .select('*');
        ensureNoError(upsertError, 'rebuildQuestionCache.upsert');
        publishedRows = (data || []).filter(row => requestedFingerprints.has(cacheIdentity(row)));

        const publishedRowCountsByWordId = new Map();
        for (const row of publishedRows) {
            const wordId = wordIdForRow(row);
            if (!row?.id || !wordId) {
                throw new Error('rebuildQuestionCache.upsert: published row is missing its id or word id');
            }
            publishedRowCountsByWordId.set(wordId, (publishedRowCountsByWordId.get(wordId) || 0) + 1);
        }
        for (const [wordId, requestedCount] of requestedRowCountsByWordId) {
            if (publishedRowCountsByWordId.get(wordId) !== requestedCount) {
                throw new Error('rebuildQuestionCache.upsert: published rows did not cover every generated pair');
            }
        }
    }
    const statusRows = await toQuestionCacheStatusRecordsWithClient(client, user, publishedRows);
    return {
        configured: true,
        level,
        count: publishedRows.length,
        status: summarizeCacheStatus(statusRows),
    };
}

async function resolveWordRows(client, userId, word, options = {}) {
    const sourceWordRecordId = String(options.recordId || options.sourceWordRecordId || options.wordRecordId || '').trim();
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
    if (options.wordId || sourceWordRecordId) {
        throw new Error(`WORD_NOT_FOUND: ${sourceWordRecordId || options.wordId}`);
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

function buildAssessmentRow(input, user, wordRow) {
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
    return row;
}

async function submitAssessmentWithClient(client, input) {
    const user = await requireUserByUsername(client, input.username);
    const [wordRow] = await resolveWordRows(client, user.id, input.word, input);
    const row = buildAssessmentRow(input, user, wordRow);
    const { data, error } = await client
        .from('assessments')
        .insert(row)
        .select('*')
        .single();
    ensureNoError(error, 'submitAssessment');
    return data;
}

async function submitAssessmentsWithClient(client, inputs = []) {
    if (!Array.isArray(inputs) || !inputs.length) return [];
    const username = inputs[0]?.username;
    const user = await requireUserByUsername(client, username);
    if (inputs.some(input => requireUsername(input.username) !== requireUsername(username))) {
        throw new Error('BATCH_USERNAME_MISMATCH');
    }
    const resolved = await Promise.all(inputs.map(async input => {
        const [wordRow] = await resolveWordRows(client, user.id, input.word, input);
        return buildAssessmentRow(input, user, wordRow);
    }));
    const { data, error } = await client
        .from('assessments')
        .insert(resolved)
        .select('*');
    ensureNoError(error, 'submitAssessments');
    return data || [];
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
            source: ['question_cache', 'live_fallback'].includes(row.source) ? row.source : 'question_cache',
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

async function generateReplacementContextWithAI(word, meaning, level, previousContext) {
    const apiKey = process.env.MINIMAX_API_KEY;
    if (!apiKey || typeof fetch !== 'function') return '';
    const prior = String(previousContext || '').trim();
    const prompt = [
        `Write one natural English sentence of 8 to 16 words for level "${String(level || '').trim()}".`,
        `Use "${String(word || '').trim().toLowerCase()}" exactly once with meaning "${String(meaning || '').trim()}".`,
        prior ? `Do not copy this sentence: "${prior}"` : '',
        'Return only JSON with one context key.',
    ].filter(Boolean).join('\n');
    const settings = getMiniMaxSettings();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
    try {
        const response = await fetch('https://api.minimax.chat/v1/text/chatcompletion_v2', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
            body: JSON.stringify(buildMiniMaxRequestBody(prompt)),
            signal: controller.signal,
        });
        if (!response.ok) return '';
        const payload = await response.json();
        const content = payload?.choices?.[0]?.message?.content || '';
        const match = String(content).match(/"context"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        const context = match ? match[1].replace(/\\"/g, '"').replace(/\\n/g, ' ').trim() : '';
        const target = String(word || '').trim().toLowerCase();
        const count = (context.toLowerCase().match(new RegExp('\\b' + target + '\\b', 'g')) || []).length;
        if (!context || count !== 1 || context.toLowerCase() === prior.toLowerCase()) return '';
        return context;
    } catch {
        return '';
    } finally {
        clearTimeout(timer);
    }
}

async function prebuildWrongQuestionCacheWithClient(client, { userId, testId, result } = {}, distractorGenerator, translator, contextTranslator, contextGenerator) {
    const buildContext = typeof contextGenerator === 'function' ? contextGenerator : generateReplacementContextWithAI;
    const buildDistractors = typeof distractorGenerator === 'function' ? distractorGenerator : generateSupabaseDistractors;
    const translateOptions = typeof translator === 'function' ? translator : translateSupabaseWords;
    const translateSentence = typeof contextTranslator === 'function' ? contextTranslator : translateSupabaseContext;
    if (!userId || !testId || !Array.isArray(result?.results)) return { prepared: 0, skipped: true, source: 'supabase' };
    const usedRecordIds = new Set(result.results.filter(item => item?.correct === false).map(item => String(item?.recordId || '').trim()).filter(Boolean));
    if (!usedRecordIds.size) return { prepared: 0, skipped: true, source: 'supabase' };
    const rows = (await getAssessmentsForTestWithClient(client, userId, testId))
        .filter(row => row.is_real_assessment !== false && row.assessment_kind !== 'review')
        .filter(row => usedRecordIds.has(String(row.source_word_record_id || '').trim()))
        .filter(isSubmittedAssessmentRow)
        .filter(row => String(row.question_text || '').trim());
    const user = await requireUserByUsername(client, userId);
    const preparedRows = [];
    const replacementPairs = [];
    for (const assessment of rows) {
        const word = await getWordInfoForReview(client, user.id, assessment);
        const level = normalizeOptionalLearningLevel(assessment.level || word.level);
        let context = '';
        for (let attempt = 0; attempt < 2 && !context; attempt++) {
            context = await buildContext(word.word, word.meaning_zh || word.meaning_en, level, assessment.question_text).catch(() => '');
        }
        if (!context) continue;
        const replacementWord = { ...word, context_en: context, context_zh: null };
        const candidates = await buildCacheQuestionRowsForWord({
            user, word: replacementWord, level, roundType: 'primary',
            generateDistractors: input => buildDistractors(input),
            translateWords: words => translateOptions(words),
            generateContext: buildContext,
            translateContext: sentence => translateSentence(sentence),
        });
        const primary = candidates.find(row => row.round_type === 'primary' && String(row.question_text || '').trim().toLowerCase() !== String(assessment.question_text || '').trim().toLowerCase());
        if (primary) {
            preparedRows.push({ ...primary, source_version: 'supabase-wrong-recovery-v1', generated_at: toIsoString(Date.now()) });
            replacementPairs.push({ assessment, primary });
        }
    }
    if (preparedRows.length) {
        const { data: insertedRows, error: insertError } = await client.from('question_cache').insert(preparedRows).select('id');
        ensureNoError(insertError, 'prebuildWrongQuestionCache.insert');
        for (const { assessment } of replacementPairs) {
            const { error: retireError } = await client.from('question_cache')
                .delete()
                .eq('user_id', user.id)
                .eq('source_word_record_id', assessment.source_word_record_id)
                .eq('round_type', 'primary')
                .eq('question_text', assessment.question_text)
                .select('id');
            ensureNoError(retireError, 'prebuildWrongQuestionCache.retireOld');
        }
    }
    return { prepared: preparedRows.length, skipped: false, source: 'supabase' };
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

async function applyQuizCacheLifecycleWithClient(client, { userId, questions = [], results = [] } = {}) {
    const user = await requireUserByUsername(client, userId);
    for (let index = 0; index < Math.min(questions.length, results.length); index++) {
        const question = questions[index];
        const result = results[index];
        const cacheId = question?.cacheRecordId;
        if (!cacheId) continue;
        const current = await resolveCacheRow(client, cacheId);
        if (String(result?.correct) !== 'true') continue;
        const { data: reserved, error: reservedError } = await client
            .from('question_cache')
            .select('*')
            .eq('user_id', user.id)
            .eq('word_id', current.word_id)
            .eq('round_type', 'primary')
            .eq('cache_state', 'reserved_next_day')
            .lte('available_from', new Date().toISOString())
            .order('available_from', { ascending: true })
            .limit(1)
            .maybeSingle();
        ensureNoError(reservedError, 'applyQuizCacheLifecycle.findReserved');
        if (!reserved) continue;
        const { error: promoteError } = await client
            .from('question_cache')
            .update({ cache_state: 'active', available_from: null })
            .eq('id', reserved.id);
        ensureNoError(promoteError, 'applyQuizCacheLifecycle.promoteReserved');
        const { error: retireError } = await client
            .from('question_cache')
            .update({ cache_state: 'retired' })
            .eq('id', current.id);
        ensureNoError(retireError, 'applyQuizCacheLifecycle.retireCurrent');
    }
    return { updated: true };
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
        await fenceWordQuestionGeneration(client, user.id, row.id);
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
        await finalizeWordQuestionGenerationEdit(client, user.id, row.id);
        updated.push(data);
    }
    return updated;
}

async function fenceWordQuestionGeneration(client, userId, wordId) {
    const { data, error } = await client.rpc('fence_word_question_generation', {
        p_user_id: userId,
        p_word_id: wordId,
    });
    ensureNoError(error, 'updateWord.fenceQuestionGeneration');
    if (data === null || data === undefined) throw new Error('updateWord.fenceQuestionGeneration: word was not fenced');
    return data;
}

async function finalizeWordQuestionGenerationEdit(client, userId, wordId) {
    const { error } = await client.rpc('finalize_word_question_generation_edit', {
        p_user_id: userId,
        p_word_id: wordId,
    });
    ensureNoError(error, 'updateWord.finalizeQuestionGeneration');
}

async function updateWordWithClient(client, username, word, fields = {}) {
    const user = await requireUserByUsername(client, username);
    const has = key => Object.prototype.hasOwnProperty.call(fields, key) && fields[key] !== undefined;
    const editable = ['word', 'meaning', 'cnMeaning', 'pos', 'context', 'distractors', 'status', 'qualityFlags', 'qualityNote'];
    const qualityOrPosChanged = ['word', 'meaning', 'cnMeaning', 'pos', 'context', 'distractors', 'qualityFlags', 'qualityNote'].some(has);
    if (!editable.some(has)) throw new Error('WORD_UPDATE_FIELDS_REQUIRED');
    const [row] = await resolveWordRows(client, user.id, word, fields);
    const questionGenerationChanged = qualityOrPosChanged || (has('status')
        && (row.mastery_status === 'mastered' || normalizeMasteryStatus(fields.status) === 'mastered'));
    if (questionGenerationChanged) await fenceWordQuestionGeneration(client, user.id, row.id);

    const payload = { updated_at: new Date().toISOString() };
    if (has('word')) payload.word = fields.word;
    if (has('meaning')) payload.meaning_en = fields.meaning;
    if (has('cnMeaning')) payload.meaning_zh = fields.cnMeaning;
    if (has('context')) payload.context_en = fields.context;
    if (has('distractors')) payload.distractors = fields.distractors;
    if (has('status')) payload.mastery_status = normalizeMasteryStatus(fields.status);
    if (has('qualityFlags')) payload.quality_flags = normalizeQualityFlags(fields.qualityFlags);
    if (has('qualityNote')) payload.quality_note = fields.qualityNote;
    const { data, error } = await client
        .from('words')
        .update(payload)
        .eq('id', row.id)
        .eq('user_id', user.id)
        .select('*')
        .single();
    ensureNoError(error, 'updateWord.words');
    if (!data) throw new Error(`WORD_NOT_FOUND: ${row.id}`);

    if (has('pos')) {
        const parts = normalizePartsOfSpeech(fields.pos);
        const { error: deleteError } = await client
            .from('word_parts_of_speech')
            .delete()
            .eq('word_id', row.id)
            .select('*');
        ensureNoError(deleteError, 'updateWord.partsOfSpeech.delete');
        if (parts.length) {
            const partRows = await ensurePartOfSpeechRows(client, parts);
            const { error: insertError } = await client
                .from('word_parts_of_speech')
                .insert(parts.map((part, index) => ({
                    word_id: row.id,
                    part_of_speech_id: partRows.get(part).id,
                    position: index + 1,
                })));
            ensureNoError(insertError, 'updateWord.partsOfSpeech.insert');
        }
    }
    if (questionGenerationChanged) await finalizeWordQuestionGenerationEdit(client, user.id, row.id);
    return { success: true };
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
    const generationJob = {
        user_id: user.id,
        word_id: data.id,
        status: 'pending',
        reason: 'word_entry',
        attempt_count: 0,
        next_attempt_at: row.entered_at,
    };
    const { error: generationJobError } = await client
        .from('question_generation_jobs')
        .upsert(generationJob, { onConflict: 'word_id' });
    ensureNoError(generationJobError, 'addWord.questionGenerationJob');

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

function assertFormalQuizSessionQuestions(testId, questions) {
    if (!isRealAssessment(testId)) return;
    assertFormalQuizQuestions(questions);
}

function normalizeFormalChallengeQuestion(question) {
    const meaningId = String(question?.meaningId || question?.meaning_id || '').trim();
    const cacheQuestionId = String(question?.cacheRecordId || question?.cache_question_id || '').trim();
    const stem = String(question?.context || question?.stem || question?.question_text || '').trim();
    if (!meaningId || !cacheQuestionId || !stem) throw new Error('FORMAL_CHALLENGE_QUESTION_CANONICAL_IDS_REQUIRED');
    return {
        meaning_id: meaningId,
        cache_question_id: cacheQuestionId,
        stem,
        question_fingerprint: String(question?.questionFingerprint || question?.question_fingerprint || '').trim() || null,
        question_snapshot: question,
    };
}

async function createFormalQuizChallengeWithClient(client, options = {}) {
    const username = String(options.username || '').trim();
    const user = await getUserByUsernameWithClient(client, username);
    if (!user) throw new Error(`USER_NOT_FOUND: ${username}`);
    const testId = requireTestId(options.testId);
    const questions = options.questions;
    if (!Array.isArray(questions) || questions.length !== 10) throw new Error('FORMAL_QUIZ_INCOMPLETE');
    const payload = {
        p_user_id: user.id,
        p_test_id: testId,
        p_level: String(options.level || '').trim(),
        p_questions: questions.map(normalizeFormalChallengeQuestion),
    };
    if (options.now !== undefined && options.now !== null) payload.p_now = options.now;
    const { data, error } = await client.rpc('create_formal_quiz_challenge', payload);
    ensureNoError(error, 'createFormalQuizChallenge');
    return data;
}


function normalizeFormalChallengeProgress(progress) {
    return {
        currentQuestion: Math.max(0, Number(progress?.currentQuestion) || 0),
        answers: Array.isArray(progress?.answers) ? progress.answers : [],
    };
}

async function getFormalQuizChallengeWithClient(client, username, testId) {
    const user = await getUserByUsernameWithClient(client, username);
    if (!user) return null;
    const normalizedTestId = requireTestId(testId);
    const { data: challenge, error: challengeError } = await client
        .from('quiz_challenges')
        .select('*')
        .eq('test_id', normalizedTestId)
        .eq('user_id', user.id)
        .maybeSingle();
    ensureNoError(challengeError, 'getFormalQuizChallenge');
    if (!challenge) return null;
    const { data: questionRows, error: questionError } = await client
        .from('quiz_challenge_questions')
        .select('*')
        .eq('challenge_id', challenge.id)
        .order('ordinal', { ascending: true });
    ensureNoError(questionError, 'getFormalQuizChallenge.questions');
    return {
        ...challenge,
        challenge_id: challenge.id,
        progress: normalizeFormalChallengeProgress(challenge.session_state),
        questions: (questionRows || []).map(row => ({
            ...(row.question_snapshot && typeof row.question_snapshot === 'object' ? row.question_snapshot : {}),
            id: row.id,
            ordinal: row.ordinal,
            meaningId: row.meaning_id,
            cacheRecordId: row.cache_question_id,
            stem: row.stem,
        })),
    };
}

async function updateFormalQuizChallengeProgressWithClient(client, username, testId, progress) {
    const user = await getUserByUsernameWithClient(client, username);
    if (!user) return null;
    const state = normalizeFormalChallengeProgress(progress);
    const { data, error } = await client
        .from('quiz_challenges')
        .update({ session_state: state })
        .eq('test_id', requireTestId(testId))
        .eq('user_id', user.id)
        .eq('status', 'active')
        .select('*')
        .maybeSingle();
    ensureNoError(error, 'updateFormalQuizChallengeProgress');
    return data ? { ...data, progress: normalizeFormalChallengeProgress(data.session_state) } : null;
}

async function invalidateFormalQuizQuestionWithClient(client, options = {}) {
    const username = String(options.username || '').trim();
    const user = await getUserByUsernameWithClient(client, username);
    if (!user) return null;
    const testId = requireTestId(options.testId);
    const challengeQuestionId = String(options.challengeQuestionId || options.challenge_question_id || '').trim();
    if (!challengeQuestionId) throw new Error('FORMAL_CHALLENGE_QUESTION_ID_REQUIRED');
    const reason = String(options.reason || '').trim();
    if (!reason) throw new Error('FORMAL_CHALLENGE_INVALID_REASON_REQUIRED');
    const { data, error } = await client.rpc('invalidate_formal_quiz_question', {
        p_user_id: user.id,
        p_test_id: testId,
        p_challenge_question_id: challengeQuestionId,
        p_reason: reason,
    });
    ensureNoError(error, 'invalidateFormalQuizQuestion');
    return data;
}

async function replaceFormalQuizQuestionWithClient(client, options = {}) {
    const username = String(options.username || '').trim();
    const user = await getUserByUsernameWithClient(client, username);
    if (!user) return null;
    const testId = requireTestId(options.testId);
    const challengeQuestionId = String(options.challengeQuestionId || options.challenge_question_id || '').trim();
    const cacheQuestionId = String(options.cacheQuestionId || options.cache_question_id || '').trim();
    const stem = String(options.stem || '').trim();
    const questionSnapshot = options.questionSnapshot || options.question_snapshot;
    if (!challengeQuestionId || !cacheQuestionId) throw new Error('FORMAL_REPLACEMENT_ID_REQUIRED');
    if (!stem || !questionSnapshot || typeof questionSnapshot !== 'object' || Array.isArray(questionSnapshot)) {
        throw new Error('FORMAL_REPLACEMENT_QUESTION_INVALID');
    }
    const args = {
        p_user_id: user.id,
        p_test_id: testId,
        p_challenge_question_id: challengeQuestionId,
        p_cache_question_id: cacheQuestionId,
        p_stem: stem,
        p_question_fingerprint: String(options.questionFingerprint || options.question_fingerprint || '').trim() || null,
        p_question_snapshot: questionSnapshot,
    };
    if (options.now !== undefined && options.now !== null) args.p_now = options.now;
    const { data, error } = await client.rpc('replace_formal_quiz_question', args);
    ensureNoError(error, 'replaceFormalQuizQuestion');
    return data;
}
async function getActiveFormalQuizChallengeWithClient(client, username, options = {}) {
    const user = await getUserByUsernameWithClient(client, username);
    if (!user) return null;
    const { data, error } = await client
        .from('quiz_challenges')
        .select('test_id')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .gt('expires_at', toIsoString(options.now ? options.now() : Date.now()))
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    ensureNoError(error, 'getActiveFormalQuizChallenge');
    return data ? getFormalQuizChallengeWithClient(client, username, data.test_id) : null;
}

async function saveQuizSessionWithClient(client, username, testId, questions, options = {}) {
    const user = await requireUserByUsername(client, username);
    const normalizedTestId = requireTestId(testId);
    const sessionQuestions = requireQuestions(questions);
    assertFormalQuizSessionQuestions(normalizedTestId, sessionQuestions);
    const createdAt = toIsoString(options.now ? options.now() : Date.now());
    const expiresAt = toIsoString(toMillis(createdAt) + QUIZ_SESSION_TTL_MS);
    const row = {
        test_id: normalizedTestId,
        user_id: user.id,
        questions: sessionQuestions,
        created_at: createdAt,
        expires_at: expiresAt,
        session_state: options.progress || { currentQuestion: 0, answers: [] },
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

async function getActiveQuizSessionWithClient(client, username, mode = 'real', options = {}) {
    if (mode && typeof mode === 'object') {
        options = mode;
        mode = 'real';
    }
    const normalizedMode = normalizeAssessmentMode(mode || 'real');
    const user = await getUserByUsernameWithClient(client, username);
    if (!user) return null;
    let query = client
        .from('quiz_sessions')
        .select('*')
        .eq('user_id', user.id)
        .gt('expires_at', toIsoString(options.now ? options.now() : Date.now()));

    query = normalizedMode === 'test'
        ? query.like('test_id', 'test-%')
        : query.not('test_id', 'like', 'test-%');

    const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    ensureNoError(error, 'getActiveQuizSession');
    const activeSession = data;
    if (!activeSession) return null;
    return {
        ...activeSession,
        questions: Array.isArray(activeSession.questions) ? activeSession.questions : [],
        progress: activeSession.session_state && typeof activeSession.session_state === 'object'
            ? activeSession.session_state
            : { currentQuestion: 0, answers: [] },
    };
}

async function updateQuizSessionProgressWithClient(client, username, testId, progress) {
    const user = await getUserByUsernameWithClient(client, username);
    if (!user) return null;
    const normalizedTestId = requireTestId(testId);
    if (isRealAssessment(normalizedTestId)) {
        const { data: session, error: sessionError } = await client
            .from('quiz_sessions')
            .select('questions')
            .eq('test_id', normalizedTestId)
            .eq('user_id', user.id)
            .maybeSingle();
        ensureNoError(sessionError, 'updateQuizSessionProgress.getSession');
        if (session) {
            assertFormalQuizSessionQuestions(
                normalizedTestId,
                Array.isArray(session.questions) ? session.questions : []
            );
        }
    }
    const state = {
        currentQuestion: Math.max(0, Number(progress?.currentQuestion) || 0),
        answers: Array.isArray(progress?.answers) ? progress.answers : [],
    };
    const { data, error } = await client
        .from('quiz_sessions')
        .update({ session_state: state })
        .eq('test_id', normalizedTestId)
        .eq('user_id', user.id)
        .select('*')
        .maybeSingle();
    ensureNoError(error, 'updateQuizSessionProgress');
    return data;
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


function statsAssessmentRow(row) {
    return {
        fields: {
            record_id: row.feishu_record_id || row.id,
            test_id: row.test_id,
            test_time: toMillis(row.assessed_at),
            question_type: row.question_type,
            is_correct: row.is_correct,
            your_answer: row.submitted_answer,
        },
    };
}

function isCorrectStatsValue(value) {
    return String(value || '').trim().toLowerCase() === 'correct';
}

function summarizeSupabaseWordProgress(words, assessments) {
    const groups = new Map();
    for (const word of words || []) {
        const key = String(word.word || '').trim().toLowerCase();
        if (!key) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(word);
    }

    const counts = { mastered: 0, consolidating: 0, recognized: 0, unseen: 0 };
    for (const meaningRows of groups.values()) {
        const evaluations = meaningRows.map(word => {
            const evidence = (assessments || [])
                .filter(assessment => assessment.word_id === word.id
                    || (word.feishu_record_id && assessment.source_word_record_id === word.feishu_record_id))
                .filter(assessment => assessment.is_correct !== null && assessment.is_correct !== undefined)
                .map(statsAssessmentRow);
            return evaluateMeaningMastery(evidence, isCorrectStatsValue);
        });
        const stage = evaluations.every(item => item.mastered)
            ? 'mastered'
            : evaluations.some(item => item.stage === 'consolidating')
                ? 'consolidating'
                : evaluations.some(item => item.stage === 'recognized')
                    ? 'recognized'
                    : 'unseen';
        counts[stage]++;
    }

    const totalWords = groups.size;
    return {
        totalWords,
        totalMeanings: (words || []).length,
        masteredWords: counts.mastered,
        consolidatingWords: counts.consolidating,
        recognizedWords: counts.recognized,
        unseenWords: counts.unseen,
        pendingWords: totalWords - counts.mastered,
        masteryStageCounts: counts,
    };
}

async function getStatsWithClient(client, username) {
    const user = await getUserByUsernameWithClient(client, username);
    if (!user) {
        return {
            user: username,
            totalWords: 0,
            totalMeanings: 0,
            masteredWords: 0,
            recognizedWords: 0,
            consolidatingWords: 0,
            unseenWords: 0,
            pendingWords: 0,
            masteryStageCounts: { mastered: 0, consolidating: 0, recognized: 0, unseen: 0 },
            totalTests: 0,
            totalQuestions: 0,
            correctCount: 0,
            accuracyRate: '0.0%',
            lastTestTime: null,
        };
    }

    const [words, assessments] = await Promise.all([
        getWordsForUserWithClient(client, user.username),
        getAssessmentsForUserWithClient(client, user.username),
    ]);
    const submitted = assessments.filter(row => row.is_correct !== null && row.is_correct !== undefined);
    const realRecords = submitted.filter(row => isRealAssessment(row.test_id));
    const quizRecords = realRecords.filter(row => row.assessment_kind !== 'review' && !String(row.test_id || '').match(/^(real|test)-review-/));
    const testIds = new Set(quizRecords.map(row => String(row.test_id || '').trim()).filter(Boolean));
    const correctCount = quizRecords.filter(row => isCorrectStatsValue(row.is_correct)).length;
    const totalQuestions = quizRecords.length;
    const lastTestTime = quizRecords.reduce((max, row) => Math.max(max, toMillis(row.assessed_at)), 0);
    const accuracy = totalQuestions ? (correctCount / totalQuestions) * 100 : 0;
    return {
        user: user.username,
        ...summarizeSupabaseWordProgress(words, realRecords),
        totalTests: testIds.size,
        totalQuestions,
        correctCount,
        accuracyRate: accuracy.toFixed(1) + '%',
        lastTestTime: lastTestTime || null,
    };
}

async function getAllStatsWithClient(client) {
    const users = await fetchAllRows(() => client.from('users').select('username, username_key').order('username_key', { ascending: true }), 'getAllStats.users');
    return Promise.all(users.map(user => getStatsWithClient(client, user.username)));
}

function createSupabaseDataAdapter(client = supabase, { generateDistractors = null, translateWords = null, translateContext = null, generateContext = null } = {}) {
    const distractorGenerator = generateDistractors || (async () => null);
    const contextTranslator = translateContext || translateSupabaseContext;
    const translator = translateWords || (async () => ({}));
    return {
        name: 'supabase',
        canonicalUsernameKey,
        getUserByUsername: username => getUserByUsernameWithClient(client, username),
        getStats: username => getStatsWithClient(client, username),
        getAllStats: () => getAllStatsWithClient(client),
        getUserLearningSettings: username => getUserLearningSettingsWithClient(client, username),
        updateUserLearningSettings: (username, requestedLevel) =>
            updateUserLearningSettingsWithClient(client, username, requestedLevel),
        getWordsForUser: (username, level) => getWordsForUserWithClient(client, username, level),
        getAssessmentsForUser: username => getAssessmentsForUserWithClient(client, username),
        getAssessmentsForTest: (username, testId) => getAssessmentsForTestWithClient(client, username, testId),
        getMasteryAssessmentsForWords: (username, sourceWordRecordIds) =>
            getMasteryAssessmentsForWordsWithClient(client, username, sourceWordRecordIds),
        getQuestionCache: (username, level, roundType) => getQuestionCacheWithClient(client, username, level, roundType),
        translateWords: words => translator(words),
        submitAssessment: input => submitAssessmentWithClient(client, input),
        submitAssessments: inputs => submitAssessmentsWithClient(client, inputs),
        updateWordMastery: (username, word, newMasteryStatus, options) =>
            updateWordMasteryWithClient(client, username, word, newMasteryStatus, options),
        incrementCacheUsedCount: cacheId => incrementCacheUsedCountWithClient(client, cacheId),
        applyQuizCacheLifecycle: input => applyQuizCacheLifecycleWithClient(client, input),
        getQuestionCacheStatus: username => getQuestionCacheStatusWithClient(client, username),
        getGameState: username => getGameStateWithClient(client, username),
        updateWord: (username, word, fields) => updateWordWithClient(client, username, word, fields),
        saveGameState: (username, value) => saveGameStateWithClient(client, username, value),
        getQuestionCacheDiagnostics: username => getQuestionCacheDiagnosticsWithClient(client, username),
        deleteQuestionCacheRows: (username, type) => deleteQuestionCacheRowsWithClient(client, username, type),
        rebuildQuestionCacheForUser: username => rebuildQuestionCacheForUserWithClient(client, username, distractorGenerator, translator, contextTranslator, generateContext),
        addWord: input => addWordWithClient(client, input),
        addWords: (targetUser, words, options) => addWordsWithClient(client, targetUser, words, options),
        saveQuizSession: (username, testId, questions, options) =>
            saveQuizSessionWithClient(client, username, testId, questions, options),
        getQuizSession: (username, testId, options) =>
            getQuizSessionWithClient(client, username, testId, options),
        deleteQuizSession: (username, testId) =>
            deleteQuizSessionWithClient(client, username, testId),
        getActiveQuizSession: (username, mode, options) =>
            getActiveQuizSessionWithClient(client, username, mode, options),
        updateQuizSessionProgress: (username, testId, progress) =>
            updateQuizSessionProgressWithClient(client, username, testId, progress),
        getFormalQuizChallenge: (username, testId) =>
            getFormalQuizChallengeWithClient(client, username, testId),
        updateFormalQuizChallengeProgress: (username, testId, progress) =>
            updateFormalQuizChallengeProgressWithClient(client, username, testId, progress),
        invalidateFormalQuizQuestion: input => invalidateFormalQuizQuestionWithClient(client, input),
        replaceFormalQuizQuestion: input => replaceFormalQuizQuestionWithClient(client, input),
        createFormalQuizChallenge: input => createFormalQuizChallengeWithClient(client, input),
        cleanupExpiredQuizSessions: options =>
            cleanupExpiredQuizSessionsWithClient(client, options),
        createReviewRound: input => createReviewRoundWithLock(client, input),
        getActiveFormalQuizChallenge: (username, options) =>
            getActiveFormalQuizChallengeWithClient(client, username, options),
        getActiveReviewRound: input => getActiveReviewRoundWithClient(client, input),
        deferReviewRound: input => deferReviewRoundWithClient(client, input),
        getReviewSummary: input => getReviewSummaryWithClient(client, input),
        prebuildWrongQuestionCache: input => prebuildWrongQuestionCacheWithClient(client, input, distractorGenerator, translator, contextTranslator, generateContext),
        submitReviewRound: input => submitReviewRoundWithClient(client, input),
    };
}

const defaultAdapter = createSupabaseDataAdapter(supabase, { generateDistractors: generateSupabaseDistractors, translateWords: translateSupabaseWords, translateContext: translateSupabaseContext, generateContext: generateReplacementContextWithAI });

module.exports = {
    name: 'supabase',
    canonicalUsernameKey,
    createSupabaseDataAdapter,
    buildCacheQuestionRowsForWord,
    generateReplacementContextWithAI,
    getUserByUsername: defaultAdapter.getUserByUsername,
    getStats: defaultAdapter.getStats,
    getAllStats: defaultAdapter.getAllStats,
    getUserLearningSettings: defaultAdapter.getUserLearningSettings,
    updateUserLearningSettings: defaultAdapter.updateUserLearningSettings,
    getWordsForUser: defaultAdapter.getWordsForUser,
    getAssessmentsForUser: defaultAdapter.getAssessmentsForUser,
    getAssessmentsForTest: defaultAdapter.getAssessmentsForTest,
    getMasteryAssessmentsForWords: defaultAdapter.getMasteryAssessmentsForWords,
    getQuestionCache: defaultAdapter.getQuestionCache,
    translateWords: defaultAdapter.translateWords,
    submitAssessment: defaultAdapter.submitAssessment,
    submitAssessments: defaultAdapter.submitAssessments,
    updateWordMastery: defaultAdapter.updateWordMastery,
    incrementCacheUsedCount: defaultAdapter.incrementCacheUsedCount,
    applyQuizCacheLifecycle: defaultAdapter.applyQuizCacheLifecycle,
    getQuestionCacheStatus: defaultAdapter.getQuestionCacheStatus,
    getGameState: defaultAdapter.getGameState,
    updateWord: defaultAdapter.updateWord,
    saveGameState: defaultAdapter.saveGameState,
    getQuestionCacheDiagnostics: defaultAdapter.getQuestionCacheDiagnostics,
    deleteQuestionCacheRows: defaultAdapter.deleteQuestionCacheRows,
    rebuildQuestionCacheForUser: defaultAdapter.rebuildQuestionCacheForUser,
    addWord: defaultAdapter.addWord,
    addWords: defaultAdapter.addWords,
    saveQuizSession: defaultAdapter.saveQuizSession,
    getQuizSession: defaultAdapter.getQuizSession,
    getActiveQuizSession: defaultAdapter.getActiveQuizSession,
    updateQuizSessionProgress: defaultAdapter.updateQuizSessionProgress,
    deleteQuizSession: defaultAdapter.deleteQuizSession,
    cleanupExpiredQuizSessions: defaultAdapter.cleanupExpiredQuizSessions,
    createReviewRound: defaultAdapter.createReviewRound,
    getActiveReviewRound: defaultAdapter.getActiveReviewRound,
    deferReviewRound: defaultAdapter.deferReviewRound,
    getReviewSummary: defaultAdapter.getReviewSummary,
    prebuildWrongQuestionCache: defaultAdapter.prebuildWrongQuestionCache,
    createFormalQuizChallenge: defaultAdapter.createFormalQuizChallenge,
    getFormalQuizChallenge: defaultAdapter.getFormalQuizChallenge,
    updateFormalQuizChallengeProgress: defaultAdapter.updateFormalQuizChallengeProgress,
    invalidateFormalQuizQuestion: defaultAdapter.invalidateFormalQuizQuestion,
    replaceFormalQuizQuestion: defaultAdapter.replaceFormalQuizQuestion,
    getActiveFormalQuizChallenge: defaultAdapter.getActiveFormalQuizChallenge,
    submitReviewRound: defaultAdapter.submitReviewRound,
};
