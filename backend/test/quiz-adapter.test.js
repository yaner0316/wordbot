const test = require('node:test');
const assert = require('node:assert/strict');

const { generateQuizWithDataSource } = require('../quiz-adapter');

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

function cacheRow(index) {
    return {
        id: `cache-${index}`,
        word_id: `word-${index}`,
        source_word_record_id: `rec-${index}`,
        word: WORDS[index - 1],
        username: 'qiuqiu',
        level: MIDDLE,
        round_type: 'primary',
        quality_status: 'ready',
        question_type: '1',
        question_text: 'A clear sentence uses _____ in context.',
        options: [`A. ${WORDS[index - 1]}`, 'B. alpha', 'C. bravo', 'D. charlie'],
        answer: 'A',
        option_meanings: [`中文释义${index}`, 'alpha', 'bravo', 'charlie'],
        correct_meaning: `中文释义${index}`,
        used_count: 0,
        generated_at: new Date(2026, 1, index).toISOString(),
    };
}

test('Supabase quiz adapter fills sparse ready cache from queued words instead of returning not ready', async () => {
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
    assert.equal(quiz.questions.filter(question => question.type === 3).length, 2);
    assert.equal(quiz.questions.some(question => JSON.stringify(question.options).includes('genaine')), false);
});
