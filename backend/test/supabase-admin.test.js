'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createSupabaseAdminAdapter } = require('../supabase-admin');

function createFakeSupabase(seed = {}, { errors = {} } = {}) {
    const db = {
        users: [],
        words: [],
        ...seed,
    };
    const operations = [];

    class Query {
        constructor(table) {
            this.table = table;
            this.operation = 'select';
            this.payload = null;
            this.filters = [];
            this.orders = [];
            this.from = null;
            this.to = null;
        }

        select(columns) {
            this.columns = columns;
            return this;
        }

        update(payload) {
            this.operation = 'update';
            this.payload = payload;
            return this;
        }

        eq(column, value) {
            this.filters.push({ column, value });
            return this;
        }

        order(column, options = {}) {
            this.orders.push({ column, ascending: options.ascending !== false });
            return this;
        }

        range(from, to) {
            this.from = from;
            this.to = to;
            return Promise.resolve(this.execute());
        }

        maybeSingle() {
            const result = this.execute();
            return Promise.resolve({ ...result, data: result.data?.[0] || null });
        }

        single() {
            const result = this.execute();
            return Promise.resolve({ ...result, data: result.data?.[0] || null });
        }

        then(resolve, reject) {
            return Promise.resolve(this.execute()).then(resolve, reject);
        }

        execute() {
            operations.push({
                table: this.table,
                operation: this.operation,
                payload: this.payload && { ...this.payload },
                filters: this.filters.map(filter => ({ ...filter })),
                columns: this.columns,
            });
            if (errors[this.table]) return { data: null, error: errors[this.table] };
            let rows = (db[this.table] || []).filter(row =>
                this.filters.every(filter => row[filter.column] === filter.value)
            );
            for (const order of this.orders.slice().reverse()) {
                rows = rows.slice().sort((left, right) => {
                    const result = String(left[order.column] ?? '').localeCompare(String(right[order.column] ?? ''));
                    return order.ascending ? result : -result;
                });
            }
            if (this.operation === 'update') {
                rows.forEach(row => Object.assign(row, this.payload));
            }
            if (this.from !== null) rows = rows.slice(this.from, this.to + 1);
            return { data: rows.map(row => ({ ...row })), error: null };
        }
    }

    return {
        client: { from: table => new Query(table) },
        db,
        operations,
    };
}

function seededDatabase() {
    return createFakeSupabase({
        users: [
            { id: 'user-draggy', username: 'Draggy', username_key: 'draggy' },
            { id: 'user-empty', username: 'NoWords', username_key: 'nowords' },
            { id: 'user-yusi', username: 'yusi', username_key: 'yusi' },
        ],
        words: [
            {
                id: 'word-pillow', feishu_record_id: 'rec-pillow', user_id: 'user-yusi',
                word: 'pillow', meaning_en: 'a head support', meaning_zh: '枕头',
                context_en: 'Put your head on the pillow.', context_zh: '把头放在枕头上。',
                distractors: ['blanket', 'sheet'], mastery_status: 'pending',
                quality_flags: ['ambiguous_option'], quality_note: 'cushion overlaps', level: 'high_school',
                entered_at: '2026-08-01T00:00:00.000Z',
            },
            {
                id: 'word-clean', feishu_record_id: 'rec-clean', user_id: 'user-yusi',
                word: 'clear', mastery_status: 'pending', quality_flags: [], quality_note: null,
            },
            {
                id: 'word-draggy', feishu_record_id: null, user_id: 'user-draggy',
                word: 'groan', mastery_status: 'pending', quality_flags: [], quality_note: 'inspect meaning',
            },
            {
                id: 'word-mastered', feishu_record_id: 'rec-mastered', user_id: 'user-yusi',
                word: 'done', mastery_status: 'mastered', quality_flags: ['legacy'], quality_note: 'old',
            },
        ],
    });
}

test('getAllUsers enumerates public.users directly, including users with no words', async () => {
    const db = seededDatabase();
    const admin = createSupabaseAdminAdapter(db.client);

    assert.deepEqual(await admin.getAllUsers(), ['Draggy', 'NoWords', 'yusi']);
    assert.equal(db.operations.some(operation => operation.table === 'words'), false);
    assert.ok(db.operations.some(operation =>
        operation.table === 'users'
        && operation.operation === 'select'
        && operation.columns === 'username, username_key'
    ));
});

test('getReviewWords returns flagged non-mastered words for all users in the existing API shape', async () => {
    const admin = createSupabaseAdminAdapter(seededDatabase().client);

    const words = await admin.getReviewWords();

    assert.deepEqual(words.map(word => word.record_id), ['word-draggy', 'rec-pillow']);
    assert.deepEqual(words.map(word => word.user), ['Draggy', 'yusi']);
    assert.equal(words[1].word, 'pillow');
    assert.equal(words[1].qualityFlags, 'ambiguous_option');
    assert.equal(words[1].qualityNote, 'cushion overlaps');
    assert.equal(words.some(word => word.word === 'done'), false);
});

test('getReviewWords filters by normalized username without deriving identity from words', async () => {
    const db = seededDatabase();
    const admin = createSupabaseAdminAdapter(db.client);

    const words = await admin.getReviewWords(' YU SI ');

    assert.deepEqual(words.map(word => word.record_id), ['rec-pillow']);
    assert.ok(db.operations.some(operation =>
        operation.table === 'users'
        && operation.filters.some(filter => filter.column === 'username_key' && filter.value === 'yusi')
    ));
});

test('markWordForReview updates only an owned word and normalizes flags for text[]', async () => {
    const db = seededDatabase();
    const admin = createSupabaseAdminAdapter(db.client);

    assert.deepEqual(
        await admin.markWordForReview('rec-clean', 'manual_review, ambiguous_option', 'check choices', ' YUSI '),
        { success: true }
    );
    assert.deepEqual(db.db.words.find(word => word.id === 'word-clean').quality_flags, ['manual_review', 'ambiguous_option']);
    assert.equal(db.db.words.find(word => word.id === 'word-clean').quality_note, 'check choices');
    const update = db.operations.find(operation => operation.operation === 'update');
    assert.ok(update.filters.some(filter => filter.column === 'id' && filter.value === 'word-clean'));
    assert.ok(update.filters.some(filter => filter.column === 'user_id' && filter.value === 'user-yusi'));
});

test('markWordForReview applies the stable default flag', async () => {
    const db = seededDatabase();
    const admin = createSupabaseAdminAdapter(db.client);

    await admin.markWordForReview('rec-clean', '', '', 'yusi');

    assert.deepEqual(db.db.words.find(word => word.id === 'word-clean').quality_flags, ['manual_review']);
    assert.equal(db.db.words.find(word => word.id === 'word-clean').quality_note, '');
});

test('clearWordReview clears an owned word identified by its Supabase id', async () => {
    const db = seededDatabase();
    const admin = createSupabaseAdminAdapter(db.client);

    assert.deepEqual(await admin.clearWordReview('word-pillow', 'yusi'), { success: true });
    assert.deepEqual(db.db.words.find(word => word.id === 'word-pillow').quality_flags, []);
    assert.equal(db.db.words.find(word => word.id === 'word-pillow').quality_note, '');
});

test('mark and clear reject cross-user records without issuing an update', async () => {
    for (const operation of ['mark', 'clear']) {
        const db = seededDatabase();
        const admin = createSupabaseAdminAdapter(db.client);
        const action = operation === 'mark'
            ? admin.markWordForReview('rec-pillow', ['manual_review'], 'note', 'Draggy')
            : admin.clearWordReview('rec-pillow', 'Draggy');

        await assert.rejects(action, error => error.message === 'WORD_NOT_FOUND');
        assert.equal(db.operations.some(entry => entry.operation === 'update'), false);
    }
});

test('mark and clear require an owner instead of allowing an unscoped update', async () => {
    const admin = createSupabaseAdminAdapter(seededDatabase().client);

    await assert.rejects(
        admin.markWordForReview('rec-pillow', [], '', ''),
        error => error.message === 'WORD_OWNER_REQUIRED'
    );
    await assert.rejects(
        admin.clearWordReview('rec-pillow'),
        error => error.message === 'WORD_OWNER_REQUIRED'
    );
});

test('database errors are reported with a stable admin error', async () => {
    const marker = 'provider-secret-detail';
    const db = createFakeSupabase({}, { errors: { users: { message: marker, code: 'XX000' } } });
    const admin = createSupabaseAdminAdapter(db.client);

    await assert.rejects(
        admin.getAllUsers(),
        error => error.message === 'admin data service unavailable'
            && error.code === 'ADMIN_DATABASE_ERROR'
            && !error.message.includes(marker)
            && error.cause?.message === marker
    );
});
