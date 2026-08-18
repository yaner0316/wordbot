'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    applyAssessmentChineseAnalysisPlan,
    buildAssessmentChineseAnalysisPlan,
} = require('../scripts/backfill-assessment-chinese-analysis');

function fixture() {
    return {
        words: [{ id: 'word-1', user_id: 'user-1', meaning_zh: '苹果' }],
        challengeQuestions: [{ id: 'challenge-question-1', cache_question_id: 'cache-1' }],
        caches: [{
            id: 'cache-1', user_id: 'user-1', word_id: 'word-1',
            question_text: 'The student ate an _____ after lunch.', answer: 'A',
            context_zh: '这个学生午饭后吃了一个苹果。',
            option_meanings: ['苹果', '梨', '椅子', '道路'],
        }],
        assessments: [{
            id: 'assessment-1', user_id: 'user-1', word_id: 'word-1',
            source_question_id: 'challenge-question-1', test_id: 'real-history-1',
            question_type: '1', question_text: 'The student ate an _____ after lunch.',
            correct_answer: 'A', is_correct: 'correct', option_meanings: [], context_zh: null,
        }],
    };
}

test('inventory produces exact field-limited patches without mutating source rows', () => {
    const input = fixture();
    const before = structuredClone(input);
    const plan = buildAssessmentChineseAnalysisPlan(input);

    assert.deepEqual(plan.repairs, [{
        id: 'assessment-1',
        patch: {
            option_meanings: ['苹果', '梨', '椅子', '道路'],
            context_zh: '这个学生午饭后吃了一个苹果。',
        },
        expected: { option_meanings: [], context_zh: null },
        sourceCacheId: 'cache-1',
    }]);
    assert.deepEqual(plan.unresolvedIds, []);
    assert.deepEqual(input, before);
});

test('inventory refuses ambiguous fallback matches and never invents translations', () => {
    const input = fixture();
    input.assessments[0].source_question_id = null;
    input.caches.push({ ...input.caches[0], id: 'cache-2' });

    const plan = buildAssessmentChineseAnalysisPlan(input);

    assert.deepEqual(plan.repairs, []);
    assert.deepEqual(plan.unresolvedIds, ['assessment-1']);
});

test('inventory refuses a same-stem cache fallback with different answer options', () => {
    const input = fixture();
    input.assessments[0].source_question_id = null;
    input.assessments[0].options = ['A. apple', 'B. pear', 'C. chair', 'D. road'];
    input.caches[0].options = ['A. apple', 'B. banana', 'C. desk', 'D. road'];

    const plan = buildAssessmentChineseAnalysisPlan(input);

    assert.deepEqual(plan.repairs, []);
    assert.deepEqual(plan.unresolvedIds, ['assessment-1']);
});

test('inventory prefers the exact historical challenge snapshot over the current cache', () => {
    const input = fixture();
    input.challenges = [{ id: 'challenge-1', user_id: 'user-1', test_id: 'real-history-1' }];
    input.challengeQuestions[0] = {
        ...input.challengeQuestions[0],
        challenge_id: 'challenge-1',
        meaning_id: 'word-1',
        stem: input.assessments[0].question_text,
        question_snapshot: {
            meaning_id: 'word-1',
            cache_question_id: 'cache-1',
            stem: input.assessments[0].question_text,
            question_snapshot: {
                type: 1,
                meaningId: 'word-1',
                cacheRecordId: 'cache-1',
                context: input.assessments[0].question_text,
                answer: 'A',
                optionMeanings: ['苹果', '香蕉', '课桌', '道路'],
                contextCN: '这个学生午饭后吃了一个苹果。',
            },
        },
    };

    const plan = buildAssessmentChineseAnalysisPlan(input);

    assert.deepEqual(plan.repairs[0].patch, {
        option_meanings: ['苹果', '香蕉', '课桌', '道路'],
        context_zh: '这个学生午饭后吃了一个苹果。',
    });
    assert.equal(plan.repairs[0].sourceChallengeQuestionId, 'challenge-question-1');
});

test('inventory uses only one exact challenge tuple when the old assessment has no source id', () => {
    const input = fixture();
    input.assessments[0].source_question_id = null;
    input.caches = [];
    input.challenges = [{ id: 'challenge-1', user_id: 'user-1', test_id: 'real-history-1' }];
    input.challengeQuestions[0] = {
        id: 'challenge-question-1', challenge_id: 'challenge-1', meaning_id: 'word-1',
        cache_question_id: 'cache-1', stem: input.assessments[0].question_text,
        question_snapshot: {
            type: 1, meaningId: 'word-1', cacheRecordId: 'cache-1',
            context: input.assessments[0].question_text, answer: 'A',
            optionMeanings: ['苹果', '香蕉', '课桌', '道路'],
            contextCN: '这个学生午饭后吃了一个苹果。',
        },
    };

    const plan = buildAssessmentChineseAnalysisPlan(input);

    assert.equal(plan.repairs.length, 1);
    assert.deepEqual(plan.unresolvedIds, []);
});

test('inventory rejects a challenge snapshot whose saved answer differs from the assessment', () => {
    const input = fixture();
    input.caches = [];
    input.challenges = [{ id: 'challenge-1', user_id: 'user-1', test_id: 'real-history-1' }];
    input.challengeQuestions[0] = {
        id: 'challenge-question-1', challenge_id: 'challenge-1', meaning_id: 'word-1',
        cache_question_id: 'cache-1', stem: input.assessments[0].question_text,
        question_snapshot: {
            type: 1, meaningId: 'word-1', cacheRecordId: 'cache-1',
            context: input.assessments[0].question_text, answer: 'B',
            optionMeanings: ['苹果', '香蕉', '课桌', '道路'],
            contextCN: '这个学生午饭后吃了一个苹果。',
        },
    };

    const plan = buildAssessmentChineseAnalysisPlan(input);

    assert.deepEqual(plan.repairs, []);
    assert.deepEqual(plan.unresolvedIds, ['assessment-1']);
});

test('apply mode updates only planned fields and is idempotent after reread', async () => {
    const input = fixture();
    const plan = buildAssessmentChineseAnalysisPlan(input);
    const operations = [];
    const filters = [];
    const client = {
        from(table) {
            assert.equal(table, 'assessments');
            return {
                update(patch) {
                    const query = {
                        eq(column, value) { filters.push({ type: 'eq', column, value }); return query; },
                        filter(column, operator, value) { filters.push({ type: 'filter', column, operator, value }); return query; },
                        is(column, value) { filters.push({ type: 'is', column, value }); return query; },
                        select() { return query; },
                        async maybeSingle() {
                            operations.push({ id: 'assessment-1', patch: structuredClone(patch) });
                            return { data: { id: 'assessment-1' }, error: null };
                        },
                    };
                    return query;
                },
            };
        },
    };

    assert.deepEqual(await applyAssessmentChineseAnalysisPlan(client, plan), { updated: 1, skippedConcurrent: 0 });
    assert.deepEqual(operations, [{ id: 'assessment-1', patch: plan.repairs[0].patch }]);
    assert.deepEqual(filters, [
        { type: 'eq', column: 'id', value: 'assessment-1' },
        { type: 'filter', column: 'option_meanings', operator: 'eq', value: '[]' },
        { type: 'is', column: 'context_zh', value: null },
    ]);

    Object.assign(input.assessments[0], plan.repairs[0].patch);
    assert.deepEqual(buildAssessmentChineseAnalysisPlan(input).repairs, []);
});

test('apply mode skips a row changed after inventory instead of overwriting it', async () => {
    const plan = buildAssessmentChineseAnalysisPlan(fixture());
    const client = {
        from() {
            return {
                update() {
                    const query = {
                        eq() { return query; }, is() { return query; }, filter() { return query; }, select() { return query; },
                        async maybeSingle() { return { data: null, error: null }; },
                    };
                    return query;
                },
            };
        },
    };

    assert.deepEqual(await applyAssessmentChineseAnalysisPlan(client, plan), { updated: 0, skippedConcurrent: 1 });
});
