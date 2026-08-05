const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeUserKey, collectUserAliases, inspectQuestionCacheRecord, mapQuestionCacheRecord } = require('../db/stage1-mapper');
const { buildReconciliationReport } = require('../db/stage1-reconcile');

test('normalizes user casing while preserving original aliases', () => {
    assert.equal(normalizeUserKey(' Yusi '), 'yusi');
    assert.deepEqual(collectUserAliases([{ fields: { user: 'Yusi' } }, { fields: { user: 'yusi' } }]), [
        { userKey: 'yusi', displayName: 'Yusi', originalUsers: ['Yusi', 'yusi'] },
    ]);
});

test('maps a Feishu cache row to the existing question_cache schema', () => {
    const row = mapQuestionCacheRecord({ record_id: 'q1', fields: {
        user: 'Yusi', word: 'apple', word_record_id: 'w1', level: '中学', round_type: 'primary',
        quality_status: 'ready', question_type: 1, question_text: '_____ is fruit.',
        options: ['A. fruit', 'B. stone'], answer: 'A', option_meanings: ['水果', '石头'],
        used_count: 3, generated_at: 1700000000000,
    } }, { id: 'batch-1', syncedAt: '2026-07-13T00:00:00.000Z' }, {
        usersByUsername: new Map([['yusi', { id: 'user-1', username: 'Yusi', learning_level: '中学' }]]),
        wordsByRecord: new Map([['w1', { id: 'word-1', feishu_record_id: 'w1', user_id: 'user-1', word: 'apple', level: '中学' }]]),
        wordsByUserWord: new Map(),
    });
    assert.equal(row.feishu_record_id, 'q1');
    assert.equal(row.user_id, 'user-1');
    assert.equal(row.word_id, 'word-1');
    assert.equal(row.source_word_record_id, 'w1');
    assert.equal(row.level, '中学');
    assert.equal(row.question_type, '1');
    assert.equal(row.round_type, 'primary');
    assert.equal(row.quality_status, 'ready');
    assert.equal(row.used_count, 3);
    assert.deepEqual(row.options, ['A. fruit', 'B. stone']);
    assert.equal(row.source_version, 'feishu-stage1');
    assert.equal(Object.hasOwn(row, 'raw_fields'), false);
});
test('rejects a vocabulary-shaped row as a non-cache source', () => {
    const validation = inspectQuestionCacheRecord({ record_id: 'w1', fields: { user: 'Yusi', Word: 'apple', Meaning: 'fruit', Distractors: 'x,y,z' } });
    assert.deepEqual(validation, { valid: false, reason: 'NOT_QUESTION_CACHE_SOURCE' });
});

test('reports cache counts by user and level/status with diffs and risks', () => {
    const report = buildReconciliationReport({
        feishuSnapshot: {
            words: [{ record_id: 'w1', fields: { user: 'Yusi', Word: 'apple', Meaning: 'fruit' } }],
            tests: [{ record_id: 't1', fields: { user: 'Yusi' } }],
            questionCache: [{ record_id: 'q1', fields: { user: 'Yusi', level: 'middle', quality_status: 'ready' } }],
        },
        databaseRows: [{ feishu_record_id: 'q1', user_key: 'yusi', level: 'middle', quality_status: 'ready' }],
    });
    assert.equal(report.users.yusi.feishu.questionCache, 1);
    assert.equal(report.users.yusi.database.questionCache, 1);
    assert.equal(report.users.yusi.questionCacheByLevelStatus.middle.ready.diff, 0);
    assert.equal(report.sourceOnly.words.feishu, 1);
    assert.ok(report.risks.some(risk => risk.code === 'NOT_MIRRORED'));
    assert.deepEqual(report.duplicateUsers, []);
});
