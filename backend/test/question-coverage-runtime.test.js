'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createSupabaseQuestionCoverageRuntime } = require('../question-coverage-runtime');

function createClient() {
    const tables = {
        users: [{ id: 'user-1', learning_level: '小学' }],
        words: [{ id: 'word-1', user_id: 'user-1', word: 'bank', mastery_status: 'pending', question_generation_version: 2 }],
        question_cache: [],
        question_generation_jobs: [],
    };
    const calls = [];
    return {
        calls,
        from(table) {
            const query = {
                select(columns) { calls.push(['select', table, columns]); return query; },
                gt() { return query; },
                order() { return query; },
                limit() { return Promise.resolve({ data: tables[table], error: null }); },
            };
            return query;
        },
        async rpc(name, params) {
            calls.push(['rpc', name, params]);
            return { data: true, error: null };
        },
    };
}

test('Supabase coverage runtime scans all target inputs and durably enqueues missing coverage', async () => {
    const client = createClient();
    const runtime = createSupabaseQuestionCoverageRuntime({ client, runImmediately: false });

    const result = await runtime.reconcile();

    assert.equal(result.enqueued, 1);
    assert.deepEqual(client.calls.filter(call => call[0] === 'rpc'), [[
        'rpc',
        'enqueue_question_generation_job_if_needed',
        { p_user_id: 'user-1', p_word_id: 'word-1', p_reason: 'coverage_reconcile' },
    ]]);
    assert.ok(client.calls.some(call => call[0] === 'select' && call[1] === 'users'));
    assert.ok(client.calls.some(call => call[0] === 'select' && call[1] === 'question_cache'));
});

test('Supabase coverage runtime rejects an unconfirmed enqueue', async () => {
    const client = createClient();
    client.rpc = async () => ({ data: false, error: null });
    const runtime = createSupabaseQuestionCoverageRuntime({ client, runImmediately: false });

    await assert.rejects(runtime.reconcile(), /QUESTION_COVERAGE_ENQUEUE_NOT_CONFIRMED/);
});
