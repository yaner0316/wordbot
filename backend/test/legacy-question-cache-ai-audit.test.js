'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    createLegacyAuditPlan,
    runLegacyQuestionCacheAiAudit,
} = require('../legacy-question-cache-ai-audit');

function row(id, overrides = {}) {
    return {
        id,
        user_id: 'user-1',
        word_id: `word-${id}`,
        quality_status: 'ready',
        cache_state: 'active',
        question_type: '1',
        question_text: 'She chose _____ after school.',
        options: ['A. tennis', 'B. chess', 'C. reading', 'D. music'],
        option_meanings: ['网球', '国际象棋', '阅读', '音乐'],
        answer: 'A',
        ai_audit_status: 'skipped',
        source_version: 'legacy-v2',
        updated_at: '2026-08-19T00:00:00.000Z',
        ...overrides,
    };
}

test('legacy audit plan is deterministic and includes only selectable skipped type-one rows', () => {
    const rows = [
        row('b'),
        row('a'),
        row('approved', { ai_audit_status: 'approved' }),
        row('retired', { cache_state: 'retired' }),
        row('type-two', { question_type: '2' }),
    ];

    const first = createLegacyAuditPlan(rows);
    const second = createLegacyAuditPlan([...rows].reverse());

    assert.deepEqual(first.items.map(item => item.cacheId), ['a', 'b']);
    assert.equal(first.planFingerprint, second.planFingerprint);
    assert.notEqual(first.planFingerprint, createLegacyAuditPlan([
        row('a', { question_text: 'The content changed to _____.' }),
        row('b'),
    ]).planFingerprint);
});

test('legacy audit plan fingerprints every approval fence state', () => {
    const base = createLegacyAuditPlan([row('a')]);
    assert.deepEqual(base.items[0], {
        cacheId: 'a',
        userId: 'user-1',
        wordId: 'word-a',
        rowVersion: '2026-08-19T00:00:00.000Z',
        qualityStatus: 'ready',
        cacheState: 'active',
        questionType: '1',
        aiAuditStatus: 'skipped',
        contentHash: base.items[0].contentHash,
    });

    for (const [field, value] of [
        ['quality_status', 'stale'],
        ['cache_state', 'reserved_next_day'],
        ['question_type', 2],
        ['ai_audit_status', 'pending'],
    ]) {
        assert.notEqual(
            base.planFingerprint,
            createLegacyAuditPlan([row('a', { [field]: value })]).planFingerprint,
            `${field} must be included in the reviewed plan fingerprint`
        );
    }
});

test('legacy audit defaults to dry-run and performs no AI calls or writes', async () => {
    const calls = [];
    const result = await runLegacyQuestionCacheAiAudit({
        loadRows: async () => [row('a')],
        auditQuestion: async () => { calls.push('audit'); },
        approveRow: async () => { calls.push('approve'); },
        enqueueReplacement: async () => { calls.push('enqueue'); },
    });

    assert.equal(result.mode, 'dry-run');
    assert.equal(result.planned, 1);
    assert.deepEqual(calls, []);
});

test('legacy audit apply requires the exact reviewed plan fingerprint', async () => {
    const dependencies = { loadRows: async () => [row('a')] };
    const dryRun = await runLegacyQuestionCacheAiAudit(dependencies);

    await assert.rejects(
        runLegacyQuestionCacheAiAudit(dependencies, { apply: true }),
        /PLAN_FINGERPRINT_REQUIRED/
    );
    await assert.rejects(
        runLegacyQuestionCacheAiAudit(dependencies, { apply: true, planFingerprint: 'wrong' }),
        /PLAN_FINGERPRINT_MISMATCH/
    );
    assert.match(dryRun.planFingerprint, /^[a-f0-9]{64}$/);
});

test('legacy audit approves unique rows and queues rejected rows without retiring them', async () => {
    const approved = [];
    const queued = [];
    const rows = [row('approved-row'), row('rejected-row'), row('offline-row')];
    const plan = createLegacyAuditPlan(rows);
    const result = await runLegacyQuestionCacheAiAudit({
        loadRows: async () => rows,
        auditQuestion: async question => {
            if (question.cacheId === 'approved-row') return { approved: true, status: 'approved', validLetters: ['A'] };
            if (question.cacheId === 'rejected-row') return { approved: false, status: 'rejected', validLetters: ['A', 'B'] };
            return { approved: false, status: 'unavailable', validLetters: [] };
        },
        approveRow: async item => { approved.push(item.cacheId); },
        enqueueReplacement: async item => { queued.push(item.wordId); },
    }, { apply: true, planFingerprint: plan.planFingerprint });

    assert.deepEqual(approved, ['approved-row']);
    assert.deepEqual(queued, ['word-rejected-row']);
    assert.equal(result.nextAfterId, 'rejected-row');
    assert.deepEqual(result.progress, { total: 3, audited: 3, approved: 1, replacementQueued: 1, unavailable: 1, failed: 0 });
});

test('legacy audit counts an approval fence rejection as failed and never approved', async () => {
    const source = row('a');
    const plan = createLegacyAuditPlan([source]);
    let approveCalls = 0;
    const result = await runLegacyQuestionCacheAiAudit({
        loadRows: async () => [source],
        auditQuestion: async () => ({ approved: true, status: 'approved', validLetters: ['A'] }),
        approveRow: async () => {
            approveCalls += 1;
            throw new Error('CACHE_AUDIT_APPROVAL_FAILED');
        },
        enqueueReplacement: async () => { throw new Error('should not enqueue'); },
    }, { apply: true, planFingerprint: plan.planFingerprint });

    assert.equal(approveCalls, 1);
    assert.equal(result.progress.approved, 0);
    assert.equal(result.progress.failed, 1);
});
