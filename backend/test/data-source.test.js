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

function loadDataSource({ envValue, supabaseExports = {}, feishuExports = {} } = {}) {
    clearBackendModules();
    const previous = process.env.DATA_SOURCE;
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
        if (previous === undefined) delete process.env.DATA_SOURCE;
        else process.env.DATA_SOURCE = previous;
    }
}

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
            })),
            getAssessmentsForUser: async () => [],
            getQuestionCache: async () => Array.from({ length: 10 }, (_, index) => ({
                id: `cache-${index + 1}`,
                feishu_record_id: `cache-rec-${index + 1}`,
                source_word_record_id: `rec-word-${index + 1}`,
                word: `word${index + 1}`,
                level: 'middle',
                round_type: 'primary',
                quality_status: 'ready',
                question_type: 1,
                question_text: `I learned word${index + 1} today.`,
                options: [`A. word${index + 1}`, 'B. pear', 'C. desk', 'D. chair'],
                answer: 'A',
                option_meanings: ['meaning', 'fruit', 'furniture', 'furniture'],
                correct_meaning: `meaning ${index + 1}`,
                used_count: 0,
            })),
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
