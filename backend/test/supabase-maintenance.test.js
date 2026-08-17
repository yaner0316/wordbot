'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createSupabaseMaintenanceAdapter } = require('../supabase-maintenance');

function createFakeSupabase(seed = {}, { errors = {}, beforeUpdate = null } = {}) {
    const db = {
        users: [],
        words: [],
        assessments: [],
        ...seed,
    };
    const operations = [];

    function matches(row, filters) {
        return filters.every(filter => {
            if (filter.type === 'eq') return row[filter.column] === filter.value;
            if (filter.type === 'is') return row[filter.column] === filter.value;
            if (filter.type === 'like') {
                assert.equal(filter.value, 'test-%');
                return String(row[filter.column] || '').startsWith('test-');
            }
            if (filter.type === 'gte') return row[filter.column] >= filter.value;
            return true;
        });
    }

    class Query {
        constructor(table) {
            this.table = table;
            this.operation = 'select';
            this.payload = null;
            this.filters = [];
            this.rangeStart = null;
            this.rangeEnd = null;
        }

        select(columns) { this.columns = columns; return this; }
        delete() { this.operation = 'delete'; return this; }
        update(payload) { this.operation = 'update'; this.payload = payload; return this; }
        eq(column, value) { this.filters.push({ type: 'eq', column, value }); return this; }
        is(column, value) { this.filters.push({ type: 'is', column, value }); return this; }
        like(column, value) { this.filters.push({ type: 'like', column, value }); return this; }
        gte(column, value) { this.filters.push({ type: 'gte', column, value }); return this; }
        range(start, end) {
            this.rangeStart = start;
            this.rangeEnd = end;
            return Promise.resolve(this.execute());
        }
        maybeSingle() {
            const result = this.execute();
            return Promise.resolve({ ...result, data: result.data?.[0] || null });
        }
        then(resolve, reject) { return Promise.resolve(this.execute()).then(resolve, reject); }

        execute() {
            const operation = {
                table: this.table,
                operation: this.operation,
                payload: this.payload && { ...this.payload },
                filters: this.filters.map(filter => ({ ...filter })),
                columns: this.columns,
            };
            operations.push(operation);
            if (errors[this.table]) return { data: null, error: errors[this.table] };
            let rows = db[this.table].filter(row => matches(row, this.filters));
            if (this.operation === 'delete') {
                for (let index = db[this.table].length - 1; index >= 0; index--) {
                    if (matches(db[this.table][index], this.filters)) db[this.table].splice(index, 1);
                }
            }
            if (this.operation === 'update') {
                beforeUpdate?.({ operation, db });
                rows = db[this.table].filter(row => matches(row, this.filters));
                rows.forEach(row => Object.assign(row, this.payload));
            }
            let result = rows.map(row => ({ ...row }));
            if (this.rangeStart !== null) result = result.slice(this.rangeStart, this.rangeEnd + 1);
            return { data: result, error: null };
        }
    }

    return {
        client: { from: table => new Query(table) },
        db,
        operations,
    };
}

test('deleteUserTestData deletes only the selected user test assessments', async () => {
    const fake = createFakeSupabase({
        users: [
            { id: 'user-q', username: 'qiuqiu', username_key: 'qiuqiu' },
            { id: 'user-y', username: 'yusi', username_key: 'yusi' },
        ],
        words: [{ id: 'word-q', user_id: 'user-q', word: 'groan' }],
        assessments: [
            { id: 'q-test', user_id: 'user-q', test_id: 'test-preview', assessed_at: '2026-08-16T00:00:00.000Z' },
            { id: 'q-real', user_id: 'user-q', test_id: 'real-quiz', assessed_at: '2026-08-16T00:00:00.000Z' },
            { id: 'y-test', user_id: 'user-y', test_id: 'test-preview', assessed_at: '2026-08-16T00:00:00.000Z' },
        ],
    });
    const adapter = createSupabaseMaintenanceAdapter(fake.client);

    assert.deepEqual(await adapter.deleteUserTestData('QIU QIU'), { success: true, deleted: 1, rebuilt: 0 });
    assert.deepEqual(fake.db.assessments.map(row => row.id), ['q-real', 'y-test']);
    assert.equal(fake.db.words.length, 1);
    assert.equal(fake.db.users.length, 2);
    assert.deepEqual(fake.operations.at(-1).filters, [
        { type: 'eq', column: 'user_id', value: 'user-q' },
        { type: 'like', column: 'test_id', value: 'test-%' },
    ]);
});

test('deleteUserTestData applies an inclusive recent-days boundary and keeps zero compatible with delete-all', async () => {
    const now = Date.parse('2026-08-17T12:00:00.000Z');
    const seed = () => ({
        users: [{ id: 'user-q', username: 'qiuqiu', username_key: 'qiuqiu' }],
        assessments: [
            { id: 'inside', user_id: 'user-q', test_id: 'test-inside', assessed_at: '2026-08-16T12:00:00.000Z' },
            { id: 'older', user_id: 'user-q', test_id: 'test-older', assessed_at: '2026-08-16T11:59:59.999Z' },
        ],
    });
    const recent = createFakeSupabase(seed());
    const recentAdapter = createSupabaseMaintenanceAdapter(recent.client, { now: () => now });

    assert.equal((await recentAdapter.deleteUserTestData('qiuqiu', 1)).deleted, 1);
    assert.deepEqual(recent.db.assessments.map(row => row.id), ['older']);

    const all = createFakeSupabase(seed());
    const allAdapter = createSupabaseMaintenanceAdapter(all.client, { now: () => now });
    assert.equal((await allAdapter.deleteUserTestData('qiuqiu', 0)).deleted, 2);
});

test('deleteUserTestData fails closed for missing users, invalid days, and database errors', async () => {
    const fake = createFakeSupabase({
        users: [{ id: 'user-q', username: 'qiuqiu', username_key: 'qiuqiu' }],
    });
    const adapter = createSupabaseMaintenanceAdapter(fake.client);

    await assert.rejects(adapter.deleteUserTestData('', null), { code: 'MAINTENANCE_USER_REQUIRED' });
    await assert.rejects(adapter.deleteUserTestData('qiuqiu', 'not-a-number'), { code: 'MAINTENANCE_INVALID_DAYS' });
    await assert.rejects(adapter.deleteUserTestData('qiuqiu', Number.MAX_VALUE), { code: 'MAINTENANCE_INVALID_DAYS' });
    assert.deepEqual(await adapter.deleteUserTestData('missing', null), { success: true, deleted: 0, rebuilt: 0 });

    const broken = createFakeSupabase({}, { errors: { users: { code: 'XX000', message: 'hidden database detail' } } });
    await assert.rejects(createSupabaseMaintenanceAdapter(broken.client).deleteUserTestData('qiuqiu'), {
        code: 'MAINTENANCE_DATABASE_ERROR',
        message: 'maintenance data service unavailable',
    });
});

test('backfillTranslations fills only empty fields in the selected user scope', async () => {
    const fake = createFakeSupabase({
        users: [
            { id: 'user-q', username: 'qiuqiu', username_key: 'qiuqiu' },
            { id: 'user-y', username: 'yusi', username_key: 'yusi' },
        ],
        words: [
            { id: 'word-q', user_id: 'user-q', meaning_en: 'a low sound', meaning_zh: null, context_en: 'He gave a groan.', context_zh: '' },
            { id: 'word-existing', user_id: 'user-q', meaning_en: 'soft support', meaning_zh: '枕头', context_en: 'Use a pillow.', context_zh: '用一个枕头。' },
            { id: 'word-y', user_id: 'user-y', meaning_en: 'a cushion', meaning_zh: null, context_en: 'Use a cushion.', context_zh: null },
        ],
    });
    const adapter = createSupabaseMaintenanceAdapter(fake.client, {
        translateWords: async meanings => Object.fromEntries(meanings.map(value => [value, '低沉的声音'])),
        translateContext: async () => '他发出一声呻吟。',
    });

    assert.deepEqual(await adapter.backfillTranslations('QIU QIU'), {
        cnFilled: 1,
        cnSkipped: 0,
        ctxFilled: 1,
        ctxSkipped: 0,
        total: 2,
    });
    assert.equal(fake.db.words[0].meaning_zh, '低沉的声音');
    assert.equal(fake.db.words[0].context_zh, '他发出一声呻吟。');
    assert.equal(fake.db.words[1].meaning_zh, '枕头');
    assert.equal(fake.db.words[2].meaning_zh, null);
    const updates = fake.operations.filter(operation => operation.operation === 'update');
    assert.equal(updates.length, 2);
    assert.equal(updates.every(operation => operation.filters.some(filter => filter.column === 'user_id' && filter.value === 'user-q')), true);
});

test('backfillTranslations never overwrites a value filled concurrently', async () => {
    let raced = false;
    const fake = createFakeSupabase({
        users: [{ id: 'user-q', username: 'qiuqiu', username_key: 'qiuqiu' }],
        words: [{ id: 'word-q', user_id: 'user-q', meaning_en: 'a low sound', meaning_zh: null, context_en: '', context_zh: null }],
    }, {
        beforeUpdate: ({ operation, db }) => {
            if (!raced && operation.table === 'words' && operation.payload?.meaning_zh) {
                raced = true;
                db.words[0].meaning_zh = '并发写入值';
            }
        },
    });
    const adapter = createSupabaseMaintenanceAdapter(fake.client, {
        translateWords: async () => ({ 'a low sound': '低沉的声音' }),
    });

    assert.deepEqual(await adapter.backfillTranslations('qiuqiu'), {
        cnFilled: 0,
        cnSkipped: 1,
        ctxFilled: 0,
        ctxSkipped: 0,
        total: 1,
    });
    assert.equal(fake.db.words[0].meaning_zh, '并发写入值');
});

test('backfillTranslations skips unusable translations and fails closed on database errors', async () => {
    const fake = createFakeSupabase({
        users: [{ id: 'user-q', username: 'qiuqiu', username_key: 'qiuqiu' }],
        words: [{ id: 'word-q', user_id: 'user-q', meaning_en: 'a low sound', meaning_zh: null, context_en: 'He gave a groan.', context_zh: null }],
    });
    const adapter = createSupabaseMaintenanceAdapter(fake.client, {
        translateWords: async () => ({ 'a low sound': 'English only' }),
        translateContext: async () => 'not Chinese',
    });

    assert.deepEqual(await adapter.backfillTranslations('qiuqiu'), {
        cnFilled: 0,
        cnSkipped: 1,
        ctxFilled: 0,
        ctxSkipped: 1,
        total: 1,
    });

    const broken = createFakeSupabase({
        users: [{ id: 'user-q', username: 'qiuqiu', username_key: 'qiuqiu' }],
    }, { errors: { words: { code: 'XX000', message: 'hidden database detail' } } });
    await assert.rejects(createSupabaseMaintenanceAdapter(broken.client).backfillTranslations('qiuqiu'), {
        code: 'MAINTENANCE_DATABASE_ERROR',
    });
});
