const {
    generateQuizWithDataSource,
    submitQuizWithDataSource,
    toFeishuWordRecord,
    toFeishuAssessmentRecord,
    toFeishuCacheRow,
} = require('./quiz-adapter');

const DATA_SOURCE = normalizeDataSource(process.env.DATA_SOURCE || 'supabase');
const quizQuestionsByTestId = new Map();

function normalizeDataSource(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'feishu' ? 'feishu' : 'supabase';
}

function getFieldVal(value) {
    if (!value) return '';
    if (typeof value === 'object') {
        if (Array.isArray(value)) return value.length ? getFieldVal(value[0]) : '';
        if (value.text !== undefined) return value.text;
        if (value.name !== undefined) return value.name;
        return JSON.stringify(value);
    }
    return String(value);
}

function normalizeUserKey(value) {
    return String(getFieldVal(value) || '').trim().toLowerCase();
}

function sameUser(left, right) {
    const a = normalizeUserKey(left);
    const b = normalizeUserKey(right);
    return Boolean(a && b && a === b);
}

function isTable(table, key) {
    return table?.dataSourceTable === key || table?.tableName === key;
}

function loadFeishuDataSource() {
    const feishu = require('./feishu');
    const {
        WORD_TABLE,
        TEST_TABLE,
        QUESTION_CACHE_TABLE,
        OPTION_IDS,
    } = require('./config');

    async function getUserByUsername(username) {
        const rows = await feishu.getRecords(require('./config').STATS_TABLE);
        const record = rows.find(row => sameUser(row.fields?.user || row.fields?.User || row.fields?.username, username));
        return record ? { ...record, username } : null;
    }

    async function getWordsForUser(username, level) {
        const rows = await feishu.getRecords(WORD_TABLE);
        return rows.filter(row =>
            sameUser(row.fields?.user, username) &&
            (!level || String(getFieldVal(row.fields?.Level)).trim() === String(level).trim())
        );
    }

    async function getAssessmentsForUser(username) {
        const rows = await feishu.getRecords(TEST_TABLE);
        return rows.filter(row => sameUser(row.fields?.user, username));
    }

    async function getQuestionCache(username, level, roundType) {
        if (!QUESTION_CACHE_TABLE) return [];
        const rows = await feishu.getRecords(QUESTION_CACHE_TABLE);
        return rows.filter(row =>
            sameUser(row.fields?.user, username) &&
            (!level || String(getFieldVal(row.fields?.level)).trim() === String(level).trim()) &&
            (!roundType || String(getFieldVal(row.fields?.round_type || 'primary')).trim() === String(roundType).trim())
        );
    }

    async function updateWordMastery(username, word, newMasteryStatus, options = {}) {
        const status = newMasteryStatus === 'mastered' ? 'Mastered' : 'Pending';
        return feishu.updateWord(username, word, {
            recordId: options.sourceWordRecordId || options.wordRecordId,
            status,
        });
    }

    async function addWord(...args) {
        if (args.length === 1 && args[0] && typeof args[0] === 'object') {
            const input = args[0];
            return feishu.addWord(input.username, {
                Word: input.word,
                Meaning: input.meaning,
                CN_Meaning: input.meaningZh || input.cnMeaning,
                POS: input.partsOfSpeech || input.pos || input.POS,
                Context: input.context || input.contextEn,
                Level: input.level,
            });
        }
        return feishu.addWord(...args);
    }

    return {
        ...feishu,
        DATA_SOURCE: 'feishu',
        name: 'feishu',
        WORD_TABLE,
        TEST_TABLE,
        QUESTION_CACHE_TABLE,
        OPTION_IDS,
        getUserByUsername,
        getWordsForUser,
        getAssessmentsForUser,
        getQuestionCache,
        submitAssessment: async () => {
            throw new Error('submitAssessment is not supported by the Feishu rollback adapter');
        },
        updateWordMastery,
        incrementCacheUsedCount: async cacheId => {
            if (!QUESTION_CACHE_TABLE || typeof feishu.updateRecord !== 'function') return null;
            return feishu.updateRecord(QUESTION_CACHE_TABLE, cacheId, {});
        },
        addWord,
    };
}

function loadSupabaseDataSource() {
    const supabaseData = require('./supabase-data');

    const WORD_TABLE = { dataSourceTable: 'words' };
    const TEST_TABLE = { dataSourceTable: 'assessments' };
    const QUESTION_CACHE_TABLE = { dataSourceTable: 'question_cache' };
    const OPTION_IDS = {
        IS_CORRECT: 'correct',
        IS_WRONG: 'wrong',
    };

    async function fetchAllRows(tableName, label) {
        const supabase = require('./supabase-client');
        const rows = [];
        const pageSize = 1000;
        for (let from = 0; ; from += pageSize) {
            const to = from + pageSize - 1;
            const { data, error } = await supabase
                .from(tableName)
                .select('*')
                .range(from, to);
            if (error) throw new Error(`${label}: ${error.message}`);
            rows.push(...(data || []));
            if (!data || data.length < pageSize) break;
        }
        return rows;
    }

    async function getUsersById() {
        const users = await fetchAllRows('users', 'getRecords.users');
        return new Map(users.map(user => [user.id, user]));
    }

    async function getRecords(table) {
        if (isTable(table, 'words')) {
            const [rows, usersById] = await Promise.all([
                fetchAllRows('words', 'getRecords.words'),
                getUsersById(),
            ]);
            return rows.map(row => toFeishuWordRecord(row, {
                username: usersById.get(row.user_id)?.username || '',
            }));
        }
        if (isTable(table, 'assessments')) {
            const [rows, wordRows, usersById] = await Promise.all([
                fetchAllRows('assessments', 'getRecords.assessments'),
                fetchAllRows('words', 'getRecords.assessmentWords'),
                getUsersById(),
            ]);
            const sourceRecordIdByWordId = new Map(
                wordRows.map(row => [row.id, row.feishu_record_id || row.id])
            );
            return rows.map(row => toFeishuAssessmentRecord(row, {
                username: usersById.get(row.user_id)?.username || '',
                sourceRecordIdByWordId,
            }));
        }
        if (isTable(table, 'question_cache')) {
            const [rows, usersById] = await Promise.all([
                fetchAllRows('question_cache', 'getRecords.questionCache'),
                getUsersById(),
            ]);
            return rows.map(row => toFeishuCacheRow(row, {
                username: usersById.get(row.user_id)?.username || '',
            }));
        }
        return [];
    }

    async function generateQuiz(user, level, mode) {
        const quiz = await generateQuizWithDataSource({
            username: user,
            level,
            mode,
            roundType: 'primary',
            limit: 10,
            dataSource: supabaseData,
        });
        if (!quiz.error && quiz.testId && Array.isArray(quiz.questions)) {
            quizQuestionsByTestId.set(`${normalizeUserKey(user)}:${quiz.testId}`, quiz.questions);
        }
        return quiz;
    }

    async function submitAnswers(user, testId, answers) {
        const key = `${normalizeUserKey(user)}:${testId}`;
        const questions = quizQuestionsByTestId.get(key);
        if (!questions) {
            throw new Error('QUIZ_SESSION_NOT_FOUND');
        }
        const result = await submitQuizWithDataSource({
            username: user,
            testId,
            answers,
            questions,
            dataSource: supabaseData,
        });
        quizQuestionsByTestId.delete(key);
        return result;
    }

    async function addWord(...args) {
        if (args.length === 1 && args[0] && typeof args[0] === 'object') {
            return supabaseData.addWord(args[0]);
        }
        const [username, fields = {}] = args;
        return supabaseData.addWord({
            username,
            word: fields.Word || fields.word,
            meaning: fields.Meaning || fields.meaning,
            meaningZh: fields.CN_Meaning || fields.cnMeaning,
            partsOfSpeech: fields.POS || fields.pos,
            context: fields.Context || fields.context,
            level: fields.Level || fields.level,
        });
    }

    return {
        ...loadFeishuFallbackExports(),
        ...supabaseData,
        DATA_SOURCE: 'supabase',
        name: 'supabase',
        WORD_TABLE,
        TEST_TABLE,
        QUESTION_CACHE_TABLE,
        OPTION_IDS,
        getRecords,
        generateQuiz,
        submitAnswers,
        addWord,
        addWords: supabaseData.addWords,
    };
}

function loadFeishuFallbackExports() {
    try {
        return require('./feishu');
    } catch (error) {
        return {};
    }
}

module.exports = DATA_SOURCE === 'feishu'
    ? loadFeishuDataSource()
    : loadSupabaseDataSource();
