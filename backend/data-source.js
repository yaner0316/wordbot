const {
    generateQuizWithDataSource,
    submitQuizWithDataSource,
    toFeishuWordRecord,
    toFeishuAssessmentRecord,
    toFeishuCacheRow,
} = require('./quiz-adapter');
const { rebuildSubmittedResult } = require('./submission-coordinator');
const {
    FORMAL_QUIZ_REQUIRED_COUNT: QUIZ_QUESTION_COUNT,
    assertFormalQuizQuestions,
    isResumableQuizSession: isStructurallyResumableQuizSession,
} = require('./formal-quiz-session');

const { getAssessmentMode, isRealAssessment } = require('./assessment-mode');
const { normalizeCacheRow, isCacheQuestionReady } = require('./question-cache');
const DATA_SOURCE = normalizeDataSource(process.env.DATA_SOURCE || 'supabase');
const quizQuestionsByTestId = new Map();
const quizSubmitLocks = new Map();
let lastQuizSessionCleanupAt = 0;

function cacheRowId(row) {
    return String(row?.id || row?.record_id || row?.recordId || '').trim();
}

function cacheRowMeaningId(row) {
    return String(row?.meaning_id || row?.meaningId || row?.word_id || row?.wordRecordId
        || row?.source_word_record_id || row?.word_record_id || '').trim();
}

function normalizeReplacementCacheRow(row) {
    return normalizeCacheRow({
        ...(row || {}),
        meaning_id: row?.meaning_id || row?.meaningId || row?.word_id || '',
        word_record_id: row?.word_record_id || row?.source_word_record_id || row?.word_feishu_record_id || '',
        context_cn: row?.context_cn || row?.context_zh || '',
    });
}

function isReplacementCacheAvailable(row, now = Date.now()) {
    const normalized = normalizeReplacementCacheRow(row);
    if (!isCacheQuestionReady(normalized)) return false;
    if (!['active', 'reserved_next_day'].includes(normalized.cacheState)) return false;
    if (normalized.cacheState === 'reserved_next_day') {
        const availableAt = Date.parse(String(normalized.availableFrom || ''));
        if (!Number.isFinite(availableAt) || availableAt > now) return false;
    }
    return true;
}

function buildFormalReplacementQuestion(row, oldQuestion) {
    const normalized = normalizeReplacementCacheRow(row);
    return {
        ...normalized.question,
        source: 'question_cache',
        cacheRecordId: normalized.recordId || cacheRowId(row),
        cacheUsedCount: normalized.usedCount,
        meaningId: normalized.question.meaningId || oldQuestion.meaningId || oldQuestion.record_id,
        challengeQuestionId: oldQuestion.challengeQuestionId || oldQuestion.challenge_question_id || oldQuestion.id,
        id: oldQuestion.id,
        ordinal: oldQuestion.ordinal,
        questionFingerprint: String(row?.question_fingerprint || row?.questionFingerprint || '').trim(),
        correctAnswer: normalized.question.answer,
    };
}

function selectFormalReplacementQuestion(cacheRows, oldQuestion, now = Date.now()) {
    const oldCacheId = String(oldQuestion?.cacheRecordId || '').trim();
    const meaningId = String(oldQuestion?.meaningId || oldQuestion?.meaning_id || oldQuestion?.record_id || '').trim();
    return (cacheRows || [])
        .filter(row => cacheRowId(row) && cacheRowId(row) !== oldCacheId)
        .filter(row => cacheRowMeaningId(row) === meaningId
            || String(normalizeReplacementCacheRow(row).question?.record_id || '').trim() === String(oldQuestion?.record_id || '').trim())
        .filter(row => isReplacementCacheAvailable(row, now))
        .map(row => buildFormalReplacementQuestion(row, oldQuestion))[0] || null;
}

function isResumableQuizSession(session, requestedMode) {
    const mode = requestedMode || 'real';
    if (getAssessmentMode(session?.test_id) !== mode) return false;

    const questions = Array.isArray(session?.questions) ? session.questions : [];
    if (mode === 'test') return questions.length > 0;
    return questions.length === QUIZ_QUESTION_COUNT
        && isStructurallyResumableQuizSession(session, mode)
        && questions.every(question => String(question?.source || '').trim().toLowerCase() === 'question_cache'
            && String(question?.cacheRecordId || '').trim());
}


function assertFormalQuizIsCompleteAndCacheOnly(testId, questions) {
    if (!isRealAssessment(testId)) return;
    assertFormalQuizQuestions(questions);
}
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

    let feishuCacheDataSource;
    function getFeishuCacheDataSource() {
        if (!feishuCacheDataSource) feishuCacheDataSource = loadFeishuDataSource();
        return feishuCacheDataSource;
    }

    async function getQuestionCache(username, level, roundType) {
        const source = CACHE_SOURCE;
        const dbRead = () => supabaseData.getQuestionCache(username, level, roundType);
        if (source === 'db') return dbRead();

        const feishuRead = () => getFeishuCacheDataSource().getQuestionCache(username, level, roundType);
        if (source === 'feishu') return feishuRead();

        const feishuRows = await feishuRead();
        try {
            const dbRows = await dbRead();
            console.warn('[question_cache compare] ' + JSON.stringify(summarizeCacheComparison(dbRows, feishuRows)));
        } catch (error) {
            console.warn('[question_cache compare] ' + JSON.stringify({ dbError: error.message, feishuCount: feishuRows.length }));
        }
        return feishuRows;
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
        const formalChallengeReaderAvailable = typeof supabaseData.getActiveFormalQuizChallenge === 'function';
        const activeFormalChallenge = mode === 'real'
            ? await getActiveFormalQuizChallengeBestEffort(supabaseData, user)
            : null;
        if (mode === 'real' && formalChallengeReaderAvailable && activeFormalChallenge?.unavailable) {
            return {
                error: 'Formal challenge is not ready yet.', code: 'FORMAL_CHALLENGE_NOT_READY',
                source: 'formal_quiz_challenge', level: level || null,
                readyCount: 0, requiredCount: QUIZ_QUESTION_COUNT, questions: [],
                diagnostics: { fallbackUsed: false, state: 'building', readyCount: 0, requiredCount: QUIZ_QUESTION_COUNT, finalQuestionCount: 0 },
            };
        }
        if (activeFormalChallenge && Array.isArray(activeFormalChallenge.questions)
            && activeFormalChallenge.questions.length === QUIZ_QUESTION_COUNT) {
            const questions = activeFormalChallenge.questions;
            quizQuestionsByTestId.set(`${normalizeUserKey(user)}:${activeFormalChallenge.test_id}`, questions);
            return {
                testId: activeFormalChallenge.test_id,
                challengeId: activeFormalChallenge.challenge_id || activeFormalChallenge.id,
                mode: 'real', level: level || activeFormalChallenge.level || null,
                source: 'formal_quiz_challenge', questions,
                progress: activeFormalChallenge.progress || { currentQuestion: 0, answers: [] },
                readyCount: questions.length, requiredCount: QUIZ_QUESTION_COUNT,
                partialFormalChallenge: false,
                diagnostics: { fallbackUsed: false, resumed: true, requiredCount: QUIZ_QUESTION_COUNT, readyCount: questions.length, finalQuestionCount: questions.length },
            };
        }
        const activeSession = mode === 'real' && formalChallengeReaderAvailable
            ? null
            : await getActiveQuizSessionBestEffort(supabaseData, user, mode || 'real');
        if (activeSession) {
            const questions = Array.isArray(activeSession.questions) ? activeSession.questions : [];
            if (isResumableQuizSession(activeSession, mode || 'real')) {
                const partialFormalChallenge = questions.length < QUIZ_QUESTION_COUNT;
                return {
                    testId: activeSession.test_id,
                    mode: mode || 'real',
                    level: level || null,
                    source: 'question_cache',
                    partialFormalChallenge,
                    readyCount: questions.length,
                    requiredCount: QUIZ_QUESTION_COUNT,
                    diagnostics: {
                        fallbackUsed: false,
                        resumed: true,
                        requiredCount: QUIZ_QUESTION_COUNT,
                        readyCount: questions.length,
                        finalQuestionCount: questions.length,
                    },
                    progress: activeSession.progress || { currentQuestion: 0, answers: [] },
                    questions,
                };
            }
            if (getAssessmentMode(activeSession.test_id) === (mode || 'real')) {
                await deleteQuizSessionBestEffort(supabaseData, user, activeSession.test_id);
            }
        }
        const quiz = await generateQuizWithDataSource({
            username: user,
            level,
            mode,
            roundType: 'primary',
            limit: 10,
            dataSource: supabaseData,
        });
        if (!quiz.error && quiz.testId && Array.isArray(quiz.questions)) {
            if ((mode || 'real') === 'real' && formalChallengeReaderAvailable
                && typeof supabaseData.createFormalQuizChallenge !== 'function') {
                throw new Error('FORMAL_CHALLENGE_NOT_CREATED');
            }
            if ((mode || 'real') === 'real' && quiz.questions.length === QUIZ_QUESTION_COUNT
                && typeof supabaseData.createFormalQuizChallenge === 'function') {
                const challenge = await supabaseData.createFormalQuizChallenge({
                    username: user,
                    testId: quiz.testId,
                    level,
                    questions: quiz.questions,
                });
                if (!challenge?.challenge_id && !challenge?.challengeId) throw new Error('FORMAL_CHALLENGE_NOT_CREATED');
                quiz.challengeId = challenge?.challenge_id || challenge?.challengeId || null;
                quiz.challenge = challenge;
            }
            quizQuestionsByTestId.set(`${normalizeUserKey(user)}:${quiz.testId}`, quiz.questions);
            await saveQuizSessionBestEffort(supabaseData, user, quiz.testId, quiz.questions);
            maybeCleanupExpiredQuizSessions(supabaseData);
        }
        return quiz;
    }

    function assessmentTestId(row) {
        return String(row?.test_id || row?.fields?.test_id || '').trim();
    }

    function rebuildSupabaseQuizResult(testId, assessments, expectedCount) {
        const records = assessments
            .filter(row => assessmentTestId(row) === testId)
            .slice(0, expectedCount);
        if (records.length < expectedCount) return null;
        return rebuildSubmittedResult(
            records.map(row => toFeishuAssessmentRecord(row, { username: '' })),
            value => String(value || '').trim().toLowerCase() === 'correct'
        );
    }

    async function getSupabaseQuizAssessments(user, testId) {
        if (typeof supabaseData.getAssessmentsForTest === 'function') {
            return supabaseData.getAssessmentsForTest(user, testId) || [];
        }
        if (typeof supabaseData.getAssessmentsForUser !== 'function') return [];
        const assessments = await supabaseData.getAssessmentsForUser(user);
        return (assessments || []).filter(row => assessmentTestId(row) === testId);
    }

    function getCompleteSupabaseQuizResult(testId, assessments, expectedCount) {
        return rebuildSupabaseQuizResult(testId, assessments || [], expectedCount);
    }

    async function completeFormalChallengeIfSubmitted(user, testId, result) {
        if (!isRealAssessment(testId) || !result || result.replacementRequired) return;
        if (typeof supabaseData.completeFormalQuizChallenge !== 'function') return;
        await supabaseData.completeFormalQuizChallenge(user, testId);
    }

    async function submitAnswersOnce(user, testId, answers) {
        const key = `${normalizeUserKey(user)}:${testId}`;
        let questions = quizQuestionsByTestId.get(key);
        if (!questions) {
            if (isRealAssessment(testId) && typeof supabaseData.getFormalQuizChallenge === 'function') {
                const challenge = await supabaseData.getFormalQuizChallenge(user, testId);
                questions = Array.isArray(challenge?.questions) ? challenge.questions : null;
                if (!questions) {
                    const existingAssessments = await getSupabaseQuizAssessments(user, testId);
                    const existingResult = getCompleteSupabaseQuizResult(testId, existingAssessments, QUIZ_QUESTION_COUNT);
                    if (existingResult) {
                        await completeFormalChallengeIfSubmitted(user, testId, existingResult);
                        return existingResult;
                    }
                    if (existingAssessments.length > 0) throw new Error('QUIZ_SUBMISSION_INCOMPLETE');
                    throw new Error('FORMAL_CHALLENGE_NOT_FOUND');
                }
            } else if (typeof supabaseData.getQuizSession === 'function') {
                const session = await supabaseData.getQuizSession(user, testId);
                questions = session?.questions;
            }
            if (!questions) {
                const existingAssessments = await getSupabaseQuizAssessments(user, testId);
                const existingResult = getCompleteSupabaseQuizResult(testId, existingAssessments, QUIZ_QUESTION_COUNT);
                if (existingResult) {
                    await completeFormalChallengeIfSubmitted(user, testId, existingResult);
                    return existingResult;
                }
                if (existingAssessments.length > 0) throw new Error('QUIZ_SUBMISSION_INCOMPLETE');
                throw new Error('QUIZ_SESSION_NOT_FOUND');
            }
        }
        const existingAssessments = await getSupabaseQuizAssessments(user, testId);
        assertFormalQuizIsCompleteAndCacheOnly(testId, questions);
        const existingResult = getCompleteSupabaseQuizResult(testId, existingAssessments, questions.length);
        if (existingResult) {
            await completeFormalChallengeIfSubmitted(user, testId, existingResult);
            return existingResult;
        }
        const result = await submitQuizWithDataSource({
            username: user,
            testId,
            answers,
            questions,
            dataSource: supabaseData,
            existingAssessments,
        });
        if (isRealAssessment(testId) && result.replacementRequired) {
            const invalidIndexes = (result.results || [])
                .map((item, index) => item?.replacementRequired ? index : -1)
                .filter(index => index >= 0);
            const replacementQuestions = [];
            let replacementCacheRows = null;
            for (const index of invalidIndexes) {
                const oldQuestion = questions[index];
                if (!replacementCacheRows) {
                    const level = oldQuestion?.level || questions.find(question => question?.level)?.level || '';
                    replacementCacheRows = typeof supabaseData.getQuestionCache === 'function'
                        ? await supabaseData.getQuestionCache(user, level, 'primary')
                        : [];
                }
                const replacement = selectFormalReplacementQuestion(replacementCacheRows, oldQuestion, Date.now());
                const challengeQuestionId = oldQuestion.challengeQuestionId
                    || oldQuestion.challenge_question_id
                    || oldQuestion.id;
                if (!replacement || !String(challengeQuestionId || '').trim()
                    || typeof supabaseData.replaceFormalQuizQuestion !== 'function') {
                    return {
                        ...result,
                        code: 'FORMAL_REPLACEMENT_NOT_READY',
                        replacementQuestions: [],
                        diagnostics: {
                            ...(result.diagnostics || {}),
                            replacementState: 'building',
                            replacementReady: false,
                        },
                    };
                }
                await supabaseData.replaceFormalQuizQuestion({
                    username: user,
                    testId,
                    challengeQuestionId,
                    cacheQuestionId: replacement.cacheRecordId,
                    stem: replacement.context,
                    questionFingerprint: replacement.questionFingerprint,
                    questionSnapshot: replacement,
                });
                replacementQuestions.push({ ...replacement, questionIndex: index });
            }
            const updatedQuestions = [...questions];
            for (const replacement of replacementQuestions) {
                updatedQuestions[replacement.questionIndex] = replacement;
            }
            quizQuestionsByTestId.set(key, updatedQuestions);
            return {
                ...result,
                code: 'FORMAL_QUESTION_REPLACED',
                replacementQuestions,
                diagnostics: {
                    ...(result.diagnostics || {}),
                    replacementState: 'ready',
                    replacementReady: true,
                },
            };
        }
        await completeFormalChallengeIfSubmitted(user, testId, result);
        if (typeof supabaseData.applyQuizCacheLifecycle === 'function') {
            try {
                await supabaseData.applyQuizCacheLifecycle({ userId: user, questions, results: result.results || [] });
            } catch (error) {
                console.warn('[question_cache] lifecycle update failed: ' + error.message);
            }
        }
        quizQuestionsByTestId.delete(key);
        if (typeof supabaseData.deleteQuizSession === 'function') {
            await supabaseData.deleteQuizSession(user, testId);
        }
        return result;
    }

    async function submitAnswers(user, testId, answers) {
        const key = `${normalizeUserKey(user)}:${testId}`;
        const previous = quizSubmitLocks.get(key) || Promise.resolve();
        const task = previous
            .catch(() => {})
            .then(() => submitAnswersOnce(user, testId, answers));
        quizSubmitLocks.set(key, task);
        try {
            return await task;
        } finally {
            if (quizSubmitLocks.get(key) === task) quizSubmitLocks.delete(key);
        }
    }


    async function addWord(...args) {
        let result;
        if (args.length === 1 && args[0] && typeof args[0] === 'object') {
            result = await supabaseData.addWord(args[0]);
            return result;
        }
        const [username, fields = {}] = args;
        result = await supabaseData.addWord({
            username,
            word: fields.Word || fields.word,
            meaning: fields.Meaning || fields.meaning,
            meaningZh: fields.CN_Meaning || fields.cnMeaning,
            partsOfSpeech: fields.POS || fields.pos,
            context: fields.Context || fields.context,
            level: fields.Level || fields.level,
        });
        return result;
    }

    async function addWords(targetUser, words, options) {
        const result = await supabaseData.addWords(targetUser, words, options);
        return result;
    }

    async function getActiveQuizSession(user, mode = 'real') {
        const session = await getActiveQuizSessionBestEffort(supabaseData, user, mode);
        return isResumableQuizSession(session, mode) ? session : null;
    }
    return {
        ...loadFeishuFallbackExports(),
        ...supabaseData,
        getQuizHistory: (username, mode) => supabaseData.getQuizHistory(username, mode),
        getActiveQuizSession,
        updateQuizSessionProgress: async (username, testId, progress) => {
            if (isRealAssessment(testId) && typeof supabaseData.updateFormalQuizChallengeProgress === 'function') {
                const result = await supabaseData.updateFormalQuizChallengeProgress(username, testId, progress);
                if (!result) throw new Error('FORMAL_CHALLENGE_NOT_FOUND');
                return result;
            }
            if (typeof supabaseData.updateQuizSessionProgress !== 'function') return null;
            return supabaseData.updateQuizSessionProgress(username, testId, progress);
        },
        getQuestionCache,
        isResumableQuizSession,
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
        updateWord: (username, word, fields) => supabaseData.updateWord(username, word, fields),
        addWords,
    };

async function getActiveFormalQuizChallengeBestEffort(supabaseData, user, options) {
    if (typeof supabaseData.getActiveFormalQuizChallenge !== 'function') return null;
    try {
        return await supabaseData.getActiveFormalQuizChallenge(user, options);
    } catch (error) {
        if (String(error?.message || '').includes('quiz_challenges')) {
            console.warn('[quiz_challenges] active-challenge lookup skipped: ' + error.message);
            return { unavailable: true, error: error.message };
        }
        throw error;
    }
}
}

function loadFeishuFallbackExports() {
    try {
        return require('./feishu');
    } catch (error) {
        return {};
    }
}

async function getActiveQuizSessionBestEffort(supabaseData, user, mode = 'real', options) {
    if (typeof supabaseData.getActiveQuizSession !== 'function') return null;
    try {
        return await supabaseData.getActiveQuizSession(user, mode, options);
    } catch (error) {
        if (isMissingQuizSessionsTableError(error)) {
            console.warn('[quiz_sessions] active-session lookup skipped: ' + error.message);
            return null;
        }
        throw error;
    }
}

function normalizeCacheSource(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return ['db', 'feishu', 'compare'].includes(normalized) ? normalized : 'db';
}

const CACHE_SOURCE = normalizeCacheSource(process.env.WORDBOT_CACHE_SOURCE);

function cacheRowKey(row) {
    return String(row?.record_id || row?.feishu_record_id || row?.id || '').trim();
}

function summarizeCacheComparison(dbRows, feishuRows) {
    const dbKeys = new Set((dbRows || []).map(cacheRowKey).filter(Boolean));
    const feishuKeys = new Set((feishuRows || []).map(cacheRowKey).filter(Boolean));
    return {
        dbCount: Array.isArray(dbRows) ? dbRows.length : 0,
        feishuCount: Array.isArray(feishuRows) ? feishuRows.length : 0,
        dbOnlyCount: [...dbKeys].filter(key => !feishuKeys.has(key)).length,
        feishuOnlyCount: [...feishuKeys].filter(key => !dbKeys.has(key)).length,
    };
}


async function deleteQuizSessionBestEffort(supabaseData, user, testId) {
    if (typeof supabaseData.deleteQuizSession !== 'function' || !testId) return null;
    try {
        return await supabaseData.deleteQuizSession(user, testId);
    } catch (error) {
        if (isMissingQuizSessionsTableError(error)) return null;
        throw error;
    }
}

async function saveQuizSessionBestEffort(supabaseData, user, testId, questions) {
    if (typeof supabaseData.saveQuizSession !== 'function') return null;
    try {
        return await supabaseData.saveQuizSession(user, testId, questions);
    } catch (error) {
        if (isMissingQuizSessionsTableError(error)) {
            console.warn(`[quiz_sessions] persistence skipped: ${error.message}`);
            return null;
        }
        throw error;
    }
}

function isMissingQuizSessionsTableError(error) {
    const messageParts = [
        error?.message,
        error?.details,
        error?.hint,
    ].map(part => String(part || '').toLowerCase());
    const message = messageParts.join(' ');
    return message.includes('quiz_sessions') && (
        error?.code === 'PGRST205' ||
        message.includes('could not find the table') ||
        message.includes('schema cache') ||
        message.includes('session_state')
    );
}

function maybeCleanupExpiredQuizSessions(supabaseData, now = Date.now()) {
    if (typeof supabaseData.cleanupExpiredQuizSessions !== 'function') return;
    if (now - lastQuizSessionCleanupAt < 60 * 60 * 1000) return;
    lastQuizSessionCleanupAt = now;
    try {
        const cleanupPromise = supabaseData.cleanupExpiredQuizSessions();
        if (cleanupPromise && typeof cleanupPromise.catch === 'function') {
            cleanupPromise.catch(error => {
                console.warn(`[quiz_sessions] cleanup failed: ${error.message}`);
            });
        }
    } catch (error) {
        console.warn(`[quiz_sessions] cleanup failed: ${error.message}`);
    }
}

module.exports = DATA_SOURCE === 'feishu'
    ? loadFeishuDataSource()
    : loadSupabaseDataSource();
