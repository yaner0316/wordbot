const test = require('node:test');
const assert = require('node:assert/strict');
const { generateQuizWithDataSource, getChallengeCandidatesWithDataSource, submitQuizWithDataSource } = require('../quiz-adapter');

const NOW = Date.parse('2026-10-05T04:00:00Z');
const HOUR = 3600000;
const USERNAME = 'learner';
const YESTERDAY = new Date(NOW - 20 * HOUR).toISOString();
const EARLIER = new Date(NOW - 72 * HOUR).toISOString();
const STEM = variant => `Variant ${variant} uses _____ naturally in context.`;

function fixture(count, { spellings = {} } = {}) {
    const words = Array.from({ length: count }, (_, index) => ({
        id: `word-${index}`,
        feishu_record_id: `rec-${index}`,
        word: spellings[`word-${index}`] || `target${index}`,
        meaning_zh: `释义${index}`,
        mastery_status: 'pending',
        entered_at: EARLIER,
    }));
    const cache = words.flatMap(word => [1, 2].map(slot => ({
        id: `cache-${word.id}-${slot}`,
        word_id: word.id,
        word_record_id: word.feishu_record_id,
        word: word.word,
        level: '中学',
        round_type: 'primary',
        quality_status: 'ready',
        ai_audit_status: 'approved',
        cache_state: 'active',
        variant_slot: slot,
        question_fingerprint: `fp-${word.id}-${slot}`,
        question_type: '1',
        question_text: STEM(slot),
        context_zh: '这是练习中的完整中文句子。',
        options: [`A. ${word.word}`, `B. alpha${slot}`, `C. bravo${slot}`, `D. charlie${slot}`],
        answer: 'A',
        option_meanings: ['释义', '阿尔法', '布拉沃', '查理'],
        correct_meaning: word.meaning_zh,
        used_count: 0,
    }))).map(row => require('./current-policy-fixture').attestRow(row));
    const assessments = [];
    const displays = [];
    const dataSource = {
        getUserByUsername: async () => ({ username: USERNAME, learning_level: '中学' }),
        getWordsForUser: async () => words,
        getAssessmentsForUser: async () => assessments,
        getFormalDisplayEventsForUser: async () => displays,
        getQuestionCache: async () => cache,
        ensureQuizQuestionSupply: async () => ({ words: [] }),
        submitAssessments: async inputs => inputs.map(input => {
            const word = words.find(item => item.feishu_record_id === input.sourceWordRecordId || item.id === input.sourceWordRecordId);
            const row = {
                id: `submitted-${assessments.length + 1}`,
                word_id: word.id,
                source_word_record_id: word.feishu_record_id,
                test_id: input.testId,
                assessed_at: new Date(input.recordTime).toISOString(),
                is_correct: input.correctness,
                question_text: input.questionText,
                is_real_assessment: true,
            };
            assessments.push(row);
            displays.push({
                meaning_id: word.id,
                stem: input.questionText,
                displayed_at: row.assessed_at,
                history_expires_at: new Date(NOW + 30 * 24 * HOUR).toISOString(),
                counts_for_cooldown: true,
            });
            return row;
        }),
    };
    return { words, assessments, displays, dataSource };
}

function answer(word, time, isCorrect, variant = 1, extra = {}) {
    return {
        id: `${word.id}-${time}-${variant}`,
        word_id: word.id,
        source_word_record_id: word.feishu_record_id,
        test_id: `real-${word.id}-${variant}`,
        assessed_at: time,
        is_correct: isCorrect,
        question_text: STEM(variant),
        is_real_assessment: true,
        ...extra,
    };
}

function show(library, word, time, variant = 1) {
    library.displays.push({
        meaning_id: word.id,
        stem: STEM(variant),
        displayed_at: time,
        history_expires_at: new Date(NOW + 30 * 24 * HOUR).toISOString(),
        counts_for_cooldown: true,
    });
}

function issue(library) {
    return generateQuizWithDataSource({
        username: USERNAME,
        level: '中学',
        mode: 'real',
        now: NOW,
        dataSource: library.dataSource,
        selection: { mode: 'random', meaningIds: [] },
        createId: () => 'formal-round',
    });
}

function ids(quiz) {
    return quiz.questions.map(question => question.meaningId);
}

test('eight qualified old meanings are completed with two new meanings', async () => {
    const library = fixture(16, { spellings: { 'word-0': 'parcel', 'word-11': 'parcel' } });
    const word = index => library.words[index];
    library.assessments.push(
        answer(word(0), YESTERDAY, 'wrong'),
        answer(word(1), EARLIER, 'wrong'),
        answer(word(2), EARLIER, 'wrong'),
        answer(word(2), YESTERDAY, 'correct', 1),
        answer(word(3), EARLIER, 'correct'),
        ...[4, 5, 6, 7].map(index => answer(word(index), YESTERDAY, 'correct')),
        answer(word(9), YESTERDAY, 'wrong', 1, { test_id: 'practice-word-9', assessment_kind: 'practice' }),
    );
    show(library, word(10), YESTERDAY);

    const candidates = await getChallengeCandidatesWithDataSource({
        username: USERNAME, dataSource: library.dataSource, now: NOW, mode: 'real',
    });
    const quiz = await issue(library);

    assert.equal(candidates.retest.requiredCount, 10);
    assert.deepEqual(ids(quiz), [
        'word-0', 'word-1', 'word-2', 'word-4', 'word-5', 'word-6', 'word-7', 'word-3', 'word-10', 'word-11',
    ]);
    assert.equal(quiz.requiredCount, candidates.retest.requiredCount);
    assert.equal(quiz.questions.length, 10);
    assert.equal(quiz.questions[0].word, 'parcel');
    assert.equal(quiz.questions[9].word, 'parcel');
    assert.notEqual(quiz.questions[0].meaningId, quiz.questions[9].meaningId);
    assert.ok(quiz.questions.slice(0, 8).every(question => question.context === STEM(2)));
    assert.equal(quiz.questions[8].context, STEM(2));
    assert.equal(quiz.questions[9].context, STEM(1));
    assert.ok(!ids(quiz).includes('word-9'));
});

test('after the first formal round, the next round keeps three old meanings and fills seven new ones', async () => {
    const library = fixture(20);
    for (const word of library.words.slice(0, 13)) {
        library.assessments.push(answer(word, EARLIER, 'wrong'));
        show(library, word, EARLIER);
    }
    const first = await issue(library);
    assert.deepEqual(ids(first), [
        'word-0', 'word-1', 'word-10', 'word-11', 'word-12', 'word-2', 'word-3', 'word-4', 'word-5', 'word-6',
    ]);
    await submitQuizWithDataSource({
        username: USERNAME,
        testId: first.testId,
        questions: first.questions,
        answers: first.questions.map(() => ({ option: 1, confidence: 'sure' })),
        dataSource: library.dataSource,
        now: () => NOW,
    });
    const candidates = await getChallengeCandidatesWithDataSource({
        username: USERNAME, dataSource: library.dataSource, now: NOW, mode: 'real',
    });
    const second = await issue(library);
    const secondIds = [
        'word-7', 'word-8', 'word-9', 'word-13', 'word-14', 'word-15', 'word-16', 'word-17', 'word-18', 'word-19',
    ];

    assert.equal(candidates.retest.requiredCount, 10);
    assert.deepEqual(ids(second), secondIds);
    assert.equal(second.questions.length, 10);
    assert.equal(second.requiredCount, 10);
    assert.equal(ids(first).some(id => secondIds.includes(id)), false);
    assert.ok(second.questions.slice(0, 3).every(question => question.context === STEM(2)));
});

test('earlier wrong meanings outrank a smaller yesterday cohort and block new meanings', async () => {
    const library = fixture(20);
    for (const word of library.words.slice(0, 8)) {
        library.assessments.push(answer(word, YESTERDAY, 'correct'));
        show(library, word, YESTERDAY);
    }
    for (const word of library.words.slice(8, 12)) {
        library.assessments.push(answer(word, EARLIER, 'wrong'));
        show(library, word, EARLIER);
    }
    const candidates = await getChallengeCandidatesWithDataSource({
        username: USERNAME, dataSource: library.dataSource, now: NOW, mode: 'real',
    });
    const quiz = await issue(library);

    assert.equal(candidates.retest.requiredCount, 10);
    assert.deepEqual(ids(quiz), [
        'word-10', 'word-11', 'word-8', 'word-9', 'word-0', 'word-1', 'word-2', 'word-3', 'word-4', 'word-5',
    ]);
    assert.equal(quiz.requiredCount, 10);
    assert.equal(quiz.questions.length, 10);
    assert.ok(quiz.questions.every(question => Number(question.meaningId.slice(5)) < 12));
    assert.ok(quiz.questions.every(question => question.context === STEM(2)));
});
