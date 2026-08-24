const test = require('node:test');
const assert = require('node:assert/strict');

const { generateQuizWithDataSource, toFeishuCacheRow } = require('../quiz-adapter');

const MIDDLE = String.fromCharCode(0x4e2d, 0x5b66);
const WORDS = ['repair', 'resilient', 'attic', 'distant', 'draggy', 'straight', 'attitude', 'careful', 'formal', 'ordinary', 'steady', 'patient'];

function word(index, extra = {}) {
    const value = WORDS[index - 1];
    return {
        id: `word-${index}`,
        feishu_record_id: `rec-${index}`,
        username: 'qiuqiu',
        word: value,
        meaning_en: `meaning ${index}`,
        meaning_zh: `中文释义${index}`,
        context_en: `A clear sentence uses ${value} in context.`,
        context_zh: `中文例句${index}`,
        distractors: ['alpha', 'bravo', 'charlie'],
        old_distractors: [],
        level: MIDDLE,
        mastery_status: 'pending',
        entered_at: new Date(2026, 0, index).toISOString(),
        ...extra,
    };
}

function cacheRow(index, variantSlot = 1) {
    return {
        id: `cache-${index}-${variantSlot}`,
        word_id: `word-${index}`,
        word_record_id: `rec-${index}`,
        word: WORDS[index - 1],
        username: 'qiuqiu',
        level: MIDDLE,
        round_type: 'primary',
        quality_status: 'ready',
        cache_state: 'active',
        variant_slot: variantSlot,
        question_fingerprint: `fp-${index}-${variantSlot}`,
        question_type: '1',
        question_text: `Variant ${variantSlot} uses _____ naturally in context.`,
        context_zh: `\u8fd9\u662f\u7b2c${index}\u9053\u7ec3\u4e60\u4e2d\u7684\u5b8c\u6574\u4e2d\u6587\u53e5\u5b50\u3002`,
        options: [`A. ${WORDS[index - 1]}`, `B. alpha-${variantSlot}`, `C. bravo-${variantSlot}`, `D. charlie-${variantSlot}`],
        answer: 'A',
        option_meanings: ['中文释义', '阿尔法', '布拉沃', '查理'],
        correct_meaning: `中文释义${index}`,
        used_count: 0,
        generated_at: new Date(2026, 1, index).toISOString(),
    };
}

test('Supabase cache projection preserves approved AI audit status', () => {
    const projected = toFeishuCacheRow({
        ...cacheRow(1),
        ai_audit_status: 'approved',
    }, { username: 'qiuqiu' });

    assert.equal(projected.fields.ai_audit_status, 'approved');
});

test('meaning fallback uses a concise Chinese sense when the stored meaning is too long', async () => {
    const words = Array.from({ length: 12 }, (_, index) => word(index + 1, {
        meaning_zh: '这是一个非常详细的中文释义，用来描述这个单词的含义、使用场景、语法特点和常见搭配，帮助学习者理解这个词；第二个释义；第三个释义',
    }));
    const dataSource = {
        name: 'supabase',
        getUserByUsername: async () => ({ username: 'qiuqiu', username_key: 'qiuqiu' }),
        getWordsForUser: async () => words,
        getAssessmentsForUser: async () => [],
        getQuestionCache: async () => [],
    };

    const quiz = await generateQuizWithDataSource({
        username: 'qiuqiu',
        level: MIDDLE,
        dataSource,
        mode: 'test',
        createId: () => 'long-meaning-fallback',
    });

    assert.equal(quiz.error, undefined);
    assert.equal(quiz.questions.length, 10);
    assert.equal(quiz.questions.every(question => question.context.length <= 50), true);
});

test('formal quiz prefers the narrow Supabase quiz readers when available', async () => {
    const calls = [];
    const words = Array.from({ length: 12 }, (_, index) => word(index + 1));
    const dataSource = {
        name: 'supabase',
        getUserByUsername: async () => ({ username: 'qiuqiu', username_key: 'qiuqiu' }),
        getWordsForUser: async () => { calls.push('editor-words'); return words; },
        getQuizWordsForUser: async () => { calls.push('quiz-words'); return words; },
        getAssessmentsForUser: async () => { calls.push('editor-assessments'); return []; },
        getQuizAssessmentsForUser: async () => { calls.push('quiz-assessments'); return []; },
        getQuestionCache: async () => Array.from({ length: 12 }, (_, index) => cacheRow(index + 1)),
    };

    const quiz = await generateQuizWithDataSource({
        username: 'qiuqiu', level: MIDDLE, mode: 'real', dataSource,
        createId: () => 'narrow-readers',
    });

    assert.deepEqual(calls, ['quiz-words', 'quiz-assessments']);
});

test('real quiz blocks a formal challenge until seven or eight cached questions reach ten', async () => {
    const words = Array.from({ length: 12 }, (_, index) => word(index + 1));
    for (const readyCount of [7, 8]) {
        const quiz = await generateQuizWithDataSource({
            username: 'qiuqiu', level: MIDDLE, mode: 'real', createId: () => `partial-cache-${readyCount}`,
            dataSource: {
                name: 'supabase',
                getUserByUsername: async () => ({ username: 'qiuqiu', username_key: 'qiuqiu' }),
                getWordsForUser: async () => words,
                getAssessmentsForUser: async () => [],
                getQuestionCache: async () => Array.from({ length: readyCount }, (_, index) => [
                    cacheRow(index + 1, 1),
                    cacheRow(index + 1, 2),
                ]).flat(),
            },
        });

        assert.equal(quiz.testId, undefined);
        assert.equal(quiz.code, 'QUESTION_CACHE_NOT_READY');
        assert.equal(quiz.source, 'question_cache');
        assert.equal(quiz.partialFormalChallenge, false);
        assert.equal(quiz.readyCount, readyCount);
        assert.equal(quiz.requiredCount, 10);
        assert.deepEqual(quiz.questions, []);
        assert.equal(quiz.diagnostics.fallbackUsed, false);
        assert.equal(quiz.diagnostics.readyCount, readyCount);
        assert.equal(quiz.diagnostics.eligibleReadyMeanings, readyCount);
        assert.equal(quiz.diagnostics.remainingCount, 10 - readyCount);
        assert.equal(quiz.diagnostics.finalQuestionCount, 0);
    }
});

test('real quiz excludes an invalid distractor pair from the formal ready count', async () => {
    const words = Array.from({ length: 10 }, (_, index) => word(index + 1));
    const cacheRows = words.flatMap((_, index) => [cacheRow(index + 1, 1), cacheRow(index + 1, 2)]);
    const sharedOptions = [`A. ${WORDS[9]}`, 'B. shared-1', 'C. shared-2', 'D. shared-3'];
    for (const row of cacheRows.filter(candidate => candidate.word_id === 'word-10')) {
        row.options = sharedOptions;
    }

    const quiz = await generateQuizWithDataSource({
        username: 'qiuqiu',
        level: MIDDLE,
        mode: 'real',
        createId: () => 'invalid-pair-formal',
        dataSource: {
            name: 'supabase',
            getUserByUsername: async () => ({ username: 'qiuqiu', username_key: 'qiuqiu' }),
            getWordsForUser: async () => words,
            getAssessmentsForUser: async () => [],
            getQuestionCache: async () => cacheRows,
        },
    });

    assert.equal(quiz.code, 'QUESTION_CACHE_NOT_READY');
    assert.equal(quiz.readyCount, 9);
    assert.equal(quiz.diagnostics.eligibleReadyMeanings, 9);
    assert.deepEqual(quiz.questions, []);
});

test('real quiz keeps the existing error when no cached questions are ready', async () => {
    const words = Array.from({ length: 12 }, (_, index) => word(index + 1));
    const quiz = await generateQuizWithDataSource({
        username: 'qiuqiu', level: MIDDLE, mode: 'real', createId: () => 'empty-cache',
        dataSource: {
            name: 'supabase',
            getUserByUsername: async () => ({ username: 'qiuqiu', username_key: 'qiuqiu' }),
            getWordsForUser: async () => words,
            getAssessmentsForUser: async () => [],
            getQuestionCache: async () => [],
        },
    });

    assert.equal(quiz.testId, undefined);
    assert.equal(quiz.code, 'QUESTION_CACHE_NOT_READY');
    assert.deepEqual(quiz.questions, []);
    assert.equal(quiz.readyCount, 0);
    assert.equal(quiz.requiredCount, 10);
    assert.equal(quiz.diagnostics.finalQuestionCount, 0);
});

test.skip('meaning fallback accepts multi-word vocabulary targets', async () => {
    const words = Array.from({ length: 12 }, (_, index) => word(index + 1, {
        ...(index === 0 ? { word: 'pop singer' } : {}),
        meaning_zh: '中文释义' + (index + 1),
    }));
    const dataSource = {
        name: 'supabase',
        getUserByUsername: async () => ({ username: 'qiuqiu', username_key: 'qiuqiu' }),
        getWordsForUser: async () => words,
        getAssessmentsForUser: async () => [],
        getQuestionCache: async () => [],
    };

    const quiz = await generateQuizWithDataSource({
        username: 'qiuqiu',
        level: MIDDLE,
        dataSource,
        mode: 'test',
        createId: () => 'phrase-fallback',
    });

    assert.equal(quiz.error, undefined);
    assert.equal(quiz.questions.length, 10);
    assert.equal(quiz.questions.some(question => question.word === 'pop singer'), true);
});
test('Supabase quiz does not hide unassessed words behind a stale mastered flag', async () => {
    const words = Array.from({ length: 12 }, (_, index) => word(index + 1, { mastery_status: 'mastered' }));
    const dataSource = { name: 'supabase', getUserByUsername: async () => ({ username: 'qiuqiu', username_key: 'qiuqiu' }), getWordsForUser: async () => words, getAssessmentsForUser: async () => [], getQuestionCache: async () => [] };
    const quiz = await generateQuizWithDataSource({ username: 'qiuqiu', level: MIDDLE, dataSource, mode: 'test', createId: () => 'stale-mastery-status' });
    assert.equal(quiz.error, undefined);
    assert.equal(quiz.questions.length, 10);
});
test.skip('Supabase quiz adapter fills sparse ready cache from queued words instead of returning not ready', async () => {
    const words = Array.from({ length: 12 }, (_, index) => word(index + 1));
    const dataSource = {
        name: 'supabase',
        getUserByUsername: async () => ({ username: 'qiuqiu', username_key: 'qiuqiu' }),
        getWordsForUser: async () => words,
        getAssessmentsForUser: async () => [],
        getQuestionCache: async () => Array.from({ length: 8 }, (_, index) => cacheRow(index + 1)),
    };

    const quiz = await generateQuizWithDataSource({
        username: 'qiuqiu',
        level: MIDDLE,
        dataSource,
        mode: 'test',
        createId: () => 'sparse-cache',
    });

    assert.equal(quiz.error, undefined);
    assert.equal(quiz.testId, 'test-sparse-cache');
    assert.equal(quiz.questions.length, 10);
    assert.equal(quiz.diagnostics.returnedQuestionCount, 8);
    assert.equal(quiz.diagnostics.fallbackQuestionCount, 2);
    assert.equal(quiz.questions.filter(question => question.type === 3).length, 1);
    assert.equal(quiz.questions.filter(question => question.type === 1).length, 9);
    assert.equal(quiz.questions.some(question => JSON.stringify(question.options).includes('genaine')), false);
});

test.skip('junior-high fallback fills the set with type-three questions when no candidate has context', async () => {
    const words = Array.from({ length: 12 }, (_, index) => word(index + 1, { context_en: '' }));
    const dataSource = {
        name: 'supabase',
        getUserByUsername: async () => ({ username: 'qiuqiu', username_key: 'qiuqiu' }),
        getWordsForUser: async () => words,
        getAssessmentsForUser: async () => [],
        getQuestionCache: async () => [],
    };

    const quiz = await generateQuizWithDataSource({
        username: 'qiuqiu',
        level: MIDDLE,
        dataSource,
        mode: 'test',
        createId: () => 'type-three-degraded-fallback',
    });

    assert.equal(quiz.error, undefined);
    assert.equal(quiz.questions.length, 10);
    assert.equal(quiz.questions.every(question => question.type === 3), true);
});

test('elementary fallback uses approved template contexts when stored context is unusable', async () => {
    const elementary = String.fromCharCode(0x5c0f, 0x5b66);
    const words = ['corn', 'cheek', 'roll', 'puppy', 'kitten', 'chick', 'climb', 'sweater', 'clap', 'abstract', 'stomp', 'mad'].map((value, index) => word(index + 1, {
        word: value,
        meaning_zh: '\u4e2d\u6587\u91ca\u4e49',
        context_en: '',
        level: elementary,
    }));
    const dataSource = {
        name: 'supabase',
        getUserByUsername: async () => ({ username: 'Draggy', username_key: 'draggy' }),
        getWordsForUser: async () => words,
        getAssessmentsForUser: async () => [],
        getQuestionCache: async () => [],
    };
    const quiz = await generateQuizWithDataSource({
        username: 'Draggy',
        level: elementary,
        dataSource,
        mode: 'test',
        createId: () => 'elementary-template-fallback',
    });
    assert.equal(quiz.error, undefined);
    assert.equal(quiz.questions.length, 10);
    assert.equal(quiz.questions.every(question => question.type === 1), true);
    assert.equal(quiz.questions.some(question => question.context.includes('_____')), true);
});

test('real display history excludes an already displayed cache stem before formal challenge creation', async () => {
    const now = Date.parse('2026-08-12T00:00:00.000Z');
    const words = Array.from({ length: 10 }, (_, index) => word(index + 1));
    const cacheRows = Array.from({ length: 10 }, (_, index) => [
        cacheRow(index + 1, 1),
        cacheRow(index + 1, 2),
    ]).flat();
    const quiz = await generateQuizWithDataSource({
        username: 'qiuqiu', level: MIDDLE, mode: 'test', now, createId: () => 'display-history-filter',
        dataSource: {
            name: 'supabase',
            getUserByUsername: async () => ({ username: 'qiuqiu', username_key: 'qiuqiu' }),
            getWordsForUser: async () => words,
            getAssessmentsForUser: async () => [],
            getFormalDisplayEventsForUser: async () => [{
                id: 'display-1',
                user_id: 'user-1',
                meaning_id: 'word-1',
                stem: '  VARIANT   1 uses _____ naturally in CONTEXT. ',
                displayed_at: now - 24 * 60 * 60 * 1000,
                history_expires_at: now + 29 * 24 * 60 * 60 * 1000,
                counts_for_cooldown: true,
            }],
            getQuestionCache: async () => cacheRows,
        },
    });

    assert.equal(quiz.questions.length, 10);
    assert.equal(quiz.questions.some(question => question.cacheRecordId === 'cache-1-1'), false);
    assert.equal(quiz.questions.some(question => question.cacheRecordId === 'cache-1-2'), true);
});

test('formal display history expires at the exact RPC boundary', async () => {
    const now = Date.parse('2026-08-12T00:00:00.000Z');
    const quiz = await generateQuizWithDataSource({
        username: 'qiuqiu', level: MIDDLE, mode: 'test', now, createId: () => 'display-history-boundary',
        dataSource: {
            name: 'supabase',
            getUserByUsername: async () => ({ username: 'qiuqiu', username_key: 'qiuqiu' }),
            getWordsForUser: async () => Array.from({ length: 10 }, (_, index) => word(index + 1)),
            getAssessmentsForUser: async () => [],
            getFormalDisplayEventsForUser: async () => [{
                id: 'display-expired', user_id: 'user-1', meaning_id: 'word-1',
                stem: '  VARIANT   1 uses _____ naturally in context. ',
                displayed_at: now - 30 * 24 * 60 * 60 * 1000,
                history_expires_at: now,
                counts_for_cooldown: true,
            }],
            getQuestionCache: async () => Array.from({ length: 10 }, (_, index) => [
                cacheRow(index + 1, 1), cacheRow(index + 1, 2),
            ]).flat(),
        },
    });

    assert.equal(quiz.questions.some(question => question.cacheRecordId === 'cache-1-1'), true);
});
