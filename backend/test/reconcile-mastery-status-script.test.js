'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createSupabaseDependencies,
    parseArgs,
} = require('../scripts/reconcile-mastery-status');

test('CLI defaults to dry-run and gates apply with a SHA-256 plan fingerprint', () => {
    assert.deepEqual(parseArgs([]), { apply: false, userId: null, planFingerprint: null, help: false });
    assert.throws(() => parseArgs(['--apply']), /PLAN_FINGERPRINT_REQUIRED/);
    assert.throws(() => parseArgs(['--plan-fingerprint', 'bad']), /PLAN_FINGERPRINT_VALUE_INVALID/);
    assert.deepEqual(parseArgs(['--user-id', 'user-1', '--apply', '--plan-fingerprint', 'a'.repeat(64)]), {
        apply: true,
        userId: 'user-1',
        planFingerprint: 'a'.repeat(64),
        help: false,
    });
});

test('Supabase dependencies read only required columns and apply through the atomic reconciliation RPC', async () => {
    const operations = [];
    const rows = {
        words: [{ id: 'word-1', user_id: 'user-1', feishu_record_id: 'rec-1', mastery_status: 'pending', remembered_at: null }],
        assessments: [],
    };
    const client = {
        from(table) {
            return {
                select(columns) { operations.push(['select', table, columns]); return this; },
                eq() { return this; },
                gt() { return this; },
                order() { return this; },
                limit() { return Promise.resolve({ data: rows[table] || [], error: null }); },
            };
        },
        async rpc(name, params) {
            operations.push(['rpc', name, params]);
            return { data: true, error: null };
        },
    };
    const dependencies = createSupabaseDependencies(client);

    await dependencies.loadWords({ userId: 'user-1' });
    await dependencies.loadAssessments({ userId: 'user-1' });
    await dependencies.applyWord({
        wordId: 'word-1',
        userId: 'user-1',
        storedStatus: 'pending',
        storedRememberedAt: null,
        expectedStatus: 'mastered',
        expectedRememberedAt: '2026-08-02T00:00:00.000Z',
    });

    assert.deepEqual(operations.filter(row => row[0] !== 'select'), [
        ['rpc', 'reconcile_word_mastery_status', {
            p_user_id: 'user-1',
            p_word_id: 'word-1',
            p_expected_mastery_status: 'pending',
            p_expected_remembered_at: null,
            p_new_mastery_status: 'mastered',
            p_new_remembered_at: '2026-08-02T00:00:00.000Z',
        }],
    ]);
    const selected = operations.filter(row => row[0] === 'select').map(row => row[2]).join(',');
    assert.match(selected, /question_type/);
    assert.match(selected, /submitted_answer/);
    assert.match(selected, /answer_confidence/);
    assert.doesNotMatch(selected, /question_text|correct_answer|options|secret/i);
});

test('atomic reconciliation RPC errors fail without a client-side recovery sequence', async () => {
    const calls = [];
    const client = {
        from() { throw new Error('client-side word update is forbidden'); },
        async rpc(name) {
            calls.push(name);
            return { data: null, error: new Error('database failure') };
        },
    };

    await assert.rejects(() => createSupabaseDependencies(client).applyWord({
        wordId: 'word-1', userId: 'user-1', storedStatus: 'pending', storedRememberedAt: null,
        expectedStatus: 'mastered', expectedRememberedAt: '2026-08-02T00:00:00.000Z',
    }), /WORD_RECONCILIATION_FAILED/);
    assert.deepEqual(calls, ['reconcile_word_mastery_status']);
});

test('a false atomic reconciliation result reports concurrent state change', async () => {
    const calls = [];
    const client = {
        from() { throw new Error('client-side word update is forbidden'); },
        async rpc(name) { calls.push(name); return { data: false, error: null }; },
    };

    await assert.rejects(() => createSupabaseDependencies(client).applyWord({
        wordId: 'word-1', userId: 'user-1', storedStatus: 'pending', storedRememberedAt: null,
        expectedStatus: 'recognized', expectedRememberedAt: null,
    }), /WORD_STATE_CHANGED/);

    assert.deepEqual(calls, ['reconcile_word_mastery_status']);
});
