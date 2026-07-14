const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeUserKey, collectUserAliases, mapQuestionCacheRecord } = require('../db/stage1-mapper');
const { buildReconciliationReport } = require('../db/stage1-reconcile');

test('normalizes user casing while preserving original aliases', () => {
    assert.equal(normalizeUserKey(' Yusi '), 'yusi');
    assert.deepEqual(collectUserAliases([{ fields: { user: 'Yusi' } }, { fields: { user: 'yusi' } }]), [
        { userKey: 'yusi', displayName: 'Yusi', originalUsers: ['Yusi', 'yusi'] },
    ]);
});

test('maps a Feishu cache row to the existing question_cache schema', () => {
    const row = mapQuestionCacheRecord({ record_id: 'q1', fields: {
        user: 'Yusi', word: 'apple', level: 'middle', round_type: 'primary',
        quality_status: 'ready', question_type: 1, options: ['A. fruit'], used_count: 3, generated_at: 1700000000000,
    } }, { id: 'batch-1', syncedAt: '2026-07-13T00:00:00.000Z' });
    assert.equal(row.feishu_record_id, 'q1');
    assert.equal(row.user_key, 'yusi');
    assert.equal(row.original_user, 'Yusi');
    assert.equal(row.display_name, 'Yusi');
    assert.equal(row.sync_batch, 'batch-1');
    assert.equal(row.used_count, 3);
    assert.deepEqual(row.raw_fields.options, ['A. fruit']);
    assert.equal(Object.hasOwn(row, 'created_at'), false);
    assert.equal(Object.hasOwn(row, 'updated_at'), false);
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
