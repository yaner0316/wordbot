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

function cache(index) {
    return {
        id: `cache-${index}`,
        word_id: `word-${index}`,
        source_word_record_id: `rec-${index}`,
        word: TERMS[index - 1],
        username: 'qiuqiu',
        level: LEVEL,
        round_type: 'primary',
        quality_status: 'ready',
        cache_state: 'active',
        question_type: '1',
        question_text: `A clear sentence uses _____ in context number ${index}.`,
        options: [`A. ${TERMS[index - 1]}`, 'B. alpha', 'C. bravo', 'D. charlie'],
        answer: 'A',
        option_meanings: [`释义${index}`, '甲', '乙', '丙'],
        correct_meaning: `释义${index}`,
    };
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
    const cacheRows = Array.from({ length: 10 }, (_, index) => cache(index + 1));
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
        dataSource: dataSource(words, Array.from({ length: 10 }, (_, index) => cache(index + 1))),
        createId: () => 'missing-time',
    });
    assert.equal(quiz.code, 'QUESTION_POOL_EXHAUSTED');
    assert.deepEqual(quiz.questions, []);
});
