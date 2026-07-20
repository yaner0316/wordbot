const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const BACKEND_DIR = path.join(__dirname, '..');
const SERVER_PATH = path.join(BACKEND_DIR, 'server.js');
const FEISHU_PATH = path.join(BACKEND_DIR, 'feishu.js');

async function withServer(app, run) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const { port } = server.address();
    try {
        await run(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

function clearBackendModules() {
    for (const key of Object.keys(require.cache)) {
        if (key.startsWith(BACKEND_DIR)) {
            delete require.cache[key];
        }
    }
}

function loadServerWithFeishu(fakeFeishu) {
    clearBackendModules();
    Object.assign(process.env, {
        DATA_SOURCE: 'feishu',
        FEISHU_APP_ID: 'test-app-id',
        FEISHU_APP_SECRET: 'test-app-secret',
        FEISHU_WORD_APP_TOKEN: 'word-app',
        FEISHU_WORD_TABLE_ID: 'word-table',
        FEISHU_TEST_APP_TOKEN: 'test-app',
        FEISHU_TEST_TABLE_ID: 'test-table',
        FEISHU_STATS_APP_TOKEN: 'stats-app',
        FEISHU_STATS_TABLE_ID: 'stats-table',
    });
    require.cache[FEISHU_PATH] = {
        id: FEISHU_PATH,
        filename: FEISHU_PATH,
        loaded: true,
        exports: fakeFeishu,
    };
    return require(SERVER_PATH).app;
}

const protectedRoutes = [
    'POST /api/quiz',
    'POST /api/submit',
    'POST /api/admin/addWords',
    'PUT /api/word',
    'GET /api/history/:user',
    'GET /api/stats/:user',
    'POST /api/reviews',
    'GET /api/reviews/active',
    'POST /api/reviews/:reviewId/submit',
    'POST /api/reviews/:reviewId/defer',
    'GET /api/reviews/summary',
];

function createFakeFeishu(overrides = {}) {
    return {
        registerUser: async () => ({ success: true }),
        loginUser: async () => ({ success: true }),
        generateQuiz: async (user, level, mode) => ({
            testId: 'real-contract-quiz',
            mode,
            level,
            questions: [{ word: 'apple', options: ['A. apple'] }],
        }),
        submitAnswers: async (user, testId, answers) => ({
            alreadySubmitted: false,
            results: [],
            correct: 0,
            total: answers.length,
            accuracy: '0.0%',
        }),
        createReviewRound: async input => ({ reviewId: 'real-review-r1', input, questions: [] }),
        getActiveReviewRound: async () => ({ active: false }),
        submitReviewRound: async input => ({ success: true, input }),
        deferReviewRound: async input => ({ success: true, input }),
        getReviewSummary: async () => ({ active: false, pending: 0 }),
        getStats: async user => ({
            user,
            totalWords: 2,
            masteredWords: 1,
            pendingWords: 1,
            totalTests: 1,
            totalQuestions: 10,
            correctCount: 8,
            accuracyRate: '80.0%',
            lastTestTime: 123,
        }),
        addWord: async () => ({ success: true }),
        getAllUsers: async () => ['student'],
        getAllStats: async () => [],
        getUserLearningSettings: async () => ({ learningLevel: '中学' }),
        updateUserLearningSettings: async () => ({ success: true }),
        getQuestionCacheStatus: async () => ({ ready: 0 }),
        rebuildQuestionCacheForUser: async () => ({ success: true }),
        validateWords: async words => ({ valid: words }),
        addWords: async (targetUser, words) => ({ success: true, targetUser, count: words.length }),
        updateMultiDefinition: async () => ({ success: true }),
        getWord: async (userId, word) => ({ exists: true, userId, word }),
        updateWord: async (userId, word, fields) => ({ success: true, userId, word, fields }),
        deleteWord: async () => ({ success: true }),
        deleteUserTestData: async () => ({ success: true }),
        getWordByRecordId: async recordId => ({ exists: true, recordId }),
        getReviewWords: async () => [],
        markWordForReview: async () => ({ success: true }),
        clearWordReview: async () => ({ success: true }),
        searchRecords: async () => [],
        getRecords: async () => [],
        ...overrides,
    };
}

test('protected route manifest stays explicit during data-layer migration', () => {
    assert.deepEqual(protectedRoutes, [
        'POST /api/quiz',
        'POST /api/submit',
        'POST /api/admin/addWords',
        'PUT /api/word',
        'GET /api/history/:user',
        'GET /api/stats/:user',
        'POST /api/reviews',
        'GET /api/reviews/active',
        'POST /api/reviews/:reviewId/submit',
        'POST /api/reviews/:reviewId/defer',
        'GET /api/reviews/summary',
    ]);
});

test('quiz endpoint preserves request delegation and response shape', async () => {
    const calls = [];
    const app = loadServerWithFeishu(createFakeFeishu({
        generateQuiz: async (...args) => {
            calls.push(args);
            return {
                testId: 'real-contract-quiz',
                mode: args[2],
                level: args[1],
                questions: [{ word: 'apple', answer: 'A' }],
            };
        },
    }));

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/quiz`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: 'student', level: '中学', mode: 'real' }),
        });
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.deepEqual(calls, [['student', '中学', 'real']]);
        assert.equal(body.testId, 'real-contract-quiz');
        assert.equal(body.mode, 'real');
        assert.equal(body.level, '中学');
        assert.ok(Array.isArray(body.questions));
    });
});

test('submit endpoint starts wrong-question cache prebuild in the background', async () => {
    const calls = [];
    const app = loadServerWithFeishu(createFakeFeishu({
        submitAnswers: async () => ({
            results: [{ correct: false, recordId: 'word-1' }],
            correct: 0,
            total: 1,
            accuracy: '0.0%',
        }),
        prebuildWrongQuestionCache: async input => {
            calls.push(input);
        },
    }));

    await withServer(app, async baseUrl => {
        const response = await fetch(baseUrl + '/api/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user: 'student',
                testId: 'real-contract-quiz',
                answers: [{ option: 1 }],
            }),
        });

        assert.equal(response.status, 200);
        assert.equal((await response.json()).correct, 0);
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(calls, [{
            userId: 'student',
            testId: 'real-contract-quiz',
            result: {
                results: [{ correct: false, recordId: 'word-1' }],
                correct: 0,
                total: 1,
                accuracy: '0.0%',
            },
        }]);
    });
});
test('parent addWords endpoint preserves payload contract', async () => {
    const calls = [];
    const app = loadServerWithFeishu(createFakeFeishu({
        addWords: async (...args) => {
            calls.push(args);
            return { success: true, count: args[1].length };
        },
    }));

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/admin/addWords`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetUser: 'student', words: ['apple', 'banana'] }),
        });

        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { success: true, count: 2 });
        assert.deepEqual(calls, [['student', ['apple', 'banana'], { confirmNewMeanings: false, skipDuplicateWords: false }]]);
    });
});

test('parent addWord endpoint forwards level and parts of speech payload', async () => {
    const calls = [];
    const app = loadServerWithFeishu(createFakeFeishu({
        addWord: async (...args) => {
            calls.push(args);
            return { success: true };
        },
    }));

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/admin/addWord`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetUser: 'student',
                word: 'orange',
                meaning: 'a citrus fruit',
                level: '中学',
                POS: ['noun'],
            }),
        });

        assert.equal(response.status, 200);
        assert.deepEqual(calls, [[
            'student',
            {
                Word: 'orange',
                Meaning: 'a citrus fruit',
                POS: ['noun'],
                Context: undefined,
                Level: '中学',
            },
        ]]);
    });
});

test('word update endpoint preserves status and field update payload', async () => {
    const calls = [];
    const app = loadServerWithFeishu(createFakeFeishu({
        updateWord: async (...args) => {
            calls.push(args);
            return { success: true };
        },
    }));

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/word`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: 'student',
                word: 'apple',
                status: 'Mastered',
                meaning: 'a fruit',
                context: 'I ate an apple.',
                distractors: ['orange', 'pear', 'peach'],
            }),
        });

        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { success: true });
        assert.deepEqual(calls, [[
            'student',
            'apple',
            {
                recordId: undefined,
                meaning: 'a fruit',
                cnMeaning: undefined,
                pos: undefined,
                context: 'I ate an apple.',
                distractors: ['orange', 'pear', 'peach'],
                status: 'Mastered',
                qualityFlags: undefined,
                qualityNote: undefined,
            },
        ]]);
    });
});


test('word delete endpoint can delete a selected duplicate row by record id', async () => {
    const calls = [];
    const app = loadServerWithFeishu(createFakeFeishu({
        deleteWord: async (...args) => {
            calls.push(args);
            return { success: true };
        },
    }));

    await withServer(app, async baseUrl => {
        const response = await fetch(baseUrl + '/api/word?recordId=rec-promotion-2', {
            method: 'DELETE',
        });

        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { success: true });
        assert.deepEqual(calls, [['', '', { recordId: 'rec-promotion-2' }]]);
    });
});

test('stats endpoint preserves response passthrough', async () => {
    const app = loadServerWithFeishu(createFakeFeishu());

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/stats/student`);
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.user, 'student');
        assert.equal(body.totalWords, 2);
        assert.equal(body.masteredWords, 1);
        assert.equal(body.pendingWords, 1);
    });
});

test('history endpoint preserves grouped history response shape', async () => {
    const app = loadServerWithFeishu(createFakeFeishu({
        getRecords: async table => {
            if (table.tableId === 'test-table') {
                return [{
                    record_id: 'test-row-1',
                    fields: {
                        user: 'student',
                        test_id: 'real-contract-quiz',
                        test_time: 123,
                        question_type: 2,
                        word: 'apple',
                        options: JSON.stringify(['A. apple', 'B. banana']),
                        your_answer: 'A|sure',
                        correct_answer: 'A',
                        is_correct: 'optHGT7gYf',
                    },
                }];
            }
            if (table.tableId === 'word-table') {
                return [{
                    record_id: 'word-1',
                    fields: {
                        user: 'student',
                        Word: 'apple',
                        Meaning: 'a fruit',
                        CN_Meaning: '苹果',
                        Context: 'I ate an apple.',
                    },
                }];
            }
            return [];
        },
    }));

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/history/student?mode=real`);
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.ok(Array.isArray(body.history));
        assert.equal(body.history.length, 1);
        assert.equal(body.history[0].testId, 'real-contract-quiz');
        assert.ok(Array.isArray(body.history[0].questions));
        assert.equal(body.history[0].questions[0].word, 'apple');
        assert.equal(body.history[0].questions[0].question, 'a fruit');
        assert.deepEqual(body.history[0].questions[0].options, ['A. apple', 'B. banana']);
        assert.equal(body.history[0].questions[0].yourAnswer, 'A');
        assert.equal(body.history[0].questions[0].correctAnswer, 'A');
        assert.equal(body.history[0].questions[0].isCorrect, true);
    });
});
test('history endpoint prefers the saved quiz context for fill-in records', async () => {
    const app = loadServerWithFeishu(createFakeFeishu({
        getRecords: async table => {
            if (table.tableId === 'test-table') {
                return [{
                    record_id: 'test-row-fill-in',
                    fields: {
                        user: 'student',
                        test_id: 'real-fill-in-quiz',
                        test_time: 456,
                        question_type: 1,
                        word: 'punish',
                        context: 'He was _____ for the mistake.',
                        options: JSON.stringify(['A. punished', 'B. rewarded']),
                        your_answer: 'A|sure',
                        correct_answer: 'A',
                        is_correct: 'optHGT7gYf',
                    },
                }];
            }
            if (table.tableId === 'word-table') {
                return [{
                    record_id: 'word-1',
                    fields: {
                        user: 'student',
                        Word: 'punish',
                        Meaning: 'to make someone suffer for doing wrong',
                        CN_Meaning: 'punish meaning in Chinese',
                        Context: 'The teacher may punish students for bad behavior.',
                    },
                }];
            }
            return [];
        },
    }));

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/history/student?mode=real`);
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.history[0].questions[0].question, 'He was _____ for the mistake.');
    });
});
test('saving unchanged learning level starts rebuild when selected level cache is not ready', async () => {
    const middleLevel = String.fromCharCode(0x4e2d, 0x5b66);
    const calls = [];
    let resolveRebuild;
    const rebuildPromise = new Promise(resolve => { resolveRebuild = resolve; });
    const app = loadServerWithFeishu(createFakeFeishu({
        updateUserLearningSettings: async (userId, learningLevel) => ({
            success: true,
            settings: { userId, learningLevel, questionCacheStatus: 'not_started' },
        }),
        getQuestionCacheStatus: async () => ({
            configured: true,
            byLevel: { [middleLevel]: { ready: 4, total: 4 } },
        }),
        rebuildQuestionCacheForUser: async userId => {
            calls.push(userId);
            return rebuildPromise;
        },
    }));

    await withServer(app, async baseUrl => {
        try {
            const response = await fetch(baseUrl + '/api/admin/userSettings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: 'Yusi', learningLevel: middleLevel }),
            });
            const body = await response.json();

            assert.equal(response.status, 200);
            assert.equal(body.success, true);
            await new Promise(resolve => setTimeout(resolve, 0));
            assert.deepEqual(calls, ['Yusi']);
        } finally {
            resolveRebuild({ success: true });
        }
    });
});
test('question cache rebuild endpoint starts background job without waiting for completion', async () => {
    let calledWith = null;
    let resolveRebuild;
    const rebuildPromise = new Promise(resolve => { resolveRebuild = resolve; });
    const app = loadServerWithFeishu(createFakeFeishu({
        rebuildQuestionCacheForUser: async userId => {
            calledWith = userId;
            return rebuildPromise;
        },
    }));

    await withServer(app, async baseUrl => {
        try {
            const responsePromise = fetch(`${baseUrl}/api/admin/questionCache/rebuild`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: 'Draggy' }),
            });
            const response = await Promise.race([
                responsePromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('timed out waiting for rebuild response')), 100)),
            ]);
            const body = await response.json();

            assert.equal(response.status, 202);
            assert.equal(body.started, true);
            assert.equal(body.userId, 'Draggy');
            assert.equal(calledWith, 'Draggy');
        } finally {
            resolveRebuild({ success: true });
        }
    });
});

test('question cache rebuild endpoint can flush selected cache type before rebuilding', async () => {
    const calls = [];
    let resolveRebuild;
    const rebuildPromise = new Promise(resolve => { resolveRebuild = resolve; });
    const app = loadServerWithFeishu(createFakeFeishu({
        deleteQuestionCacheRows: async (userId, type) => {
            calls.push(['flush', userId, type]);
            return { deleted: 7 };
        },
        rebuildQuestionCacheForUser: async userId => {
            calls.push(['rebuild', userId]);
            return rebuildPromise;
        },
    }));

    await withServer(app, async baseUrl => {
        try {
            const response = await fetch(`${baseUrl}/api/admin/questionCache/rebuild`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: 'draggy', flush: true, type: 1 }),
            });
            const body = await response.json();

            assert.equal(response.status, 202);
            assert.deepEqual(body.flushed, { deleted: 7 });
            assert.equal(body.started, true);
            assert.deepEqual(calls, [
                ['flush', 'draggy', 1],
                ['rebuild', 'draggy'],
            ]);
        } finally {
            resolveRebuild({ success: true });
        }
    });
});


test('quiz endpoint returns cache hit diagnostics', async () => {
    const app = loadServerWithFeishu(createFakeFeishu({
        generateQuiz: async () => ({
            testId: 'real-cache-hit',
            mode: 'real',
            level: '中学',
            source: 'question_cache',
            diagnostics: {
                cacheConfigured: true,
                cacheAttempted: true,
                level: '中学',
                readyCount: 12,
                requiredCount: 10,
                fallbackUsed: false,
                cacheReadLatencyMs: 42,
                liveGenerationLatencyMs: null,
                testRecordWriteLatencyMs: 123,
                cacheUsageWriteLatencyMs: 45,
            },
            questions: [{ word: 'apple', answer: 'A' }],
        }),
    }));

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/quiz`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: 'student', level: '中学', mode: 'real' }),
        });
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.source, 'question_cache');
        assert.equal(body.diagnostics.fallbackUsed, false);
        assert.equal(body.diagnostics.readyCount, 12);
    });
});

test('quiz endpoint returns live fallback diagnostics', async () => {
    const app = loadServerWithFeishu(createFakeFeishu({
        generateQuiz: async () => ({
            testId: 'real-live-generation',
            mode: 'real',
            level: '中学',
            source: 'live_generation',
            diagnostics: {
                cacheConfigured: true,
                cacheAttempted: true,
                level: '中学',
                readyCount: 7,
                requiredCount: 10,
                fallbackUsed: true,
                cacheReadLatencyMs: 30,
                liveGenerationLatencyMs: 15800,
            },
            questions: [{ word: 'apple', answer: 'A' }],
        }),
    }));

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/quiz`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: 'student', level: '中学', mode: 'real' }),
        });
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.source, 'live_generation');
        assert.equal(body.diagnostics.fallbackUsed, true);
        assert.equal(body.diagnostics.readyCount, 7);
        assert.equal(body.diagnostics.liveGenerationLatencyMs, 15800);
    });
});

test('quiz endpoint preserves cache-not-ready diagnostics on 503', async () => {
    const app = loadServerWithFeishu(createFakeFeishu({
        generateQuiz: async () => ({
            error: 'Question cache is still preparing. Please rebuild the question cache and try again.',
            code: 'QUESTION_CACHE_NOT_READY',
            source: 'question_cache',
            diagnostics: {
                cacheConfigured: true,
                cacheAttempted: true,
                level: '小学',
                readyCount: 3,
                requiredCount: 10,
                fallbackUsed: false,
                cacheReadLatencyMs: 18,
                liveGenerationLatencyMs: null,
                testRecordWriteLatencyMs: 123,
                cacheUsageWriteLatencyMs: 45,
            },
        }),
    }));

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/quiz`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: 'student', level: '小学', mode: 'real' }),
        });
        const body = await response.json();

        assert.equal(response.status, 503);
        assert.equal(body.code, 'QUESTION_CACHE_NOT_READY');
        assert.equal(body.source, 'question_cache');
        assert.equal(body.diagnostics.readyCount, 3);
        assert.equal(body.diagnostics.requiredCount, 10);
        assert.equal(body.diagnostics.fallbackUsed, false);
    });
});
test('validateWords endpoint forwards target user for duplicate-word checks', async () => {
    const calls = [];
    const app = loadServerWithFeishu(createFakeFeishu({
        validateWords: async (...args) => {
            calls.push(args);
            return { errors: [], multiMeanings: [], duplicateWords: [] };
        },
    }));

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/admin/validateWords`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetUser: 'student', words: [{ word: 'promotion', cnMeaning: '促销活动' }] }),
        });

        assert.equal(response.status, 200);
        assert.deepEqual(calls, [['student', [{ word: 'promotion', cnMeaning: '促销活动' }]]]);
    });
});

test('parent addWords endpoint returns 409 when duplicate confirmation is required', async () => {
    const app = loadServerWithFeishu(createFakeFeishu({
        addWords: async () => ({
            success: false,
            code: 'DUPLICATE_WORD_CONFIRMATION_REQUIRED',
            error: 'Duplicate word confirmation required',
            duplicateWords: [{ word: 'promotion', existing: [{ recordId: 'rec-1', cnMeaning: '晋升' }] }],
        }),
    }));

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/admin/addWords`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetUser: 'student', words: [{ word: 'promotion' }] }),
        });
        const body = await response.json();

        assert.equal(response.status, 409);
        assert.equal(body.code, 'DUPLICATE_WORD_CONFIRMATION_REQUIRED');
        assert.equal(body.duplicateWords[0].word, 'promotion');
    });
});


test('parent word library endpoint returns paginated words', async () => {
    const calls = [];
    const app = loadServerWithFeishu(createFakeFeishu({
        listUserWords: async (...args) => {
            calls.push(args);
            return {
                words: [
                    { record_id: 'rec-1', word: 'swing', cnMeaning: '秋千', status: 'Pending' },
                    { record_id: 'rec-2', word: 'climb', cnMeaning: '攀爬', status: 'Mastered' },
                ],
                page: 2,
                pageSize: 20,
                total: 31,
                totalPages: 2,
            };
        },
    }));

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/admin/words?userId=Draggy&page=2&pageSize=20&status=Pending`);
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.deepEqual(calls, [['Draggy', { page: 2, pageSize: 20, status: 'Pending' }]]);
        assert.equal(body.total, 31);
        assert.equal(body.totalPages, 2);
        assert.equal(body.words.length, 2);
        assert.equal(body.words[1].status, 'Mastered');
    });
});

test('review submit endpoint starts the next round prebuild in the background', async () => {
    const calls = [];
    const app = loadServerWithFeishu(createFakeFeishu({
        submitReviewRound: async () => ({
            reviewId: 'real-review-r1',
            sourceTestId: 'real-q1',
            remainingRecordIds: ['word-1'],
            reviewed: 1,
            correct: 0,
            total: 1,
        }),
        createReviewRound: async input => {
            calls.push(input);
            return { reviewId: 'real-review-r2', input, questions: [] };
        },
    }));

    await withServer(app, async baseUrl => {
        const response = await fetch(baseUrl + '/api/reviews/real-review-r1/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: 'student', answers: [{ text: 'wrong' }] }),
        });

        assert.equal(response.status, 200);
        assert.equal((await response.json()).reviewId, 'real-review-r1');
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(calls, [{
            userId: 'student',
            sourceTestId: 'real-q1',
            parentReviewId: 'real-review-r1',
        }]);
    });
});
