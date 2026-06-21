const test = require('node:test');
const assert = require('node:assert/strict');

const {
    QUESTION_CACHE_STATUS,
    buildCacheRowsForRecord,
    isCacheQuestionReady,
    selectReadyCachedQuestions,
    summarizeCacheStatus,
} = require('../question-cache');

function question(overrides) {
    return {
        user: 'qiuqiu',
        word_record_id: 'rec-1',
        word: 'apple',
        level: '中学',
        round_type: 'primary',
        quality_status: QUESTION_CACHE_STATUS.READY,
        used_count: 0,
        generated_at: 100,
        question_type: 1,
        question_text: 'I ate an _____.',
        options: JSON.stringify(['A. apple', 'B. pear', 'C. chair', 'D. book']),
        option_meanings: JSON.stringify(['苹果', '梨', '椅子', '书']),
        answer: 'A',
        correct_meaning: '苹果',
        ...overrides,
    };
}

test('builds two cache rows for a meaning record', () => {
    const rows = buildCacheRowsForRecord({
        userId: 'qiuqiu',
        level: '高中',
        sourceVersion: 'v1',
        primaryQuestion: {
            record_id: 'rec-1',
            word: 'apple',
            type: 1,
            context: 'I ate an _____.',
            options: ['A. apple', 'B. pear', 'C. chair', 'D. book'],
            optionMeanings: ['苹果', '梨', '椅子', '书'],
            answer: 'A',
            correctMeaning: '苹果',
        },
        reviewQuestion: {
            record_id: 'rec-1',
            word: 'apple',
            type: 2,
            context: 'a fruit',
            options: ['A. apple', 'B. pear', 'C. chair', 'D. book'],
            optionMeanings: ['苹果', '梨', '椅子', '书'],
            answer: 'A',
            correctMeaning: '苹果',
        },
        now: 123,
    });

    assert.deepEqual(rows.map(row => row.round_type), ['primary', 'review']);
    assert.equal(rows[0].level, '高中');
    assert.equal(rows[0].quality_status, 'ready');
    assert.equal(rows[1].question_type, 2);
});

test('selects ready current-level primary questions before older used ones', () => {
    const selected = selectReadyCachedQuestions({
        rows: [
            question({ word_record_id: 'rec-used', word: 'used', used_count: 3, generated_at: 1 }),
            question({ word_record_id: 'rec-fresh', word: 'fresh', used_count: 0, generated_at: 2 }),
            question({ word_record_id: 'rec-stale', word: 'stale', quality_status: 'stale' }),
            question({ word_record_id: 'rec-other-level', word: 'hard', level: '高中' }),
            question({ word_record_id: 'rec-review', word: 'review', round_type: 'review' }),
        ],
        userId: 'qiuqiu',
        level: '中学',
        roundType: 'primary',
        limit: 2,
    });

    assert.deepEqual(selected.map(item => item.word), ['fresh', 'used']);
});

test('rejects ready cache rows that are missing quality-critical fields', () => {
    assert.equal(isCacheQuestionReady(question()), true);
    assert.equal(isCacheQuestionReady(question({ options: JSON.stringify(['A. apple', 'B. pear']) })), false);
    assert.equal(isCacheQuestionReady(question({ option_meanings: JSON.stringify(['苹果', '梨', '椅子']) })), false);
    assert.equal(isCacheQuestionReady(question({ answer: 'E' })), false);
    assert.equal(isCacheQuestionReady(question({ question_text: '' })), false);
});

test('rejects cached fill-in questions with numeric quantity and singular target mismatch', () => {
    assert.equal(isCacheQuestionReady(question({
        word_record_id: 'rec-corn',
        word: 'corn',
        question_type: 1,
        question_text: 'He paid her the nominal fee of two _____ of barley.',
        options: JSON.stringify(['A. pump', 'B. cheek', 'C. kitten', 'D. corn']),
        option_meanings: JSON.stringify(['泵', '脸颊', '小猫', '谷物']),
        answer: 'D',
    })), false);
});

test('rejects cached definition questions that contain AI meta-response text', () => {
    assert.equal(isCacheQuestionReady(question({
        word_record_id: 'rec-meta',
        word: 'chick',
        question_type: 3,
        question_text: "The text you've shared looks like a long passage in Chinese characters. Could you let me know whether you want a translation or decoding?",
        options: JSON.stringify(['A. roll', 'B. handsome', 'C. chick', 'D. cow']),
        option_meanings: JSON.stringify(['roll', 'handsome', 'chick', 'cow']),
        answer: 'C',
    })), false);
});

test('selects only structurally valid ready cached questions', () => {
    const selected = selectReadyCachedQuestions({
        rows: [
            question({ word_record_id: 'rec-valid', word: 'valid' }),
            question({ word_record_id: 'rec-bad-options', word: 'bad-options', options: JSON.stringify(['A. apple']) }),
            question({ word_record_id: 'rec-bad-meanings', word: 'bad-meanings', option_meanings: JSON.stringify([]) }),
        ],
        userId: 'qiuqiu',
        level: '中学',
        roundType: 'primary',
        limit: 10,
    });

    assert.deepEqual(selected.map(item => item.word), ['valid']);
});

test('cache status summary reports ready counts by level and round type', () => {
    const summary = summarizeCacheStatus([
        question({ round_type: 'primary' }),
        question({ round_type: 'review' }),
        question({ quality_status: 'stale' }),
        question({ level: '高中' }),
    ]);

    assert.equal(summary.total, 4);
    assert.equal(summary.ready, 3);
    assert.equal(summary.byLevel['中学'].ready, 2);
    assert.equal(summary.byRoundType.primary.ready, 2);
    assert.equal(summary.byRoundType.review.ready, 1);
});
