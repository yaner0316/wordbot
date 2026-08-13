'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createPlanFingerprint,
    planMasteryStatusReconciliation,
    reconcileMasteryStatus,
} = require('../mastery-status-reconciliation');

function word(overrides = {}) {
    return {
        id: 'word-1',
        user_id: 'user-1',
        feishu_record_id: 'rec-1',
        mastery_status: 'pending',
        remembered_at: null,
        ...overrides,
    };
}

function assessment(overrides = {}) {
    return {
        id: 'assessment-1',
        user_id: 'user-1',
        word_id: 'word-1',
        source_word_record_id: 'rec-1',
        test_id: 'real-quiz-1',
        assessment_kind: 'formal',
        is_real_assessment: true,
        assessed_at: '2026-08-01T00:00:00.000Z',
        is_correct: 'correct',
        submitted_answer: '1',
        answer_confidence: 'sure',
        question_type: 1,
        ...overrides,
    };
}

test('plans all four mastery states from submitted formal assessment evidence', () => {
    const words = [
        word({ id: 'pending', feishu_record_id: 'rec-pending', mastery_status: 'recognized' }),
        word({ id: 'recognized', feishu_record_id: 'rec-recognized', mastery_status: 'pending' }),
        word({ id: 'consolidating', feishu_record_id: 'rec-consolidating', mastery_status: 'pending' }),
        word({ id: 'mastered', feishu_record_id: 'rec-mastered', mastery_status: 'pending' }),
    ];
    const assessments = [
        assessment({ id: 'wrong', word_id: 'recognized', source_word_record_id: 'rec-recognized', is_correct: 'wrong' }),
        assessment({ id: 'correct', word_id: 'consolidating', source_word_record_id: 'rec-consolidating' }),
        assessment({ id: 'master-1', word_id: 'mastered', source_word_record_id: 'rec-mastered' }),
        assessment({ id: 'master-2', word_id: 'mastered', source_word_record_id: 'rec-mastered', assessed_at: '2026-08-02T00:00:00.000Z' }),
        assessment({ id: 'review', word_id: 'pending', source_word_record_id: 'rec-pending', test_id: 'real-review-1', assessment_kind: 'review' }),
        assessment({ id: 'draft', word_id: 'pending', source_word_record_id: 'rec-pending', is_correct: null, submitted_answer: null }),
    ];

    const result = planMasteryStatusReconciliation({ words, assessments });

    assert.deepEqual(result.changes.map(change => [change.wordId, change.storedStatus, change.expectedStatus]), [
        ['consolidating', 'pending', 'consolidating'],
        ['mastered', 'pending', 'mastered'],
        ['pending', 'recognized', 'pending'],
        ['recognized', 'pending', 'recognized'],
    ]);
    assert.equal(result.changes.find(change => change.wordId === 'mastered').expectedRememberedAt, '2026-08-02T00:00:00.000Z');
    assert.equal(result.summary.scannedWords, 4);
    assert.equal(result.summary.mismatches, 4);
    assert.deepEqual(result.summary.expectedStatuses, { pending: 1, recognized: 1, consolidating: 1, mastered: 1 });
});

test('matches assessments by owned word id or an unambiguous legacy source id and ignores foreign evidence', () => {
    const result = planMasteryStatusReconciliation({
        words: [word(), word({ id: 'word-2', feishu_record_id: 'rec-2' })],
        assessments: [
            assessment({ user_id: 'user-2', word_id: 'word-1' }),
            assessment({ id: 'legacy', user_id: 'user-1', word_id: null, source_word_record_id: 'rec-1' }),
            assessment({ id: 'orphan', user_id: 'user-1', word_id: null, source_word_record_id: 'removed-record' }),
        ],
    });

    assert.deepEqual(result.changes.map(change => change.wordId), ['word-1']);
    assert.equal(result.changes[0].expectedStatus, 'consolidating');
    assert.deepEqual(result.summary.expectedStatuses, { pending: 1, recognized: 0, consolidating: 1, mastered: 0 });
});

test('does not attach source-only legacy evidence when the source id is ambiguous', () => {
    const result = planMasteryStatusReconciliation({
        words: [
            word({ id: 'word-1', feishu_record_id: 'duplicate-source' }),
            word({ id: 'word-2', feishu_record_id: 'duplicate-source' }),
        ],
        assessments: [assessment({ word_id: null, source_word_record_id: 'duplicate-source' })],
    });

    assert.equal(result.changes.length, 0);
    assert.deepEqual(result.summary.expectedStatuses, { pending: 2, recognized: 0, consolidating: 0, mastered: 0 });
    assert.deepEqual(result.byUser, [{ userId: 'user-1', scannedWords: 2, mismatches: 0, transitions: {} }]);
});

test('reports mismatches by user without exposing assessment content', () => {
    const result = planMasteryStatusReconciliation({
        words: [word({ mastery_status: 'mastered', remembered_at: '2026-01-01T00:00:00.000Z' })],
        assessments: [],
    });

    assert.deepEqual(result.byUser, [{
        userId: 'user-1',
        scannedWords: 1,
        mismatches: 1,
        transitions: { 'mastered->pending': 1 },
    }]);
    assert.equal(result.changes[0].expectedRememberedAt, null);
    assert.equal(JSON.stringify(result).includes('submitted_answer'), false);
});

test('plan fingerprint is stable across input order and changes with the plan', () => {
    const first = [
        { wordId: 'b', userId: 'u', storedStatus: 'pending', expectedStatus: 'recognized', storedRememberedAt: null, expectedRememberedAt: null },
        { wordId: 'a', userId: 'u', storedStatus: 'pending', expectedStatus: 'mastered', storedRememberedAt: null, expectedRememberedAt: '2026-08-02T00:00:00.000Z' },
    ];
    const second = [...first].reverse();

    assert.equal(createPlanFingerprint({ userId: null, changes: first }), createPlanFingerprint({ userId: null, changes: second }));
    assert.notEqual(
        createPlanFingerprint({ userId: null, changes: first }),
        createPlanFingerprint({ userId: 'u', changes: first }),
    );
});

test('defaults to dry-run and requires an exact current fingerprint before apply', async () => {
    const rows = [word({ mastery_status: 'pending' })];
    const assessments = [assessment()];
    const applied = [];
    const dependencies = {
        loadWords: async () => rows,
        loadAssessments: async () => assessments,
        applyWord: async change => applied.push(change),
    };

    const dryRun = await reconcileMasteryStatus(dependencies);
    assert.equal(dryRun.mode, 'dry-run');
    assert.equal(dryRun.planned, 1);
    assert.equal(applied.length, 0);
    await assert.rejects(() => reconcileMasteryStatus(dependencies, { apply: true }), /PLAN_FINGERPRINT_REQUIRED/);
    await assert.rejects(
        () => reconcileMasteryStatus(dependencies, { apply: true, planFingerprint: '0'.repeat(64) }),
        /PLAN_FINGERPRINT_MISMATCH/,
    );

    const result = await reconcileMasteryStatus(dependencies, { apply: true, planFingerprint: dryRun.planFingerprint });
    assert.equal(result.applied, 1);
    assert.equal(result.failed, 0);
    assert.equal(applied.length, 1);
});

test('data changes invalidate a reviewed plan before any write', async () => {
    let words = [word({ mastery_status: 'pending' })];
    const writes = [];
    const dependencies = {
        loadWords: async () => words,
        loadAssessments: async () => [assessment()],
        applyWord: async change => writes.push(change),
    };
    const dryRun = await reconcileMasteryStatus(dependencies);
    words = [word({ mastery_status: 'recognized' })];

    await assert.rejects(
        () => reconcileMasteryStatus(dependencies, { apply: true, planFingerprint: dryRun.planFingerprint }),
        /PLAN_FINGERPRINT_MISMATCH/,
    );
    assert.equal(writes.length, 0);
});

test('a concurrent word-state change aborts the remaining apply plan', async () => {
    const words = [word({ id: 'word-1' }), word({ id: 'word-2', feishu_record_id: 'rec-2' })];
    const assessments = [
        assessment({ word_id: 'word-1', source_word_record_id: 'rec-1' }),
        assessment({ id: 'assessment-2', word_id: 'word-2', source_word_record_id: 'rec-2' }),
    ];
    const attempts = [];
    const dependencies = {
        loadWords: async () => words,
        loadAssessments: async () => assessments,
        applyWord: async change => {
            attempts.push(change.wordId);
            throw new Error('WORD_STATE_CHANGED');
        },
    };
    const dryRun = await reconcileMasteryStatus(dependencies);

    await assert.rejects(
        () => reconcileMasteryStatus(dependencies, { apply: true, planFingerprint: dryRun.planFingerprint }),
        /WORD_STATE_CHANGED/,
    );
    assert.deepEqual(attempts, ['word-1']);
});
