const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const {
    QUESTION_CACHE_STATUS,
    buildCacheRowsForRecord,
    buildCacheQuestionFields,
    getCacheQuestionReadinessIssues,
    isCacheQuestionReady,
    normalizeCacheRow,
    selectReadyCachedQuestions,
    analyzeReadyCachedQuestions,
    stripOptionalQuestionCacheFields,
    summarizeCacheStatus,
} = require('../question-cache');

const ELEMENTARY = String.fromCharCode(0x5c0f, 0x5b66);
const JUNIOR_HIGH = String.fromCharCode(0x521d, 0x4e2d);
const SENIOR_HIGH = String.fromCharCode(0x9ad8, 0x4e2d);
const UNIVERSITY = String.fromCharCode(0x5927, 0x5b66);
const CN_CHEST = String.fromCharCode(0x80f8, 0x90e8);

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

function makeTraversalRows(count, usedCount = 0, overrides = {}) {
    return Array.from({ length: count }, (_, index) => question({
        record_id: `cache-traverse-${usedCount}-${index + 1}`,
        word_record_id: `rec-traverse-${usedCount}-${index + 1}`,
        word: `word${usedCount}-${index + 1}`,
        question_text: `The student practiced word ${usedCount}-${index + 1} in a clear sentence.`,
        used_count: usedCount,
        generated_at: index + 1,
        ...overrides,
    }));
}
test('builds an update payload for a replacement fill-in cache question', () => {
    const fields = buildCacheQuestionFields({
        question: {
            type: 1,
            context: 'The child used a brush to paint the wall.',
            contextCN: '孩子用刷子粉刷墙壁。',
            options: ['A. brush', 'B. spoon', 'C. shoe', 'D. cup'],
            optionMeanings: ['刷子', '勺子', '鞋', '杯子'],
            answer: 'A',
            correctMeaning: '刷子',
        },
        now: 456,
        sourceVersion: 'mistake-recovery-v1',
    });

    assert.equal(fields.question_type, 1);
    assert.equal(fields.question_text, 'The child used a brush to paint the wall.');
    assert.equal(fields.context_cn, '孩子用刷子粉刷墙壁。');
    assert.equal(fields.answer, 'A');
    assert.equal(fields.generated_at, 456);
    assert.equal(fields.source_version, 'mistake-recovery-v1');
});
test('cache rows preserve translated question explanations', () => {
    const rows = buildCacheRowsForRecord({
        userId: 'yusi',
        level: '高中',
        sourceVersion: 'v1',
        primaryQuestion: {
            record_id: 'rec-cn',
            word: 'noun',
            type: 2,
            context: 'A word that can refer to a person, animal, place, thing, or idea.',
            contextCN: '可以指人、动物、地方、事物或想法的词。',
            options: ['A. verb', 'B. noun', 'C. adjective', 'D. adverb'],
            optionMeanings: ['动词', '名词', '形容词', '副词'],
            answer: 'B',
            correctMeaning: '名词',
        },
        now: 123,
    });

    assert.equal(rows[0].context_cn, '可以指人、动物、地方、事物或想法的词。');
    assert.equal(normalizeCacheRow(rows[0]).question.contextCN, '可以指人、动物、地方、事物或想法的词。');
});
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

test('reports exhaustion instead of mixing older used rows into the current traversal frontier', () => {
    const analysis = analyzeReadyCachedQuestions({
        rows: [
            question({ word_record_id: 'rec-used', word: 'used', used_count: 3, generated_at: 1 }),
            question({ word_record_id: 'rec-fresh', word: 'fresh', used_count: 0, generated_at: 2 }),
            question({ word_record_id: 'rec-stale', word: 'stale', quality_status: 'stale' }),
            question({ word_record_id: 'rec-other-level', word: 'hard', level: SENIOR_HIGH }),
            question({ word_record_id: 'rec-review', word: 'review', round_type: 'review' }),
        ],
        userId: 'qiuqiu',
        level: question().level,
        roundType: 'primary',
        limit: 2,
    });

    assert.equal(analysis.poolCount, 2);
    assert.equal(analysis.frontierCount, 1);
    assert.equal(analysis.exhausted, true);
    assert.deepEqual(analysis.questions, []);
});

test('analyzes traversal exhaustion after every ready cache row has been used once', () => {
    const analysis = analyzeReadyCachedQuestions({
        rows: makeTraversalRows(25, 1, { level: JUNIOR_HIGH }),
        userId: 'qiuqiu',
        level: JUNIOR_HIGH,
        roundType: 'primary',
        limit: 10,
    });

    assert.equal(analysis.poolCount, 25);
    assert.equal(analysis.minUsed, 1);
    assert.equal(analysis.exhausted, true);
    assert.equal(analysis.notReady, false);
    assert.deepEqual(analysis.questions, []);
});

test('traversal does not mix repeated questions into a partial fresh frontier', () => {
    const analysis = analyzeReadyCachedQuestions({
        rows: [
            ...makeTraversalRows(5, 0, { level: JUNIOR_HIGH }),
            ...makeTraversalRows(20, 1, { level: JUNIOR_HIGH }),
        ],
        userId: 'qiuqiu',
        level: JUNIOR_HIGH,
        roundType: 'primary',
        limit: 10,
    });

    assert.equal(analysis.poolCount, 25);
    assert.equal(analysis.minUsed, 0);
    assert.equal(analysis.frontierCount, 5);
    assert.equal(analysis.exhausted, true);
    assert.equal(analysis.notReady, false);
    assert.deepEqual(analysis.questions, []);
});

test('traversal selection carries known used counts for cache usage writes', () => {
    const selected = selectReadyCachedQuestions({
        rows: makeTraversalRows(12, 0, { level: JUNIOR_HIGH }),
        userId: 'qiuqiu',
        level: JUNIOR_HIGH,
        roundType: 'primary',
        limit: 10,
    });

    assert.equal(selected.length, 10);
    assert.ok(selected.every(item => item.cacheUsedCount === 0));
});

test('traversal relaxes type quotas within the current frontier only', () => {
    const rows = [
        ...makeTraversalRows(10, 0, { level: SENIOR_HIGH, question_type: 1 }),
        ...makeTraversalRows(10, 1, { level: SENIOR_HIGH, question_type: 3 }),
    ];
    const selected = selectReadyCachedQuestions({
        rows,
        userId: 'qiuqiu',
        level: SENIOR_HIGH,
        roundType: 'primary',
        limit: 10,
    });

    assert.equal(selected.length, 10);
    assert.deepEqual([...new Set(selected.map(item => item.type))], [1]);
    assert.ok(selected.every(item => item.cacheUsedCount === 0));
});

test('traversal randomizes selection within the same used-count frontier only', () => {
    const originalRandomInt = crypto.randomInt;
    const rows = [
        ...makeTraversalRows(15, 0, { level: JUNIOR_HIGH, question_type: 1 }),
        ...makeTraversalRows(15, 1, { level: JUNIOR_HIGH, question_type: 1 }),
    ];
    let callIndex = 0;

    try {
        crypto.randomInt = (min, max) => {
            const value = callIndex % 2 === 0 ? min : max - 1;
            callIndex += 1;
            return value;
        };
        const first = selectReadyCachedQuestions({ rows, userId: 'qiuqiu', level: JUNIOR_HIGH, roundType: 'primary', limit: 10 });
        crypto.randomInt = (_min, max) => max - 1;
        const second = selectReadyCachedQuestions({ rows, userId: 'qiuqiu', level: JUNIOR_HIGH, roundType: 'primary', limit: 10 });

        assert.equal(first.length, 10);
        assert.equal(second.length, 10);
        assert.ok(first.every(item => item.cacheUsedCount === 0));
        assert.ok(second.every(item => item.cacheUsedCount === 0));
        assert.notDeepEqual(
            first.map(item => item.cacheRecordId).sort(),
            second.map(item => item.cacheRecordId).sort()
        );
    } finally {
        crypto.randomInt = originalRandomInt;
    }
});
test('selects cached questions case-insensitively by user', () => {
    const middleLevel = String.fromCharCode(0x4e2d, 0x5b66);
    const selected = selectReadyCachedQuestions({
        rows: [question({ user: 'yusi', level: middleLevel, word_record_id: 'rec-yusi', word: 'apple' })],
        userId: 'Yusi',
        level: middleLevel,
        roundType: 'primary',
        limit: 1,
    });

    assert.deepEqual(selected.map(item => item.word), ['apple']);
});
test('rejects ready cache rows that are missing quality-critical fields', () => {
    assert.equal(isCacheQuestionReady(question()), true);
    assert.equal(isCacheQuestionReady(question({ options: JSON.stringify(['A. apple', 'B. pear']) })), false);
    assert.equal(isCacheQuestionReady(question({ option_meanings: JSON.stringify(['苹果', '梨', '椅子']) })), false);
    assert.equal(isCacheQuestionReady(question({ answer: 'E' })), false);
    assert.equal(isCacheQuestionReady(question({ question_text: '' })), false);
});

test('rejects cached questions whose non-answer option meanings are English words', () => {
    assert.equal(isCacheQuestionReady(question({
        option_meanings: JSON.stringify(['苹果', 'pear', '椅子', '书']),
    })), false);
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

test('reports not-ready when structurally valid ready cached questions are below a full set', () => {
    const analysis = analyzeReadyCachedQuestions({
        rows: [
            question({ word_record_id: 'rec-valid', word: 'valid' }),
            question({ word_record_id: 'rec-bad-options', word: 'bad-options', options: JSON.stringify(['A. apple']) }),
            question({ word_record_id: 'rec-bad-meanings', word: 'bad-meanings', option_meanings: JSON.stringify([]) }),
        ],
        userId: 'qiuqiu',
        level: question().level,
        roundType: 'primary',
        limit: 10,
    });

    assert.equal(analysis.poolCount, 1);
    assert.equal(analysis.notReady, true);
    assert.equal(analysis.exhausted, false);
    assert.deepEqual(analysis.questions, []);
});
test('junior-high cached quiz moves English-definition quota into fill-in questions', () => {
    const rows = [];
    const middleLevel = String.fromCharCode(0x4e2d, 0x5b66);
    const cnApple = String.fromCharCode(0x82f9, 0x679c);
    for (let i = 1; i <= 9; i++) {
        rows.push(question({ word_record_id: `rec-t1-${i}`, word: 'apple', level: middleLevel, question_type: 1 }));
    }
    for (let i = 1; i <= 4; i++) {
        rows.push(question({ word_record_id: `rec-t2-${i}`, word: 'apple', level: middleLevel, question_type: 2, question_text: `definition clue ${i}` }));
    }
    for (let i = 1; i <= 2; i++) {
        rows.push(question({ word_record_id: `rec-t3-${i}`, word: 'apple', level: middleLevel, question_type: 3, question_text: cnApple }));
    }

    const selected = selectReadyCachedQuestions({
        rows,
        userId: 'qiuqiu',
        level: middleLevel,
        roundType: 'primary',
        limit: 10,
    });
    const counts = selected.reduce((acc, item) => {
        acc[item.type] = (acc[item.type] || 0) + 1;
        return acc;
    }, {});

    assert.equal(selected.length, 10);
    assert.equal(counts[1], 9);
    assert.equal(counts[2] || 0, 0);
    assert.equal(counts[3], 1);
});
test('relaxes cached quiz type caps within the current traversal frontier', () => {
    const rows = [];
    const highSchoolLevel = String.fromCharCode(0x9ad8, 0x4e2d);
    const cnApple = String.fromCharCode(0x82f9, 0x679c);
    for (let i = 1; i <= 3; i++) {
        rows.push(question({ record_id: `row-t1-short-${i}`, word_record_id: `rec-t1-short-${i}`, word: `apple${i}`, level: highSchoolLevel, question_type: 1 }));
    }
    for (let i = 1; i <= 12; i++) {
        rows.push(question({ record_id: `row-t2-extra-${i}`, word_record_id: `rec-t2-extra-${i}`, word: `word${i}`, level: highSchoolLevel, question_type: 2, question_text: `simple clue ${i}` }));
    }
    for (let i = 1; i <= 4; i++) {
        rows.push(question({ record_id: `row-t3-extra-${i}`, word_record_id: `rec-t3-extra-${i}`, word: `cnword${i}`, level: highSchoolLevel, question_type: 3, question_text: cnApple }));
    }

    const selected = selectReadyCachedQuestions({
        rows,
        userId: 'qiuqiu',
        level: highSchoolLevel,
        roundType: 'primary',
        limit: 10,
    });
    const counts = selected.reduce((acc, item) => {
        acc[item.type] = (acc[item.type] || 0) + 1;
        return acc;
    }, {});

    assert.equal(selected.length, 10);
    assert.equal(counts[1], 3);
    assert.equal(counts[2] + counts[3], 7);
});
test('elementary cached quiz selects only fill-in questions', () => {
    const rows = [];
    const elementaryLevel = String.fromCharCode(0x5c0f, 0x5b66);
    for (let i = 1; i <= 10; i++) {
        rows.push(question({ record_id: `row-t1-flex-${i}`, word_record_id: `rec-t1-flex-${i}`, word: `fill${i}`, level: elementaryLevel, question_type: 1 }));
    }
    for (let i = 1; i <= 3; i++) {
        rows.push(question({ record_id: `row-t2-flex-${i}`, word_record_id: `rec-t2-flex-${i}`, word: `def${i}`, level: elementaryLevel, question_type: 2, question_text: `simple clue ${i} for children` }));
    }

    const selected = selectReadyCachedQuestions({
        rows,
        userId: 'qiuqiu',
        level: elementaryLevel,
        roundType: 'primary',
        limit: 10,
    });
    const counts = selected.reduce((acc, item) => {
        acc[item.type] = (acc[item.type] || 0) + 1;
        return acc;
    }, {});

    assert.equal(selected.length, 10);
    assert.equal(counts[1], 10);
    assert.equal(counts[2] || 0, 0);
    assert.equal(counts[3] || 0, 0);
});
test('cache status summary reports ready counts by level and round type', () => {
    const defaultLevel = question().level;
    const summary = summarizeCacheStatus([
        question({ round_type: 'primary' }),
        question({ round_type: 'review' }),
        question({ quality_status: 'stale' }),
        question({ level: '高中' }),
    ]);

    assert.equal(summary.total, 4);
    assert.equal(summary.ready, 3);
    assert.equal(summary.byLevel[defaultLevel].ready, 2);
    assert.equal(summary.byRoundType.primary.ready, 2);
    assert.equal(summary.byRoundType.review.ready, 1);
});

test('cache status summary counts only questions that are actually selectable', () => {
    const defaultLevel = question().level;
    const summary = summarizeCacheStatus([
        question({ word_record_id: 'rec-valid', word: 'valid', round_type: 'primary' }),
        question({
            word_record_id: 'rec-bad',
            word: 'bad',
            round_type: 'primary',
            option_meanings: JSON.stringify([]),
        }),
    ]);

    assert.equal(summary.total, 2);
    assert.equal(summary.ready, 1);
    assert.equal(summary.byLevel[defaultLevel].ready, 1);
    assert.equal(summary.byRoundType.primary.ready, 1);
});

test('strips optional cache fields before retrying older Feishu cache tables', () => {
    const row = question({
        context_cn: '中文句子',
        suffix: ' after blank.',
        ai_audit_status: 'skipped',
        last_used_at: '',
        source_version: 'phase-2',
    });
    const stripped = stripOptionalQuestionCacheFields(row);

    assert.equal(stripped.user, row.user);
    assert.equal(stripped.word, row.word);
    assert.equal(stripped.option_meanings, row.option_meanings);
    assert.equal(stripped.correct_meaning, row.correct_meaning);
    assert.equal('context_cn' in stripped, false);
    assert.equal('suffix' in stripped, false);
    assert.equal('ai_audit_status' in stripped, false);
    assert.equal('last_used_at' in stripped, false);
    assert.equal('source_version' in stripped, false);
});

test('can strip a selected optional cache field while preserving translations', () => {
    const row = question({
        context_cn: '中文句子',
        suffix: ' after blank.',
        source_version: 'phase-2',
    });
    const stripped = stripOptionalQuestionCacheFields(row, ['source_version']);

    assert.equal(stripped.context_cn, '中文句子');
    assert.equal(stripped.suffix, ' after blank.');
    assert.equal('source_version' in stripped, false);
});

test('rejects cached definition questions that contain Chinese AI meta-response text', () => {
    assert.equal(isCacheQuestionReady(question({
        word_record_id: 'rec-meta-cn',
        word: 'corn',
        question_type: 3,
        question_text: '您好！您提供的内容非常长，目前没有明确说明您希望我如何处理。请告诉我您的具体需求，我将竭诚为您提供帮助！',
        options: JSON.stringify(['A. lamb', 'B. clap', 'C. eraser', 'D. corn']),
        option_meanings: JSON.stringify(['lamb', 'clap', 'eraser', 'corn']),
        answer: 'D',
    })), false);
});

test('rejects cached definition questions that contain English AI task-request text', () => {
    assert.equal(isCacheQuestionReady(question({
        word_record_id: 'rec-meta-en-task',
        word: 'lamb',
        question_type: 3,
        question_text: 'It looks like the message you sent contains a large amount of garbled or encoded text. Could you please let me know what you would like me to do with it?',
        options: JSON.stringify(['A. kitten', 'B. cow', 'C. lamb', 'D. foal']),
        option_meanings: JSON.stringify(['kitten', 'cow', 'lamb', 'foal']),
        answer: 'C',
    })), false);
});


test('rejects cached terse English AI garbled-text explanations', () => {
    assert.equal(isCacheQuestionReady(question({
        word_record_id: 'rec-meta-en-garbled',
        word: 'eraser',
        question_type: 3,
        question_text: "I'm sorry, but I can't make sense of the text you've provided - it appears to be corrupted or garbled.",
        options: JSON.stringify(['A. kitten', 'B. cow', 'C. eraser', 'D. foal']),
        option_meanings: JSON.stringify(['kitten', 'cow', 'eraser', 'foal']),
        answer: 'C',
    })), false);
});

test('rejects cached questions whose option_meanings contain the failure placeholder', () => {
    assert.equal(isCacheQuestionReady(question({
        option_meanings: JSON.stringify(['苹果', '中文释义补充失败', '椅子', '书']),
    })), false);
    assert.equal(isCacheQuestionReady(question({
        option_meanings: JSON.stringify(['苹果', '梨', '椅子', '中文释义补充']),
    })), false);
    assert.equal(isCacheQuestionReady(question({
        option_meanings: JSON.stringify(['苹果', '梨', '椅子', '书']),
    })), true);
});


test('rejects cached elementary fill-in rows with sense-mismatched contexts', () => {
    assert.equal(isCacheQuestionReady(question({
        level: ELEMENTARY,
        word_record_id: 'rec-chest',
        word: 'chest',
        question_type: 1,
        question_text: "The museum's ancient _____ was secured with a brass lock, holding artifacts from the 17th century.",
        options: JSON.stringify(['A. study', 'B. chest', 'C. fare', 'D. compute']),
        option_meanings: JSON.stringify(['study', CN_CHEST, 'fare', 'compute']),
        answer: 'B',
        correct_meaning: CN_CHEST,
    })), false);
});


test('reports readiness reject reasons for cached elementary quality failures', () => {
    const issues = getCacheQuestionReadinessIssues(question({
        level: ELEMENTARY,
        word_record_id: 'rec-chest',
        word: 'chest',
        question_type: 1,
        question_text: "The museum's ancient _____ was secured with a brass lock, holding artifacts from the 17th century.",
        options: JSON.stringify(['A. study', 'B. chest', 'C. fare', 'D. compute']),
        option_meanings: JSON.stringify(['study', CN_CHEST, 'fare', 'compute']),
        answer: 'B',
        correct_meaning: CN_CHEST,
    }));

    assert.ok(issues.includes('sense_mismatch_chest'));
    assert.ok(issues.includes('not_elementary_context'));
});

test('rejects cached sense-mismatched fill-in rows across learning levels', () => {
    for (const level of [ELEMENTARY, JUNIOR_HIGH, SENIOR_HIGH, UNIVERSITY]) {
        const row = question({
            level,
            word_record_id: 'rec-chest-' + level,
            word: 'chest',
            question_type: 1,
            question_text: "The museum's ancient _____ was secured with a brass lock, holding artifacts from the 17th century.",
            options: JSON.stringify(['A. study', 'B. chest', 'C. fare', 'D. compute']),
            option_meanings: JSON.stringify(['study', CN_CHEST, 'fare', 'compute']),
            answer: 'B',
            correct_meaning: CN_CHEST,
        });
        const issues = getCacheQuestionReadinessIssues(row);
        assert.equal(isCacheQuestionReady(row), false, level);
        assert.ok(issues.includes('sense_mismatch_chest'), level + ' issues=' + issues.join(','));
    }
});

test('selects at most one cached primary question per word record', () => {
    const middleLevel = String.fromCharCode(0x4e2d, 0x5b66);
    const selected = selectReadyCachedQuestions({
        rows: [
            question({ record_id: 'cache-cotton-newer', word_record_id: 'rec-cotton', word: 'cotton', level: middleLevel, generated_at: 300 }),
            question({ record_id: 'cache-cotton-older', word_record_id: 'rec-cotton', word: 'cotton', level: middleLevel, generated_at: 200 }),
            question({ record_id: 'cache-linen', word_record_id: 'rec-linen', word: 'linen', level: middleLevel, generated_at: 100 }),
        ],
        userId: 'qiuqiu',
        level: middleLevel,
        roundType: 'primary',
        limit: 2,
    });

    // Order within the same used_count tier is now randomized, so assert the
    // dedup semantics (one question per word record) rather than a fixed order.
    assert.deepEqual(selected.map(item => item.record_id).sort(), ['rec-cotton', 'rec-linen']);
});
