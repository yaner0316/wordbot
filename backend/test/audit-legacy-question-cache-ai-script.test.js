'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function loadWithScriptDependencyStubs(request, parent, isMain) {
    if (request === 'dotenv') return { config() {} };
    if (request === '@supabase/supabase-js') return { createClient() {} };
    return originalLoad.call(this, request, parent, isMain);
};
const { parseArguments, safeErrorCode } = require('../scripts/audit-legacy-question-cache-ai');
const { createDependencies } = require('../scripts/audit-legacy-question-cache-ai');
Module._load = originalLoad;

test('legacy AI audit CLI is bounded and dry-run by default', () => {
    assert.deepEqual(parseArguments([]), { apply: false, planFingerprint: '', afterId: '', limit: 50 });
    assert.deepEqual(parseArguments(['--limit', '500', '--after-id', 'cache-9']), {
        apply: false, planFingerprint: '', afterId: 'cache-9', limit: 100,
    });
});

test('legacy AI audit CLI requires an exact apply flag and redacts dependency errors', () => {
    assert.deepEqual(parseArguments(['--apply', '--plan-fingerprint', 'abc']), {
        apply: true, planFingerprint: 'abc', afterId: '', limit: 50,
    });
    assert.throws(() => parseArguments(['--write']), /INVALID_ARGUMENT/);
    assert.equal(safeErrorCode(new Error('fetch failed https://secret.example/key')), 'LEGACY_QUESTION_CACHE_AI_AUDIT_FAILED');
});

function createApprovalClient(currentRow) {
    const calls = [];
    const client = {
        from(table) {
            calls.push({ method: 'from', table });
            const filters = [];
            const query = {
                update(payload) {
                    calls.push({ method: 'update', payload });
                    return query;
                },
                eq(column, value) {
                    calls.push({ method: 'eq', column, value });
                    filters.push({ type: 'eq', column, value });
                    return query;
                },
                in(column, values) {
                    calls.push({ method: 'in', column, values });
                    filters.push({ type: 'in', column, values });
                    return query;
                },
                or(expression) {
                    calls.push({ method: 'or', expression });
                    filters.push({ type: 'or', expression });
                    return query;
                },
                select(fields) {
                    calls.push({ method: 'select', fields });
                    const matches = filters.every(filter => {
                        if (filter.type === 'eq') return String(currentRow[filter.column]) === String(filter.value);
                        if (filter.type === 'in') return filter.values.map(String).includes(String(currentRow[filter.column]));
                        if (filter.type === 'or') {
                            return currentRow.ai_audit_status == null || String(currentRow.ai_audit_status).toLowerCase() !== 'approved';
                        }
                        return true;
                    });
                    return Promise.resolve({ data: matches ? [{ id: currentRow.id }] : [], error: null });
                },
            };
            return query;
        },
    };
    return { client, calls };
}

test('legacy AI approval update has all state fences and rejects every changed state', async () => {
    const item = {
        cacheId: 'cache-1',
        userId: 'user-1',
        wordId: 'word-1',
        rowVersion: '2026-08-19T00:00:00.000Z',
    };
    const changes = [
        ['quality_status', 'stale'],
        ['cache_state', 'retired'],
        ['question_type', '2'],
        ['ai_audit_status', 'approved'],
    ];

    for (const [field, value] of changes) {
        const currentRow = {
            id: 'cache-1',
            user_id: 'user-1',
            word_id: 'word-1',
            updated_at: '2026-08-19T00:00:00.000Z',
            quality_status: 'ready',
            cache_state: 'active',
            question_type: '1',
            ai_audit_status: 'skipped',
            [field]: value,
        };
        const { client, calls } = createApprovalClient(currentRow);
        const { approveRow } = createDependencies(client, { afterId: '', limit: 50 });

        await assert.rejects(approveRow(item), /CACHE_AUDIT_APPROVAL_FAILED/, field);
        assert.ok(calls.some(call => call.method === 'eq' && call.column === 'updated_at' && call.value === item.rowVersion));
        assert.ok(calls.some(call => call.method === 'eq' && call.column === 'quality_status' && call.value === 'ready'));
        assert.ok(calls.some(call => call.method === 'in' && call.column === 'cache_state'
            && JSON.stringify(call.values) === JSON.stringify(['active', 'reserved_next_day'])));
        assert.ok(calls.some(call => call.method === 'eq' && call.column === 'question_type' && call.value === '1'));
        assert.ok(calls.some(call => call.method === 'or'
            && call.expression === 'ai_audit_status.is.null,ai_audit_status.neq.approved'));
    }
});
