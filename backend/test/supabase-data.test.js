const test = require('node:test');
const assert = require('node:assert/strict');

const { createSupabaseDataAdapter } = require('../supabase-data');

const MIDDLE = String.fromCharCode(0x4e2d, 0x5b66);

function createFakeSupabase(seed = {}) {
    const db = {
        users: [],
        words: [],
        assessments: [],
        question_cache: [],
        parts_of_speech: [],
        word_parts_of_speech: [],
        ...seed,
    };

    function matches(row, filters) {
        return filters.every(filter => {
            if (filter.type === 'eq') return row[filter.column] === filter.value;
            if (filter.type === 'in') return filter.values.includes(row[filter.column]);
            return true;
        });
    }

    class Query {
        constructor(table) {
            this.table = table;
            this.filters = [];
            this.limitCount = null;
            this.operation = 'select';
            this.payload = null;
        }

        select() { return this; }
        order() { return this; }
        range() { return Promise.resolve(this._result()); }
        limit(count) { this.limitCount = count; return this; }
        eq(column, value) { this.filters.push({ type: 'eq', column, value }); return this; }
        in(column, values) { this.filters.push({ type: 'in', column, values }); return this; }

        insert(payload) {
            this.operation = 'insert';
            this.payload = Array.isArray(payload) ? payload : [payload];
            return this;
        }

        update(payload) {
            this.operation = 'update';
            this.payload = payload;
            return this;
        }

        maybeSingle() {
            const { data, error } = this._result();
            return Promise.resolve({ data: data[0] || null, error });
        }

        single() {
            const { data, error } = this._result();
            return Promise.resolve({ data: data[0] || null, error });
        }

        then(resolve, reject) {
            return Promise.resolve(this._result()).then(resolve, reject);
        }

        _result() {
            const tableRows = db[this.table];
            if (!tableRows) return { data: null, error: new Error(`unknown table ${this.table}`) };

            if (this.operation === 'insert') {
                const inserted = this.payload.map(row => {
                    const next = { ...row };
                    if (!next.id && ['words', 'assessments', 'question_cache'].includes(this.table)) {
                        next.id = `${this.table}-${tableRows.length + 1}`;
                    }
                    tableRows.push(next);
                    return next;
                });
                return { data: inserted, error: null };
            }

            let rows = tableRows.filter(row => matches(row, this.filters));
            if (this.operation === 'update') {
                rows = rows.map(row => {
                    Object.assign(row, this.payload);
                    return row;
                });
            }
            if (this.limitCount !== null) rows = rows.slice(0, this.limitCount);
            return { data: rows, error: null };
        }
    }

    return {
        db,
        from(table) {
            return new Query(table);
        },
    };
}

function seededClient() {
    return createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
        words: [{
            id: 'word-1',
            feishu_record_id: 'rec-word-1',
            user_id: 'user-1',
            word: 'Apple',
            meaning_en: 'a fruit',
            level: MIDDLE,
            mastery_status: 'pending',
            entered_at: '2026-07-18T00:00:00.000Z',
        }],
        question_cache: [{
            id: 'cache-1',
            feishu_record_id: 'rec-cache-1',
            user_id: 'user-1',
            word_id: 'word-1',
            used_count: 4,
        }],
        parts_of_speech: [
            { id: 1, code: 'noun', display_name: 'noun' },
            { id: 2, code: 'adjective', display_name: 'adjective' },
        ],
    });
}

test('submitAssessment resolves username and source word record to Supabase foreign keys', async () => {
    const client = seededClient();
    const adapter = createSupabaseDataAdapter(client);

    const row = await adapter.submitAssessment({
        username: 'qiuqiu',
        word: 'Apple',
        sourceWordRecordId: 'rec-word-1',
        testId: 'real-gate4-test',
        questionType: 1,
        correctness: 'correct',
        yourAnswer: 'A',
        confidence: 'sure',
        source: 'question_cache',
        recordTime: '2026-07-19T10:30:00.000Z',
        level: MIDDLE,
        questionText: 'I ate an _____.',
        options: ['A. Apple', 'B. Pear', 'C. Chair', 'D. Desk'],
        correctAnswer: 'A',
    });

    assert.equal(row.user_id, 'user-1');
    assert.equal(row.word_id, 'word-1');
    assert.equal(row.source_word_record_id, 'rec-word-1');
    assert.equal(row.word_snapshot, 'Apple');
    assert.equal(row.question_type, '1');
    assert.equal(row.is_correct, 'correct');
    assert.equal(row.submitted_answer, 'A');
    assert.equal(row.answer_confidence, 'sure');
    assert.equal(row.learning_day, '2026-07-19');
});

test('updateWordMastery updates the resolved user word row', async () => {
    const client = seededClient();
    const adapter = createSupabaseDataAdapter(client);

    const rows = await adapter.updateWordMastery('qiuqiu', 'Apple', 'mastered');

    assert.equal(rows.length, 1);
    assert.equal(client.db.words[0].mastery_status, 'mastered');
    assert.ok(client.db.words[0].remembered_at);
});

test('incrementCacheUsedCount resolves Feishu cache IDs before updating used_count', async () => {
    const client = seededClient();
    const adapter = createSupabaseDataAdapter(client);

    const row = await adapter.incrementCacheUsedCount('rec-cache-1');

    assert.equal(row.id, 'cache-1');
    assert.equal(row.used_count, 5);
    assert.ok(row.last_used_at);
});

test('addWord inserts a word and ordered parts of speech junction rows', async () => {
    const client = seededClient();
    const adapter = createSupabaseDataAdapter(client);

    const row = await adapter.addWord({
        username: 'qiuqiu',
        word: 'candid',
        meaning: 'honest and direct',
        level: MIDDLE,
        partsOfSpeech: 'n., adjective',
        recordTime: '2026-07-19T12:00:00.000Z',
    });

    assert.equal(row.user_id, 'user-1');
    assert.equal(row.word, 'candid');
    assert.equal(row.meaning_en, 'honest and direct');
    assert.equal(row.mastery_status, 'pending');
    assert.deepEqual(client.db.word_parts_of_speech.slice(-2), [
        { word_id: row.id, part_of_speech_id: 1, position: 1 },
        { word_id: row.id, part_of_speech_id: 2, position: 2 },
    ]);
});
