const test = require('node:test');
const assert = require('node:assert/strict');
const {
    collectQuestionCacheSemanticAudit,
    formatAuditError,
} = require('../scripts/audit-question-cache-semantics');

function createReadOnlyClient(tableRows) {
    const calls = [];
    const forbidden = operation => {
        throw new Error(`WRITE_OR_RPC_FORBIDDEN:${operation}`);
    };
    const client = {
        from(table) {
            return {
                select(columns) {
                    calls.push({ operation: 'select', table, columns });
                    let afterId = null;
                    let pageSize = null;
                    const query = {
                        order(column, options) {
                            calls.push({ operation: 'order', table, column, options });
                            return query;
                        },
                        gt(column, value) {
                            calls.push({ operation: 'gt', table, column, value });
                            afterId = String(value);
                            return query;
                        },
                        async limit(value) {
                            calls.push({ operation: 'limit', table, value });
                            pageSize = value;
                            const ordered = [...(tableRows[table] || [])]
                                .sort((left, right) => String(left.id).localeCompare(String(right.id)));
                            const filtered = afterId === null
                                ? ordered
                                : ordered.filter(row => String(row.id) > afterId);
                            return { data: filtered.slice(0, pageSize), error: null };
                        },
                    };
                    return query;
                },
                update: () => forbidden('update'),
                delete: () => forbidden('delete'),
                upsert: () => forbidden('upsert'),
                insert: () => forbidden('insert'),
            };
        },
        rpc: () => forbidden('rpc'),
    };
    return { client, calls };
}

test('script reads the real schema, joins words, paginates, and remains read-only', async () => {
    const filler = Array.from({ length: 999 }, (_, index) => ({
        id: `retired-${index}`,
        user_id: 'user-1',
        word_id: 'word-safe',
        quality_status: 'ready',
        cache_state: 'retired',
    }));
    const questionCacheRows = [
        ...filler,
        {
            id: 'cache-cushion',
            user_id: 'user-1',
            word_id: 'word-cushion',
            level: 'middle',
            quality_status: 'ready',
            cache_state: 'active',
            question_type: 1,
            question_text: 'Use a soft _____.',
            options: ['A. cushion', 'B. pillow', 'C. bolster', 'D. pad'],
            answer: 'A',
            option_meanings: ['\u8f6f\u57ab', '\u6795\u5934', '\u957f\u6795', '\u8f6f\u57ab'],
            source_version: 'legacy-v1',
            ai_audit_status: 'skipped',
        },
        {
            id: 'cache-safe',
            user_id: 'user-1',
            word_id: 'word-safe',
            level: 'middle',
            quality_status: 'ready',
            cache_state: 'reserved_next_day',
            question_type: 1,
            question_text: 'Eat an _____.',
            options: ['A. apple', 'B. desk', 'C. chair', 'D. road'],
            answer: 'A',
            option_meanings: ['\u82f9\u679c', '\u684c\u5b50', '\u6905\u5b50', '\u9053\u8def'],
            source_version: 'current-v2',
            ai_audit_status: 'approved',
        },
    ];
    const { client, calls } = createReadOnlyClient({
        question_cache: questionCacheRows,
        users: [{ id: 'user-1', username: 'yusi' }],
        words: [
            { id: 'word-cushion', word: 'cushion' },
            { id: 'word-safe', word: 'apple' },
        ],
    });

    const report = await collectQuestionCacheSemanticAudit(client);

    assert.equal(report.scanned, 1001);
    assert.equal(report.eligibleScanned, 2);
    assert.equal(report.affected, 1);
    assert.equal(report.affectedCount, 1);
    assert.deepEqual(report.items, [{
        user: 'yusi',
        cacheId: 'cache-cushion',
        word: 'cushion',
        reasons: ['not_ai_approved', 'overlapping_option_meanings', 'duplicate_option_meanings'],
        sourceVersion: 'legacy-v1',
        aiAuditStatus: 'skipped',
    }]);

    const cacheSelect = calls.find(call => call.operation === 'select' && call.table === 'question_cache');
    assert.match(cacheSelect.columns, /(?:^|,)word_id(?:,|$)/);
    assert.doesNotMatch(cacheSelect.columns, /(?:^|,)word(?:,|$)/);
    assert.ok(calls.some(call => call.operation === 'select' && call.table === 'words' && call.columns === 'id,word'));
    assert.deepEqual(
        calls.filter(call => call.operation === 'gt' && call.table === 'question_cache').map(call => call.value),
        ['retired-997']
    );
    assert.ok(calls.some(call => call.operation === 'order'
        && call.table === 'question_cache'
        && call.column === 'id'
        && call.options?.ascending === true));
    assert.equal(calls.some(call => call.operation === 'range'), false);
    assert.ok(calls.every(call => ['select', 'order', 'gt', 'limit'].includes(call.operation)));

    const serialized = JSON.stringify(report);
    assert.doesNotMatch(serialized, /SUPABASE|service[_-]?role|secret|https?:\/\//i);
});

test('script masks credentials and URLs from errors', () => {
    const error = new Error('request failed at https://secret-project.supabase.co with service_role=secret-value');
    assert.equal(formatAuditError(error), 'QUESTION_CACHE_SEMANTIC_AUDIT_FAILED');
    assert.equal(
        formatAuditError(new Error('SUPABASE_READ_CREDENTIALS_REQUIRED')),
        'SUPABASE_READ_CREDENTIALS_REQUIRED'
    );
});
