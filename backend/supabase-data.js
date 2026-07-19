const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const supabase = require('./supabase-client');
const { isRealAssessment } = require('./assessment-mode');

const PAGE_SIZE = 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_CORRECTNESS = new Set(['correct', 'wrong']);
const VALID_CONFIDENCE = new Set(['sure', 'guess']);
const VALID_MASTERY_STATUS = new Set(['pending', 'recognized', 'consolidating', 'mastered']);

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
    const rows = await fetchAllRows(
        () => {
            let query = client
                .from('words')
                .select('*')
                .eq('user_id', user.id)
                .order('entered_at', { ascending: true })
                .order('id', { ascending: true });
            if (level) query = query.eq('level', level);
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
    return rows.map((row) => ({
        ...row,
        username: user.username,
        username_key: user.username_key,
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

async function getQuestionCache(username, level, roundType) {
    return getQuestionCacheWithClient(supabase, username, level, roundType);
}

async function getQuestionCacheWithClient(client, username, level, roundType) {
    const user = await getUserByUsernameWithClient(client, username);
    if (!user) return [];
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
            if (level) query = query.eq('level', level);
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
    const { data, error } = await client
        .from('question_cache')
        .select('*')
        .eq('feishu_record_id', id)
        .maybeSingle();
    ensureNoError(error, 'resolveCacheRow.feishu');
    if (!data) throw new Error(`QUESTION_CACHE_NOT_FOUND: ${id}`);
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
        level: input.level || wordRow.level || null,
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
        level: input.level || user.learning_level || null,
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

function createSupabaseDataAdapter(client = supabase) {
    return {
        name: 'supabase',
        canonicalUsernameKey,
        getUserByUsername: username => getUserByUsernameWithClient(client, username),
        getWordsForUser: (username, level) => getWordsForUserWithClient(client, username, level),
        getAssessmentsForUser: username => getAssessmentsForUserWithClient(client, username),
        getQuestionCache: (username, level, roundType) => getQuestionCacheWithClient(client, username, level, roundType),
        submitAssessment: input => submitAssessmentWithClient(client, input),
        updateWordMastery: (username, word, newMasteryStatus, options) =>
            updateWordMasteryWithClient(client, username, word, newMasteryStatus, options),
        incrementCacheUsedCount: cacheId => incrementCacheUsedCountWithClient(client, cacheId),
        addWord: input => addWordWithClient(client, input),
    };
}

const defaultAdapter = createSupabaseDataAdapter(supabase);

module.exports = {
    name: 'supabase',
    canonicalUsernameKey,
    createSupabaseDataAdapter,
    getUserByUsername: defaultAdapter.getUserByUsername,
    getWordsForUser: defaultAdapter.getWordsForUser,
    getAssessmentsForUser: defaultAdapter.getAssessmentsForUser,
    getQuestionCache: defaultAdapter.getQuestionCache,
    submitAssessment: defaultAdapter.submitAssessment,
    updateWordMastery: defaultAdapter.updateWordMastery,
    incrementCacheUsedCount: defaultAdapter.incrementCacheUsedCount,
    addWord: defaultAdapter.addWord,
};
