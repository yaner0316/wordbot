const test = require('node:test');
const assert = require('node:assert/strict');

const { generateQuizWithDataSource } = require('../quiz-adapter');
const { WORD_QUIZ_COOLDOWN_MS } = require('../quiz-cooldown');

const LEVEL = String.fromCharCode(0x4e2d, 0x5b66);
const TERMS = ['repair', 'resilient', 'attic', 'distant', 'careful', 'straight', 'attitude', 'formal', 'ordinary', 'steady', 'patient', 'forest'];
const NOW = Date.parse('2026-08-03T04:00:00.000Z');

function word(index, enteredAt) {
    return {
        id: `word-${index}`,
        feishu_record_id: `rec-${index}`,
        username: 'qiuqiu',
        word: TERMS[index - 1],
        meaning_en: `meaning ${index}`,
        meaning_zh: `释义${index}`,
        context_en: `A clear sentence uses ${TERMS[index - 1]} in context.`,
        level: LEVEL,
        mastery_status: 'pending',
        entered_at: new Date(enteredAt).toISOString(),
    };
}

function cache(index, variantSlot = 1) {
    return {
        id: `cache-${index}-${variantSlot}`,
        word_id: `word-${index}`,
        source_word_record_id: `rec-${index}`,
        word: TERMS[index - 1],
        username: 'qiuqiu',
        level: LEVEL,
        round_type: 'primary',
        quality_status: 'ready',
        cache_state: 'active',
        variant_slot: variantSlot,
        question_fingerprint: `fp-${index}-${variantSlot}`,
        question_type: '1',
        question_text: `Variant ${variantSlot} uses _____ in context number ${index}.`,
        context_zh: `\u8fd9\u662f\u7b2c${index}\u9053\u7ec3\u4e60\u4e2d\u7684\u5b8c\u6574\u4e2d\u6587\u53e5\u5b50\u3002`,
        options: [`A. ${TERMS[index - 1]}`, `B. alpha-${variantSlot}`, `C. bravo-${variantSlot}`, `D. charlie-${variantSlot}`],
        answer: 'A',
        option_meanings: [`释义${index}`, '甲', '乙', '丙'],
        correct_meaning: `释义${index}`,
    };
}

function cachePair(index) {
    return [cache(index, 1), cache(index, 2)];
}

function dataSource(words, cacheRows) {
    return {
        name: 'supabase',
        getUserByUsername: async () => ({ username: 'qiuqiu' }),
        getWordsForUser: async () => words,
        getAssessmentsForUser: async () => [],
        getQuestionCache: async () => cacheRows,
    };
}

test('formal quiz never uses live generation when ready cache is empty', async () => {
    const words = Array.from({ length: 12 }, (_, index) => word(index + 1, NOW - WORD_QUIZ_COOLDOWN_MS));
    const quiz = await generateQuizWithDataSource({
        username: 'qiuqiu', level: LEVEL, mode: 'real', now: NOW,
        dataSource: dataSource(words, []), createId: () => 'no-live-fallback',
    });
    assert.equal(quiz.code, 'QUESTION_CACHE_NOT_READY');
    assert.equal(quiz.source, 'question_cache');
    assert.equal(quiz.diagnostics.fallbackUsed, false);
    assert.deepEqual(quiz.questions, []);
});

test('formal quiz accepts the exact 18-hour boundary and rejects one millisecond earlier', async () => {
    const atBoundary = Array.from({ length: 10 }, (_, index) => word(index + 1, NOW - WORD_QUIZ_COOLDOWN_MS));
    const cacheRows = Array.from({ length: 10 }, (_, index) => cachePair(index + 1)).flat();
    const eligible = await generateQuizWithDataSource({
        username: 'qiuqiu', level: LEVEL, mode: 'real', now: NOW,
        dataSource: dataSource(atBoundary, cacheRows), createId: () => 'at-boundary',
    });
    assert.equal(eligible.questions.length, 10);
    assert.equal(eligible.source, 'question_cache');

    const tooYoung = atBoundary.map(row => ({ ...row, entered_at: new Date(NOW - WORD_QUIZ_COOLDOWN_MS + 1).toISOString() }));
    const excluded = await generateQuizWithDataSource({
        username: 'qiuqiu', level: LEVEL, mode: 'real', now: NOW,
        dataSource: dataSource(tooYoung, cacheRows), createId: () => 'before-boundary',
    });
    assert.equal(excluded.code, 'QUESTION_POOL_EXHAUSTED');
    assert.deepEqual(excluded.questions, []);
});

test('formal quiz fails closed when word timestamps are missing', async () => {
    const words = Array.from({ length: 10 }, (_, index) => {
        const row = word(index + 1, NOW - WORD_QUIZ_COOLDOWN_MS);
        delete row.entered_at;
        return row;
    });
    const quiz = await generateQuizWithDataSource({
        username: 'qiuqiu', level: LEVEL, mode: 'real', now: NOW,
        dataSource: dataSource(words, Array.from({ length: 10 }, (_, index) => cachePair(index + 1)).flat()),
        createId: () => 'missing-time',
    });
    assert.equal(quiz.code, 'QUESTION_POOL_EXHAUSTED');
    assert.deepEqual(quiz.questions, []);
});
test('formal quiz requires all ten cached questions before issuing a challenge', async () => {
    const words = Array.from({ length: 12 }, (_, index) => word(index + 1, NOW - WORD_QUIZ_COOLDOWN_MS));

    for (let readyCount = 1; readyCount <= 10; readyCount += 1) {
        const quiz = await generateQuizWithDataSource({
            username: 'qiuqiu', level: LEVEL, mode: 'real', now: NOW,
            dataSource: dataSource(words, Array.from({ length: readyCount }, (_, index) => cachePair(index + 1)).flat()),
            createId: () => `partial-${readyCount}`,
        });

        assert.equal(quiz.source, 'question_cache');
        assert.equal(quiz.requiredCount, 10);
        assert.equal(quiz.diagnostics.source, 'question_cache');
        assert.equal(quiz.diagnostics.fallbackUsed, false);
        if (readyCount < 10) {
            assert.equal(quiz.testId, undefined);
            assert.equal(quiz.code, 'QUESTION_CACHE_NOT_READY');
            assert.equal(quiz.partialFormalChallenge, false);
            assert.deepEqual(quiz.questions, []);
            assert.equal(quiz.diagnostics.finalQuestionCount, 0);
        } else {
            assert.equal(quiz.error, undefined);
            assert.equal(quiz.partialFormalChallenge, false);
            assert.equal(quiz.readyCount, 10);
            assert.equal(quiz.questions.length, 10);
            assert.equal(quiz.questions.every(question => question.source === 'question_cache'), true);
            assert.equal(quiz.diagnostics.finalQuestionCount, 10);
        }
    }
});
