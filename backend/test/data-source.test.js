const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const BACKEND_DIR = path.join(__dirname, '..');
const DATA_SOURCE_PATH = path.join(BACKEND_DIR, 'data-source.js');
const SUPABASE_DATA_PATH = path.join(BACKEND_DIR, 'supabase-data.js');
const FEISHU_PATH = path.join(BACKEND_DIR, 'feishu.js');
const CONFIG_PATH = path.join(BACKEND_DIR, 'config.js');

function clearBackendModules() {
    for (const key of Object.keys(require.cache)) {
        if (key.startsWith(BACKEND_DIR)) delete require.cache[key];
    }
}

function loadDataSource({ envValue, cacheSource, supabaseExports = {}, feishuExports = {} } = {}) {
    clearBackendModules();
    const previous = process.env.DATA_SOURCE;
    const previousCacheSource = process.env.WORDBOT_CACHE_SOURCE;
    if (cacheSource === undefined) {
        delete process.env.WORDBOT_CACHE_SOURCE;
    } else {
        process.env.WORDBOT_CACHE_SOURCE = cacheSource;
    }
    if (envValue === undefined) {
        delete process.env.DATA_SOURCE;
    } else {
        process.env.DATA_SOURCE = envValue;
    }
    require.cache[SUPABASE_DATA_PATH] = {
        id: SUPABASE_DATA_PATH,
        filename: SUPABASE_DATA_PATH,
        loaded: true,
        exports: {
            name: 'supabase',
            getUserByUsername: async username => ({ source: 'supabase', username }),
            getWordsForUser: async username => [{ source: 'supabase', username }],
            getAssessmentsForUser: async username => [{ source: 'supabase', username }],
            getQuestionCache: async username => [{ source: 'supabase', username }],
            submitAssessment: async input => ({ source: 'supabase', input }),
            updateWordMastery: async (...args) => ({ source: 'supabase', args }),
            incrementCacheUsedCount: async cacheId => ({ source: 'supabase', cacheId }),
            addWord: async input => ({ source: 'supabase', input }),
            ...supabaseExports,
        },
    };
    require.cache[FEISHU_PATH] = {
        id: FEISHU_PATH,
        filename: FEISHU_PATH,
        loaded: true,
        exports: {
            name: 'feishu',
            getRecords: async () => [],
            getQuestionCache: async username => [{ source: 'feishu', username }],
            generateQuiz: async (...args) => ({ source: 'feishu-generate', args }),
            submitAnswers: async (...args) => ({ source: 'feishu-submit', args }),
            addWord: async (...args) => ({ source: 'feishu-add', args }),
            ...feishuExports,
        },
    };
    require.cache[CONFIG_PATH] = {
        id: CONFIG_PATH,
        filename: CONFIG_PATH,
        loaded: true,
        exports: {
            WORD_TABLE: { tableName: 'words' },
            TEST_TABLE: { tableName: 'assessments' },
            STATS_TABLE: { tableName: 'users' },
            QUESTION_CACHE_TABLE: { tableName: 'question_cache' },
            OPTION_IDS: { IS_CORRECT: 'correct', IS_WRONG: 'wrong' },
        },
    };
    try {
        return require(DATA_SOURCE_PATH);
    } finally {
        if (previousCacheSource === undefined) delete process.env.WORDBOT_CACHE_SOURCE;
        else process.env.WORDBOT_CACHE_SOURCE = previousCacheSource;
        if (previous === undefined) delete process.env.DATA_SOURCE;
        else process.env.DATA_SOURCE = previous;
    }
}

function formalCacheRows(count = 10) {
    return Array.from({ length: count }, (_, index) => [1, 2].map(variantSlot => ({
        id: `cache-${index + 1}-${variantSlot}`,
        feishu_record_id: `cache-rec-${index + 1}-${variantSlot}`,
        source_word_record_id: `rec-word-${index + 1}`,
        word: `word${index + 1}`,
        level: 'middle',
        round_type: 'primary',
        quality_status: 'ready',
        cache_state: 'active',
        variant_slot: variantSlot,
        question_fingerprint: `fp-${index + 1}-${variantSlot}`,
        question_type: 1,
        question_text: `Variant ${variantSlot} uses word${index + 1} naturally today.`,
        context_zh: '\u8fd9\u662f\u5f53\u524d\u9898\u5e72\u5bf9\u5e94\u7684\u5b8c\u6574\u4e2d\u6587\u53e5\u5b50\u3002',
        options: [`A. word${index + 1}`, `B. pear-${variantSlot}`, `C. desk-${variantSlot}`, `D. chair-${variantSlot}`],
        answer: 'A',
        option_meanings: ['\u91ca\u4e49', '\u6c34\u679c', '\u684c\u5b50', '\u6905\u5b50'],
        correct_meaning: '\u91ca\u4e49',
        used_count: 0,
    }))).flat();
}


function formalWordRows(count = 10) {
    return Array.from({ length: count }, (_, index) => ({
        id: `word-${index + 1}`,
        feishu_record_id: `rec-word-${index + 1}`,
        username: 'qiuqiu',
        word: `word${index + 1}`,
        meaning_en: `meaning ${index + 1}`,
        meaning_zh: `meaning ${index + 1}`,
        context_en: `A clear sentence uses word${index + 1} naturally.`,
        context_zh: `Chinese sentence ${index + 1}.`,
        level: 'middle',
        mastery_status: 'pending',
        entered_at: '2026-01-01T00:00:00.000Z',
    }));
}
test('generateQuiz resumes an active complete type-one session before building a new quiz', async () => {
    const questions = Array.from({ length: 10 }, (_, index) => ({
        type: 1,
        word: 'word' + (index + 1),
        record_id: 'rec-' + (index + 1),
        cacheRecordId: 'cache-' + (index + 1),
        source: 'question_cache',
        options: ['A. answer', 'B. other', 'C. another', 'D. last'],
        answer: 'A',
        context: 'Sentence ' + (index + 1) + '.',
    }));
    const dataSource = loadDataSource({
        supabaseExports: {
            getActiveQuizSession: async () => ({
                test_id: 'real-active',
                questions,
                progress: { currentQuestion: 7, answers: Array(7).fill({ option: 0, confidence: 'sure' }) },
            }),
        },
    });

    const quiz = await dataSource.generateQuiz('qiuqiu', 'middle', 'real');

    assert.equal(quiz.testId, 'real-active');
    assert.equal(quiz.questions.length, 10);
    assert.equal(quiz.source, 'question_cache');
    assert.equal(quiz.partialFormalChallenge, false);
    assert.equal(quiz.readyCount, 10);
    assert.equal(quiz.requiredCount, 10);
    assert.deepEqual(quiz.diagnostics, { fallbackUsed: false, resumed: true, requiredCount: 10, readyCount: 10, finalQuestionCount: 10 });
    assert.equal(quiz.progress.currentQuestion, 7);
});

test('generateQuiz forwards mode for real-test-real session recovery', async () => {
    const sessionForMode = mode => ({
        test_id: `${mode}-active`,
        mode,
        questions: mode === 'real'
            ? Array.from({ length: 10 }, (_, index) => ({
                type: 1, word: `real-${index}`, record_id: `meaning-${index}`,
                cacheRecordId: `cache-${index}`, source: 'question_cache',
            }))
            : [{ type: 1, word: 'test-word' }],
        progress: { currentQuestion: 0, answers: [] },
    });
    const requestedModes = [];
    const dataSource = loadDataSource({
        supabaseExports: {
            getActiveQuizSession: async (_user, mode) => {
                requestedModes.push(mode);
                return sessionForMode(mode);
            },
        },
    });

    const realFirst = await dataSource.generateQuiz('qiuqiu', 'middle', 'real');
    const test = await dataSource.generateQuiz('qiuqiu', 'middle', 'test');
    const realAgain = await dataSource.generateQuiz('qiuqiu', 'middle', 'real');

    assert.deepEqual(requestedModes, ['real', 'test', 'real']);
    assert.equal(realFirst.testId, 'real-active');
    assert.equal(test.testId, 'test-active');
    assert.equal(realAgain.testId, 'real-active');
});

test('formal quiz generation creates the authoritative Supabase challenge before persistence', async () => {
    const calls = [];
    const dataSource = loadDataSource({
        supabaseExports: {
            getActiveFormalQuizChallenge: async () => null,
            getActiveQuizSession: async () => null,
            getWordsForUser: async () => formalWordRows(10),
            getAssessmentsForUser: async () => [],
            getQuestionCache: async () => formalCacheRows(10),
            createFormalQuizChallenge: async input => {
                calls.push(input);
                return { challenge_id: 'challenge-1', test_id: input.testId, question_count: 10 };
            },
            saveQuizSession: async () => ({}),
        },
    });

    const quiz = await dataSource.generateQuiz('qiuqiu', 'middle', 'real');

    assert.equal(quiz.error, undefined);
    assert.equal(quiz.questions.length, 10);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].username, 'qiuqiu');
    assert.equal(calls[0].testId, quiz.testId);
    assert.equal(calls[0].questions.length, 10);
    assert.equal(calls[0].questions.every(question => question.source === 'question_cache'), true);
    assert.equal(calls[0].questions[0].cacheRecordId, 'cache-1-1');
});

test('formal generation blocks when authoritative challenge creation is unavailable', async () => {
    let saved = 0;
    const dataSource = loadDataSource({
        supabaseExports: {
            getActiveFormalQuizChallenge: async () => null,
            getWordsForUser: async () => formalWordRows(10),
            getAssessmentsForUser: async () => [],
            getQuestionCache: async () => formalCacheRows(10),
            saveQuizSession: async () => { saved += 1; return {}; },
        },
    });

    await assert.rejects(
        dataSource.generateQuiz('qiuqiu', 'middle', 'real'),
        /FORMAL_CHALLENGE_NOT_CREATED/
    );
    assert.equal(saved, 0);
});

test('test-mode generation never creates a formal Supabase challenge', async () => {
    let calls = 0;
    const dataSource = loadDataSource({
        supabaseExports: {
            getActiveQuizSession: async () => null,
            getWordsForUser: async () => formalWordRows(10),
            getAssessmentsForUser: async () => [],
            getQuestionCache: async () => formalCacheRows(10),
            createFormalQuizChallenge: async () => { calls += 1; },
            saveQuizSession: async () => ({}),
        },
    });

    const quiz = await dataSource.generateQuiz('qiuqiu', 'middle', 'test');

    assert.equal(quiz.questions.length, 10);
    assert.equal(calls, 0);
});

test('formal challenge creation failure blocks the quiz and legacy session persistence', async () => {
    let saved = 0;
    const dataSource = loadDataSource({
        supabaseExports: {
            getActiveQuizSession: async () => null,
            getWordsForUser: async () => formalWordRows(10),
            getAssessmentsForUser: async () => [],
            getQuestionCache: async () => formalCacheRows(10),
            createFormalQuizChallenge: async () => { throw new Error('FORMAL_CHALLENGE_RPC_FAILED'); },
            saveQuizSession: async () => { saved += 1; return {}; },
        },
    });

    await assert.rejects(
        dataSource.generateQuiz('qiuqiu', 'middle', 'real'),
        /FORMAL_CHALLENGE_RPC_FAILED/
    );
    assert.equal(saved, 0);
});


test('generateQuiz discards a seven-question formal session and refuses its submission', async () => {
    const questions = Array.from({ length: 7 }, (_, index) => ({
        type: 1,
        word: 'word' + (index + 1),
        record_id: 'rec-' + (index + 1),
        cacheRecordId: 'cache-' + (index + 1),
        source: 'question_cache',
        options: ['A. answer', 'B. other', 'C. another', 'D. last'],
        answer: 'A',
        context: 'Sentence ' + (index + 1) + '.',
    }));
    const deletedSessions = [];
    const dataSource = loadDataSource({

        supabaseExports: {
            getActiveQuizSession: async () => ({
                test_id: 'real-partial-active',
                questions,
                progress: { currentQuestion: 4, answers: Array(4).fill({ option: 0, confidence: 'sure' }) },
            }),
            getQuizSession: async () => ({ questions }),
            deleteQuizSession: async (username, testId) => {
                deletedSessions.push([username, testId]);
                return { deleted: 1 };
            },
        },
    });

    const quiz = await dataSource.generateQuiz('qiuqiu', 'middle', 'real');

    assert.notEqual(quiz.testId, 'real-partial-active');
    assert.deepEqual(quiz.questions, []);
    assert.deepEqual(deletedSessions, [['qiuqiu', 'real-partial-active']]);
    assert.equal(await dataSource.getActiveQuizSession('qiuqiu', 'real'), null);
    await assert.rejects(
        dataSource.submitAnswers('qiuqiu', 'real-partial-active', questions.map(() => ({ option: 0, confidence: 'sure' }))),
        /FORMAL_QUIZ_INCOMPLETE/
    );
});

test('generateQuiz resumes an active authoritative formal challenge before legacy sessions', async () => {
    const questions = Array.from({ length: 10 }, (_, index) => ({
        type: 1, word: `word-${index + 1}`, record_id: `meaning-${index + 1}`,
        cacheRecordId: `cache-${index + 1}`, source: 'question_cache',
        context: `Sentence ${index + 1}.`, options: ['A', 'B', 'C', 'D'], answer: 'A',
    }));
    const dataSource = loadDataSource({
        supabaseExports: {
            getActiveFormalQuizChallenge: async () => ({
                challenge_id: 'challenge-1', test_id: 'real-authoritative-1',
                mode: 'real', level: 'middle', questions,
                progress: { currentQuestion: 4, answers: Array(4).fill({ option: 0 }) },
            }),
            getActiveQuizSession: async () => ({ test_id: 'real-legacy-1', questions }),
        },
    });
    const quiz = await dataSource.generateQuiz('qiuqiu', 'middle', 'real');
    assert.equal(quiz.testId, 'real-authoritative-1');
    assert.equal(quiz.challengeId, 'challenge-1');
    assert.equal(quiz.progress.currentQuestion, 4);
    assert.equal(quiz.questions.length, 10);
});

test('formal generation skips legacy sessions when challenge storage has no active challenge', async () => {
    const questions = Array.from({ length: 10 }, (_, index) => ({
        type: 1, word: `legacy-${index + 1}`, record_id: `meaning-${index + 1}`,
        cacheRecordId: `cache-${index + 1}`, source: 'question_cache',
        options: ['A', 'B', 'C', 'D'], answer: 'A', context: `Legacy ${index + 1}.`,
    }));
    let legacySessionReads = 0;
    const dataSource = loadDataSource({
        supabaseExports: {
            getActiveFormalQuizChallenge: async () => null,
            getActiveQuizSession: async () => {
                legacySessionReads += 1;
                return { test_id: 'real-legacy-1', questions };
            },
        },
    });

    const quiz = await dataSource.generateQuiz('qiuqiu', 'middle', 'real');

    assert.equal(quiz.testId, undefined);
    assert.equal(quiz.code, 'QUESTION_POOL_EXHAUSTED');
    assert.deepEqual(quiz.questions, []);
    assert.equal(legacySessionReads, 0, 'migrated formal mode must not inspect legacy quiz_sessions');
});
test('legacy seven-question real session with seven assessments is not treated as complete', async () => {
    const questions = Array.from({ length: 7 }, (_, index) => ({
        type: 1,
        word: `word-${index + 1}`,
        record_id: `word-record-${index + 1}`,

        cacheRecordId: `cache-${index + 1}`,
        source: 'question_cache',
        context: `Context ${index + 1}`,
        options: ['A', 'B', 'C', 'D'],
        answer: 'A',
        correctAnswer: 'A',
    }));
    const assessments = questions.map((question, index) => ({
        id: `assessment-${index + 1}`,
        test_id: 'real-legacy-seven',
        word_snapshot: question.word,
        source_word_record_id: question.record_id,
        submitted_answer: 'A',
        answer_confidence: 'sure',
        correct_answer: 'A',
        is_correct: 'correct',
    }));
    const dataSource = loadDataSource({
        supabaseExports: {
            getQuizSession: async () => ({ questions }),
            getAssessmentsForTest: async () => assessments,
        },
    });

    await assert.rejects(
        dataSource.submitAnswers('qiuqiu', 'real-legacy-seven', questions.map(() => ({ option: 0, confidence: 'sure' }))),
        error => error.message === 'FORMAL_QUIZ_INCOMPLETE'
    );
});

test('formal progress updates authoritative challenge instead of legacy quiz session', async () => {
    const calls = [];
    const dataSource = loadDataSource({
        supabaseExports: {
            updateFormalQuizChallengeProgress: async (...args) => {
                calls.push(args);
                return { challenge_id: 'challenge-1', session_state: args[2] };
            },
            updateQuizSessionProgress: async () => { throw new Error('LEGACY_PROGRESS_MUST_NOT_BE_USED'); },
        },
    });
    const result = await dataSource.updateQuizSessionProgress('qiuqiu', 'real-authoritative-1', {
        currentQuestion: 5, answers: [{ option: 0 }],
    });
    assert.equal(result.challenge_id, 'challenge-1');
    assert.deepEqual(calls, [['qiuqiu', 'real-authoritative-1', { currentQuestion: 5, answers: [{ option: 0 }] }]]);
});

test('formal submission rejects ten-question fallback or cache-id-less sessions', async () => {
    const validQuestion = index => ({
        type: 1,
        word: `word-${index + 1}`,

        record_id: `word-record-${index + 1}`,
        cacheRecordId: `cache-${index + 1}`,
        source: 'question_cache',
        context: `Context ${index + 1}`,
        options: ['A', 'B', 'C', 'D'],
        answer: 'A',
        correctAnswer: 'A',
    });

    for (const questions of [
        Array.from({ length: 10 }, (_, index) => ({ ...validQuestion(index), source: 'live_fallback' })),
        Array.from({ length: 10 }, (_, index) => {
            const { cacheRecordId, ...question } = validQuestion(index);
            return question;
        }),
    ]) {
        const dataSource = loadDataSource({
            supabaseExports: {
                getQuizSession: async () => ({ questions }),
                getAssessmentsForTest: async () => [],
                submitAssessment: async () => {
                    throw new Error('SUBMISSION_REACHED');
                },
            },
        });

        await assert.rejects(
            dataSource.submitAnswers('qiuqiu', 'real-untrusted-cache', questions.map(() => ({ option: 0, confidence: 'sure' }))),
            error => error.message === 'FORMAL_QUIZ_CACHE_ONLY_REQUIRED'
        );
    }
});

test('formal submission rejects duplicate or missing meaning IDs before assessment writes', async () => {
    const question = index => ({
        type: 1,
        word: `word-${index + 1}`,
        record_id: `meaning-${index + 1}`,
        cacheRecordId: `cache-${index + 1}`,
        source: 'question_cache',
        options: ['A', 'B', 'C', 'D'],
        answer: 'A',
        correctAnswer: 'A',
    });
    for (const { testId, questions, expected } of [
        {
            testId: 'real-duplicate-meaning',
            questions: Array.from({ length: 10 }, (_, index) => ({
                ...question(index),
                record_id: index === 9 ? 'meaning-1' : `meaning-${index + 1}`,
            })),
            expected: 'FORMAL_QUIZ_DUPLICATE_MEANING_ID',
        },
        {
            testId: 'legacy-real-missing-meaning',
            questions: Array.from({ length: 10 }, (_, index) => {
                const { record_id, ...rest } = question(index);
                return rest;
            }),
            expected: 'FORMAL_QUIZ_MEANING_ID_REQUIRED',
        },
    ]) {
        let writes = 0;
        const dataSource = loadDataSource({
            supabaseExports: {
                getQuizSession: async () => ({ questions }),
                getAssessmentsForTest: async () => [],
                submitAssessment: async () => {
                    writes += 1;
                    return {};
                },
            },
        });
        await assert.rejects(
            dataSource.submitAnswers('qiuqiu', testId, questions.map(() => ({ option: 0 }))),
            error => error.message === expected
        );
        assert.equal(writes, 0);
    }
});

test('requesting real mode does not delete an active test session', async () => {

    const deletedSessions = [];
    const dataSource = loadDataSource({
        supabaseExports: {
            getActiveQuizSession: async () => ({
                test_id: 'test-active-session',
                questions: [{ type: 1, word: 'test-word' }],
            }),
            deleteQuizSession: async (user, testId) => {
                deletedSessions.push([user, testId]);
                return { deleted: 1 };
            },
        },
    });

    await dataSource.generateQuiz('qiuqiu', 'middle', 'real');

    assert.deepEqual(deletedSessions, []);
});
test('formal session recovery accepts only complete cache sessions and rejects invalid sources or meanings', () => {
    const dataSource = loadDataSource();
    const cachedQuestions = Array.from({ length: 10 }, (_, index) => ({
        type: 1,
        word: 'word-' + index,
        record_id: 'meaning-' + index,
        cacheRecordId: 'cache-' + index,
        source: 'question_cache',
    }));

    assert.equal(dataSource.isResumableQuizSession({
        test_id: 'real-valid',
        questions: cachedQuestions,
    }, 'real'), true);
    assert.equal(dataSource.isResumableQuizSession({
        test_id: 'test-old-live',
        questions: cachedQuestions,
    }, 'real'), false);
    assert.equal(dataSource.isResumableQuizSession({
        test_id: 'real-live',
        questions: cachedQuestions.map(({ cacheRecordId, ...question }) => question),
    }, 'real'), false);
    assert.equal(dataSource.isResumableQuizSession({
        test_id: 'real-partial',
        questions: cachedQuestions.slice(0, 9),
    }, 'real'), false);
    assert.equal(dataSource.isResumableQuizSession({
        test_id: 'real-empty',
        questions: [],
    }, 'real'), false);
    assert.equal(dataSource.isResumableQuizSession({
        test_id: 'real-fallback',
        questions: cachedQuestions.map(question => ({ ...question, source: 'live_fallback' })),
    }, 'real'), false);
    assert.equal(dataSource.isResumableQuizSession({
        test_id: 'real-duplicate',
        questions: cachedQuestions.map(question => ({ ...question, record_id: 'same-meaning' })),
    }, 'real'), false);
    assert.equal(dataSource.isResumableQuizSession({
        test_id: 'real-missing-meaning',
        questions: cachedQuestions.map(({ record_id, ...question }) => question),
    }, 'real'), false);
});
test('defaults DATA_SOURCE to supabase and exposes the unified interface', async () => {

    const dataSource = loadDataSource();

    assert.equal(dataSource.name, 'supabase');
    assert.equal(dataSource.DATA_SOURCE, 'supabase');
    assert.equal((await dataSource.getUserByUsername('qiuqiu')).source, 'supabase');
    assert.equal((await dataSource.getWordsForUser('qiuqiu'))[0].source, 'supabase');
    assert.equal((await dataSource.getAssessmentsForUser('qiuqiu'))[0].source, 'supabase');
    assert.equal((await dataSource.getQuestionCache('qiuqiu'))[0].source, 'supabase');
    assert.equal((await dataSource.submitAssessment({ username: 'qiuqiu' })).source, 'supabase');
    assert.equal((await dataSource.updateWordMastery('qiuqiu', 'apple', 'mastered')).source, 'supabase');
    assert.equal((await dataSource.incrementCacheUsedCount('cache-1')).source, 'supabase');
    assert.equal((await dataSource.addWord({ username: 'qiuqiu', word: 'apple', meaning: 'fruit' })).source, 'supabase');
});

test('DATA_SOURCE=supabase never falls back to Feishu for updateWord', async () => {
    const dataSource = loadDataSource({
        envValue: 'supabase',
        feishuExports: { updateWord: async () => ({ source: 'feishu' }) },
    });
    assert.throws(() => dataSource.updateWord('qiuqiu', 'apple', {}), /supabaseData\.updateWord is not a function/);
});


test('WORDBOT_CACHE_SOURCE=feishu reads the Feishu cache while keeping Supabase data source', async () => {
    const dataSource = loadDataSource({ cacheSource: 'feishu', feishuExports: { getRecords: async () => [{ record_id: 'feishu-1', fields: { user: 'qiuqiu' } }] } });
    assert.deepEqual(await dataSource.getQuestionCache('qiuqiu'), [{ record_id: 'feishu-1', fields: { user: 'qiuqiu' } }]);
});

test('WORDBOT_CACHE_SOURCE=compare returns Feishu cache rows and records a bounded comparison', async () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = message => warnings.push(String(message));
    try {
        const dataSource = loadDataSource({
            cacheSource: 'compare',
            supabaseExports: { getQuestionCache: async () => [{ id: 'db-1' }] },
            feishuExports: { getRecords: async () => [{ record_id: 'feishu-1', fields: { user: 'qiuqiu' } }] },
        });
        assert.deepEqual(await dataSource.getQuestionCache('qiuqiu'), [{ record_id: 'feishu-1', fields: { user: 'qiuqiu' } }]);
        assert.match(warnings.join(' '), /question_cache compare/);
        assert.doesNotMatch(warnings.join(' '), /feishu-1|db-1/);
    } finally {
        console.warn = originalWarn;
    }
});

test('WORDBOT_CACHE_SOURCE=compare keeps Feishu cache when the DB comparison fails', async () => {
    const dataSource = loadDataSource({
        cacheSource: 'compare',
        supabaseExports: { getQuestionCache: async () => { throw new Error('db unavailable'); } },
        feishuExports: { getRecords: async () => [{ record_id: 'feishu-1', fields: { user: 'qiuqiu' } }] },
    });
    assert.deepEqual(await dataSource.getQuestionCache('qiuqiu'), [{ record_id: 'feishu-1', fields: { user: 'qiuqiu' } }]);
});
test('supabase data source reads stats from Supabase instead of Feishu fallback', async () => {
    const dataSource = loadDataSource({
        supabaseExports: {
            getStats: async username => ({ source: 'supabase-stats', user: username }),
            getAllStats: async () => [{ source: 'supabase-all-stats' }],
        },
        feishuExports: {
            getStats: async username => ({ source: 'feishu-stats', user: username }),
            getAllStats: async () => [{ source: 'feishu-all-stats' }],
        },
    });

    assert.deepEqual(await dataSource.getStats('qiuqiu'), {
        source: 'supabase-stats',
        user: 'qiuqiu',
    });
    assert.deepEqual(await dataSource.getAllStats(), [{ source: 'supabase-all-stats' }]);
});

test('DATA_SOURCE=supabase routes addWords to supabase adapter instead of Feishu fallback', async () => {
    const dataSource = loadDataSource({
        envValue: 'supabase',
        supabaseExports: {
            addWords: async (...args) => ({ source: 'supabase-addWords', args }),
        },
        feishuExports: {
            addWords: async (...args) => ({ source: 'feishu-addWords', args }),
        },
    });

    const result = await dataSource.addWords('qiuqiu', [{ word: 'apple', meaning: 'fruit' }], {
        skipDuplicateWords: true,
    });

    assert.equal(result.source, 'supabase-addWords');
    assert.deepEqual(result.args, ['qiuqiu', [{ word: 'apple', meaning: 'fruit' }], { skipDuplicateWords: true }]);
});

test('DATA_SOURCE=feishu routes high-level quiz and submit functions to feishu.js', async () => {
    const dataSource = loadDataSource({ envValue: 'feishu' });

    assert.equal(dataSource.name, 'feishu');
    assert.deepEqual(await dataSource.generateQuiz('qiuqiu', 'middle', 'real'), {
        source: 'feishu-generate',
        args: ['qiuqiu', 'middle', 'real'],
    });
    assert.deepEqual(await dataSource.submitAnswers('qiuqiu', 'test-1', [{ option: 0 }]), {
        source: 'feishu-submit',
        args: ['qiuqiu', 'test-1', [{ option: 0 }]],
    });
});

test('supabase quiz generation stores questions for submitAnswers routing', async () => {
    const dataSource = loadDataSource({
        supabaseExports: {
            getUserByUsername: async username => ({ username }),
            getWordsForUser: async () => Array.from({ length: 10 }, (_, index) => ({
                id: `word-${index + 1}`,
                feishu_record_id: `rec-word-${index + 1}`,
                word: `word${index + 1}`,
                meaning_en: `meaning ${index + 1}`,
                level: 'middle',
                entered_at: '2026-01-01T00:00:00.000Z',
            })),
            getAssessmentsForUser: async () => [],
            getQuestionCache: async () => formalCacheRows(10),
            submitAssessment: async input => ({ id: 'assessment-1', ...input }),
            updateWordMastery: async () => [],
            incrementCacheUsedCount: async () => ({}),
        },
    });

    const quiz = await dataSource.generateQuiz('qiuqiu', 'middle', 'real');
    const result = await dataSource.submitAnswers(
        'qiuqiu',
        quiz.testId,
        quiz.questions.map(() => ({ option: 0, confidence: 'sure' }))
    );

    assert.equal(quiz.source, 'question_cache');
    assert.equal(quiz.diagnostics.dataSource, 'supabase');
    assert.equal(result.correct, 10);
    assert.equal(result.total, 10);
});

test('generateQuiz closes an already-submitted active challenge before creating a fresh formal challenge', async () => {
    const staleQuestions = Array.from({ length: 10 }, (_, index) => ({
        type: 1, word: `stale-${index + 1}`, record_id: `meaning-${index + 1}`,
        cacheRecordId: `cache-${index + 1}`, source: 'question_cache',
        context: `Stale sentence ${index + 1}.`, options: ['A', 'B', 'C', 'D'], answer: 'A', correctAnswer: 'A',
    }));
    const persistedAssessments = staleQuestions.map((question, index) => ({
        id: `assessment-${index + 1}`, test_id: 'real-stale-challenge', word_snapshot: question.word,
        source_word_record_id: question.record_id, submitted_answer: 'A', correct_answer: 'A',
        is_correct: 'correct', assessed_at: new Date().toISOString(),
    }));
    let challengeActive = true;
    const closedChallenges = [];
    const dataSource = loadDataSource({
        supabaseExports: {
            getActiveFormalQuizChallenge: async () => challengeActive ? {
                test_id: 'real-stale-challenge', challenge_id: 'challenge-stale', questions: staleQuestions,
            } : null,
            getAssessmentsForUser: async () => persistedAssessments,
            completeFormalQuizChallenge: async (...args) => {
                closedChallenges.push(args);
                challengeActive = false;
                return { test_id: args[1], status: 'submitted' };
            },
            getActiveQuizSession: async () => null,
            getWordsForUser: async () => formalWordRows(10),
            getQuestionCache: async () => formalCacheRows(10),
            createFormalQuizChallenge: async input => ({ challenge_id: 'challenge-fresh', test_id: input.testId }),
        },
    });

    const quiz = await dataSource.generateQuiz('qiuqiu', 'middle', 'real');

    assert.deepEqual(closedChallenges, [['qiuqiu', 'real-stale-challenge']]);
    assert.notEqual(quiz.testId, 'real-stale-challenge');
    assert.equal(quiz.questions.length, 10);
});

test('formal submission replaces a void question from the same meaning cache pair before closing the challenge', async () => {
    const calls = [];
    const dataSource = loadDataSource({
        supabaseExports: {
            getUserByUsername: async username => ({ username }),
            getWordsForUser: async () => formalWordRows(10),
            getAssessmentsForUser: async () => [],
            getQuestionCache: async () => formalCacheRows(10).map(row => ({
                ...row,
                word_record_id: row.source_word_record_id,
                context_cn: row.context_zh,
                ...(row.variant_slot === 2
                    ? { cache_state: 'reserved_next_day', available_from: '2020-01-01T00:00:00.000Z' }
                    : {}),
            })),
            submitAssessments: async inputs => {
                calls.push(['submitAssessments', inputs]);
                return inputs.map(input => ({ id: `assessment-${input.sourceWordRecordId}`, ...input }));
            },
            updateWordMastery: async (...args) => calls.push(['updateWordMastery', args]),
            incrementCacheUsedCount: async cacheId => calls.push(['incrementCacheUsedCount', cacheId]),
            invalidateFormalQuizQuestion: async input => {
                calls.push(['invalidateFormalQuizQuestion', input]);
                return { invalidated: true, replacement_required: true };
            },
            replaceFormalQuizQuestion: async input => {
                calls.push(['replaceFormalQuizQuestion', input]);
                return { replaced: true, cache_question_id: input.cacheQuestionId };
            },
        },
    });

    const quiz = await dataSource.generateQuiz('qiuqiu', 'middle', 'real');
    const bad = quiz.questions[0];
    bad.id = 'challenge-question-1';
    bad.answer = '';
    bad.correctAnswer = '';
    const result = await dataSource.submitAnswers(
        'qiuqiu',
        quiz.testId,
        quiz.questions.map(() => ({ option: 0, confidence: 'sure' }))
    );

    assert.equal(result.replacementRequired, true);
    assert.equal(result.code, 'FORMAL_QUESTION_REPLACED');
    assert.equal(Array.isArray(result.replacementQuestions), true);
    assert.equal(result.replacementQuestions.length, 1);
    assert.equal(result.replacementQuestions[0].cacheRecordId, 'cache-1-2');
    assert.notEqual(result.replacementQuestions[0].cacheRecordId, bad.cacheRecordId);
    assert.equal(calls.some(([name]) => name === 'invalidateFormalQuizQuestion'), true);
    assert.equal(calls.some(([name]) => name === 'replaceFormalQuizQuestion'), true);
    assert.equal(calls.some(([name, cacheId]) => name === 'incrementCacheUsedCount' && cacheId === bad.cacheRecordId), false);
});

test('formal submission does not use a reserved replacement before its availability time', async () => {
    const calls = [];
    const dataSource = loadDataSource({
        supabaseExports: {
            getUserByUsername: async username => ({ username }),
            getWordsForUser: async () => formalWordRows(10),
            getAssessmentsForUser: async () => [],
            getQuestionCache: async () => formalCacheRows(10).map(row => ({
                ...row,
                word_record_id: row.source_word_record_id,
                context_cn: row.context_zh,
                ...(row.variant_slot === 2
                    ? { cache_state: 'reserved_next_day', available_from: '2999-01-01T00:00:00.000Z' }
                    : {}),
            })),
            submitAssessments: async inputs => {
                calls.push(['submitAssessments', inputs]);
                return inputs.map(input => ({ id: `assessment-${input.sourceWordRecordId}`, ...input }));
            },
            updateWordMastery: async (...args) => calls.push(['updateWordMastery', args]),
            incrementCacheUsedCount: async cacheId => calls.push(['incrementCacheUsedCount', cacheId]),
            invalidateFormalQuizQuestion: async input => {
                calls.push(['invalidateFormalQuizQuestion', input]);
                return { invalidated: true, replacement_required: true };
            },
            replaceFormalQuizQuestion: async input => calls.push(['replaceFormalQuizQuestion', input]),
        },
    });

    const quiz = await dataSource.generateQuiz('qiuqiu', 'middle', 'real');
    quiz.questions[0].id = 'challenge-question-1';
    quiz.questions[0].answer = '';
    quiz.questions[0].correctAnswer = '';
    const result = await dataSource.submitAnswers(
        'qiuqiu',
        quiz.testId,
        quiz.questions.map(() => ({ option: 0, confidence: 'sure' }))
    );

    assert.equal(result.code, 'FORMAL_REPLACEMENT_NOT_READY');
    assert.equal(result.replacementQuestions.length, 0);
    assert.equal(calls.some(([name]) => name === 'replaceFormalQuizQuestion'), false);
});

test('supabase quiz generation falls back to memory when quiz_sessions table is missing', async () => {
    const missingTableError = new Error("Could not find the table 'public.quiz_sessions' in the schema cache");
    missingTableError.code = 'PGRST205';
    const dataSource = loadDataSource({
        supabaseExports: {
            getUserByUsername: async username => ({ username }),
            getWordsForUser: async () => Array.from({ length: 10 }, (_, index) => ({
                id: `word-${index + 1}`,
                feishu_record_id: `rec-word-${index + 1}`,
                word: `word${index + 1}`,
                meaning_en: `meaning ${index + 1}`,
                level: 'middle',
                entered_at: '2026-01-01T00:00:00.000Z',
            })),
            getAssessmentsForUser: async () => [],
            getQuestionCache: async () => formalCacheRows(10),
            saveQuizSession: async () => {
                throw missingTableError;
            },
            submitAssessment: async input => ({ id: 'assessment-1', ...input }),
            updateWordMastery: async () => [],
            incrementCacheUsedCount: async () => ({}),
        },
    });

    const quiz = await dataSource.generateQuiz('qiuqiu', 'middle', 'real');
    const result = await dataSource.submitAnswers(
        'qiuqiu',
        quiz.testId,
        quiz.questions.map(() => ({ option: 0, confidence: 'sure' }))
    );

    assert.equal(quiz.source, 'question_cache');
    assert.equal(quiz.questions.length, 10);
    assert.equal(result.correct, 10);
    assert.equal(result.total, 10);
});

test('supabase submitAnswers restores questions from persisted session when memory is empty', async () => {
    const persistedQuestions = Array.from({ length: 10 }, (_, index) => ({
        type: 1,
        word: `word${index + 1}`,
        record_id: `rec-word-${index + 1}`,
        level: 'middle',
        context: `I learned word${index + 1} today.`,
        options: [`A. word${index + 1}`, 'B. pear', 'C. desk', 'D. chair'],
        answer: 'A',
        correctAnswer: 'A',
        source: 'question_cache',
        cacheRecordId: `cache-${index + 1}`,
    }));
    const calls = [];
    const dataSource = loadDataSource({
        supabaseExports: {
            getQuizSession: async (username, testId) => {
                calls.push(['getQuizSession', username, testId]);
                return { questions: persistedQuestions };
            },
            deleteQuizSession: async (username, testId) => {
                calls.push(['deleteQuizSession', username, testId]);
                return { deleted: 1 };
            },
            submitAssessment: async input => ({ id: 'assessment-1', ...input }),
            updateWordMastery: async () => [],
            incrementCacheUsedCount: async () => ({}),
        },
    });

    const result = await dataSource.submitAnswers(
        'Qiu Qiu',
        'quiz-after-restart',
        persistedQuestions.map(() => ({ option: 0, confidence: 'sure' }))
    );

    assert.equal(result.correct, 10);
    assert.equal(result.total, 10);
    assert.deepEqual(calls, [
        ['getQuizSession', 'Qiu Qiu', 'quiz-after-restart'],
        ['deleteQuizSession', 'Qiu Qiu', 'quiz-after-restart'],
    ]);
});

test('formal submit fails closed when challenge storage is available but the challenge is missing', async () => {
    const legacyReads = [];
    const persistedQuestions = Array.from({ length: 10 }, (_, index) => ({
        type: 1,
        word: `word${index + 1}`,
        record_id: `meaning-${index + 1}`,
        level: 'middle',
        context: `I learned word${index + 1} today.`,
        options: [`A. word${index + 1}`, 'B. pear', 'C. desk', 'D. chair'],
        answer: 'A',
        correctAnswer: 'A',
        source: 'question_cache',
        cacheRecordId: `cache-${index + 1}`,
    }));
    const dataSource = loadDataSource({
        supabaseExports: {
            getFormalQuizChallenge: async () => null,
            getQuizSession: async (...args) => {
                legacyReads.push(args);
                return { questions: persistedQuestions };
            },
        },
    });

    await assert.rejects(
        dataSource.submitAnswers(
            'Qiu Qiu',
            'real-missing-authoritative-challenge',
            persistedQuestions.map(() => ({ option: 0 }))
        ),
        error => error.message === 'FORMAL_CHALLENGE_NOT_FOUND'
    );
    assert.deepEqual(legacyReads, []);
});

test('supabase quiz session survives data-source module reload smoke path', async () => {
    const sessionStore = new Map();
    const quizRows = {
        getUserByUsername: async username => ({ username }),
        getWordsForUser: async () => Array.from({ length: 10 }, (_, index) => ({
            id: `word-${index + 1}`,
            feishu_record_id: `rec-word-${index + 1}`,
            word: `word${index + 1}`,
            meaning_en: `meaning ${index + 1}`,
            level: 'middle',
            entered_at: '2026-01-01T00:00:00.000Z',
        })),
        getAssessmentsForUser: async () => [],
        getQuestionCache: async () => formalCacheRows(10),
        saveQuizSession: async (username, testId, questions) => {
            sessionStore.set(`${username}:${testId}`, { username, testId, questions });
            return { test_id: testId, questions };
        },
        cleanupExpiredQuizSessions: async () => ({ deleted: 0 }),
        submitAssessment: async input => ({ id: 'assessment-1', ...input }),
        updateWordMastery: async () => [],
        incrementCacheUsedCount: async () => ({}),
    };
    const firstProcess = loadDataSource({ supabaseExports: quizRows });

    const quiz = await firstProcess.generateQuiz('qiuqiu', 'middle', 'real');
    const secondProcess = loadDataSource({
        supabaseExports: {
            ...quizRows,
            getQuizSession: async (username, testId) => sessionStore.get(`${username}:${testId}`) || null,
            deleteQuizSession: async (username, testId) => {
                const deleted = sessionStore.delete(`${username}:${testId}`) ? 1 : 0;
                return { deleted };
            },
        },
    });
    const result = await secondProcess.submitAnswers(
        'qiuqiu',
        quiz.testId,
        quiz.questions.map(() => ({ option: 0, confidence: 'sure' }))
    );

    assert.equal(result.correct, 10);
    assert.equal(result.total, 10);
    assert.equal(sessionStore.has(`qiuqiu:${quiz.testId}`), false);
});
test('repeated submit after the first request deletes the session returns the stored result without new assessments', async () => {
    const questions = Array.from({ length: 10 }, (_, index) => ({
        type: 1,
        word: `word${index + 1}`,
        cacheRecordId: `cache-${index + 1}`,
        record_id: `rec-word-${index + 1}`,
        source: 'question_cache',
        context: `Context ${index + 1}`,
        options: ['A', 'B', 'C', 'D'],
        answer: 'A',
        correctAnswer: 'A',
    }));
    let sessionAvailable = true;
    const assessments = [];
    const dataSource = loadDataSource({
        supabaseExports: {
            getQuizSession: async () => sessionAvailable ? { questions } : null,
            getAssessmentsForUser: async () => assessments,
            submitAssessment: async input => {
                const record = {
                    id: `assessment-${assessments.length + 1}`,
                    test_id: input.testId,
                    word_snapshot: input.word,
                    source_word_record_id: input.sourceWordRecordId,
                    submitted_answer: input.yourAnswer,
                    answer_confidence: input.confidence,
                    correct_answer: input.correctAnswer,
                    is_correct: input.correctness,
                    assessed_at: new Date().toISOString(),
                };
                assessments.push(record);
                return record;
            },
            deleteQuizSession: async () => {
                sessionAvailable = false;
                return { deleted: 1 };
            },
            updateWordMastery: async () => [],
            incrementCacheUsedCount: async () => ({}),
        },
    });
    const answers = questions.map(() => ({ option: 0, confidence: 'sure' }));

    const firstResult = await dataSource.submitAnswers('qiuqiu', 'real-repeat-submit', answers);
    const secondResult = await dataSource.submitAnswers('qiuqiu', 'real-repeat-submit', answers);

    assert.equal(firstResult.alreadySubmitted, false);
    assert.equal(secondResult.alreadySubmitted, true);
    assert.equal(secondResult.total, 10);
    assert.equal(secondResult.correct, 10);
    assert.equal(assessments.length, 10);
});

test('formal submission closes the authoritative challenge, including an idempotent re-submit', async () => {
    const questions = Array.from({ length: 10 }, (_, index) => ({
        type: 1,
        word: `word${index + 1}`,
        cacheRecordId: `cache-${index + 1}`,
        record_id: `rec-word-${index + 1}`,
        source: 'question_cache',
        context: `Context ${index + 1}`,
        options: ['A', 'B', 'C', 'D'],
        answer: 'A',
        correctAnswer: 'A',
    }));
    const assessments = [];
    const closedChallenges = [];
    const dataSource = loadDataSource({
        supabaseExports: {
            getFormalQuizChallenge: async () => ({ questions }),
            getAssessmentsForUser: async () => assessments,
            submitAssessment: async input => {
                const record = {
                    id: `assessment-${assessments.length + 1}`,
                    test_id: input.testId,
                    word_snapshot: input.word,
                    source_word_record_id: input.sourceWordRecordId,
                    submitted_answer: input.yourAnswer,
                    answer_confidence: input.confidence,
                    correct_answer: input.correctAnswer,
                    is_correct: input.correctness,
                    assessed_at: new Date().toISOString(),
                };
                assessments.push(record);
                return record;
            },
            completeFormalQuizChallenge: async (...args) => {
                closedChallenges.push(args);
                return { test_id: args[1], status: 'submitted' };
            },
            updateWordMastery: async () => [],
            incrementCacheUsedCount: async () => ({}),
        },
    });
    const answers = questions.map(() => ({ option: 0, confidence: 'sure' }));

    await dataSource.submitAnswers('qiuqiu', 'real-close-challenge', answers);
    await dataSource.submitAnswers('qiuqiu', 'real-close-challenge', answers);

    assert.deepEqual(closedChallenges, [
        ['qiuqiu', 'real-close-challenge'],
        ['qiuqiu', 'real-close-challenge'],
    ]);
    assert.equal(assessments.length, 10);
});

test('partial persisted assessment resumes the same session without inserting the completed question twice', async () => {
    const questions = [
        { type: 1, word: 'word1', record_id: 'rec-word-1', context: 'Context 1', options: ['A', 'B', 'C', 'D'], answer: 'A', correctAnswer: 'A' },
        { type: 1, word: 'word2', record_id: 'rec-word-2', context: 'Context 2', options: ['A', 'B', 'C', 'D'], answer: 'A', correctAnswer: 'A' },
    ];
    const assessments = [{
        id: 'assessment-1',
        test_id: 'test-partial-submit',
        word_snapshot: 'word1',
        source_word_record_id: 'rec-word-1',
        submitted_answer: 'A',
        answer_confidence: 'sure',
        correct_answer: 'A',
        is_correct: 'correct',
    }];
    let sessionAvailable = true;
    const inserted = [];
    const dataSource = loadDataSource({
        supabaseExports: {
            getQuizSession: async () => sessionAvailable ? { questions } : null,
            getAssessmentsForTest: async () => assessments,
            submitAssessment: async input => {
                const record = { ...assessments[0], id: 'assessment-2', word_snapshot: input.word, source_word_record_id: input.sourceWordRecordId, submitted_answer: input.yourAnswer, correct_answer: input.correctAnswer, is_correct: input.correctness };
                assessments.push(record);
                inserted.push(record);
                return record;
            },
            deleteQuizSession: async () => {
                sessionAvailable = false;
                return { deleted: 1 };
            },
            updateWordMastery: async () => [],
            incrementCacheUsedCount: async () => ({}),
        },
    });

    const result = await dataSource.submitAnswers(
        'qiuqiu',
        'test-partial-submit',
        [{ option: 0, confidence: 'sure' }, { option: 0, confidence: 'sure' }]
    );

    assert.equal(result.total, 2);
    assert.equal(result.correct, 2);
    assert.equal(inserted.length, 1);
    assert.equal(assessments.length, 2);
    assert.equal(sessionAvailable, false);
});

test('missing session with partial persisted assessment returns an explicit incomplete error', async () => {
    const dataSource = loadDataSource({
        supabaseExports: {
            getQuizSession: async () => null,
            getAssessmentsForTest: async () => [{
                id: 'assessment-1',
                test_id: 'real-missing-partial',
                source_word_record_id: 'rec-word-1',
                word_snapshot: 'word1',
                submitted_answer: 'A',
                answer_confidence: 'sure',
                correct_answer: 'A',
                is_correct: 'correct',
            }],
        },
    });

    await assert.rejects(
        dataSource.submitAnswers('qiuqiu', 'real-missing-partial', []),
        error => error.message === 'QUIZ_SUBMISSION_INCOMPLETE'
    );
});

test('missing session with no persisted assessments still returns QUIZ_SESSION_NOT_FOUND', async () => {
    const dataSource = loadDataSource({
        supabaseExports: {
            getQuizSession: async () => null,
            getAssessmentsForUser: async () => [],
        },
    });

    await assert.rejects(
        dataSource.submitAnswers('qiuqiu', 'real-missing-session', []),
        error => error.message === 'QUIZ_SESSION_NOT_FOUND'
    );
});

test('supabase submit idempotency reads only assessments for the submitted test id', async () => {
    const questions = Array.from({ length: 10 }, (_, index) => ({
        type: 1,
        word: `word${index + 1}`,
        cacheRecordId: `cache-${index + 1}`,
        record_id: `rec-word-${index + 1}`,
        source: 'question_cache',
        context: `Context ${index + 1}`,
        options: ['A', 'B', 'C', 'D'],
        answer: 'A',
        correctAnswer: 'A',
    }));
    const calls = [];
    const dataSource = loadDataSource({
        supabaseExports: {
            getQuizSession: async () => ({ questions }),
            getAssessmentsForTest: async (username, testId) => {
                calls.push(['getAssessmentsForTest', username, testId]);
                return [];
            },
            getMasteryAssessmentsForWords: async (username, sourceWordRecordIds) => {
                calls.push(['getMasteryAssessmentsForWords', username, sourceWordRecordIds]);
                return [];
            },
            getAssessmentsForUser: async () => {
                throw new Error('full user assessment scan should not run during submit');
            },
            submitAssessment: async input => ({
                id: `assessment-${input.sourceWordRecordId}`,
                test_id: input.testId,
                word_snapshot: input.word,
                source_word_record_id: input.sourceWordRecordId,
                submitted_answer: input.yourAnswer,
                answer_confidence: input.confidence,
                correct_answer: input.correctAnswer,
                is_correct: input.correctness,
                assessed_at: new Date().toISOString(),
            }),
            deleteQuizSession: async () => ({ deleted: 1 }),
            updateWordMastery: async () => [],
            incrementCacheUsedCount: async () => ({}),
        },
    });

    const result = await dataSource.submitAnswers(
        'qiuqiu',
        'real-fast-submit',
        questions.map(() => ({ option: 0, confidence: 'sure' }))
    );

    assert.equal(result.total, 10);
    assert.ok(calls.some(call => call[0] === 'getAssessmentsForTest'));
});

test('supabase mode uses supabase review functions instead of Feishu fallback', async () => {
    const dataSource = loadDataSource({
        envValue: 'supabase',
        supabaseExports: {
            createReviewRound: async input => ({ source: 'supabase-review', input }),
            prebuildWrongQuestionCache: async input => ({ source: 'supabase-wrong-cache', input }),
        },
        feishuExports: {
            createReviewRound: async input => ({ source: 'feishu-review', input }),
            prebuildWrongQuestionCache: async input => ({ source: 'feishu-wrong-cache', input }),
        },
    });

    assert.equal((await dataSource.createReviewRound({ userId: 'qiuqiu', sourceTestId: 'real-1' })).source, 'supabase-review');
    assert.equal((await dataSource.prebuildWrongQuestionCache({ userId: 'qiuqiu', testId: 'real-1', result: {} })).source, 'supabase-wrong-cache');
});
test('formal recovery does not resume legacy real sessions when challenge storage is unavailable', async () => {
    const questions = Array.from({ length: 10 }, (_, index) => ({
        type: 1, word: `legacy-missing-table-${index + 1}`, record_id: `meaning-${index + 1}`,
        cacheRecordId: `cache-${index + 1}`, source: 'question_cache',
        options: ['A', 'B', 'C', 'D'], answer: 'A', context: `Legacy ${index + 1}.`,
    }));
    const missingChallengeTable = new Error("Could not find the table 'public.quiz_challenges' in the schema cache");
    let legacySessionReads = 0;
    const dataSource = loadDataSource({
        supabaseExports: {
            getActiveFormalQuizChallenge: async () => { throw missingChallengeTable; },
            getActiveQuizSession: async () => {
                legacySessionReads += 1;
                return { test_id: 'real-legacy-missing-table', questions };
            },
        },
    });

    const quiz = await dataSource.generateQuiz('qiuqiu', 'middle', 'real');

    assert.equal(quiz.testId, undefined);
    assert.equal(quiz.code, 'FORMAL_CHALLENGE_NOT_READY');
    assert.deepEqual(quiz.questions, []);
    assert.equal(quiz.diagnostics.fallbackUsed, false);
    assert.equal(legacySessionReads, 0, 'formal challenge storage failure must not fall through to legacy quiz_sessions');
});
