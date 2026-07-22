const test = require('node:test');
const assert = require('node:assert/strict');

const { createSupabaseDataAdapter } = require('../supabase-data');

const MIDDLE = String.fromCharCode(0x4e2d, 0x5b66);

function createFakeSupabase(seed = {}, options = {}) {
    const db = {
        users: [],
        words: [],
        assessments: [],
        question_cache: [],
        quiz_sessions: [],
        parts_of_speech: [],
        word_parts_of_speech: [],
        ...seed,
    };

    function matches(row, filters) {
        return filters.every(filter => {
            if (filter.type === 'eq') return row[filter.column] === filter.value;
            if (filter.type === 'in') return filter.values.includes(row[filter.column]);
            if (filter.type === 'gt') return row[filter.column] > filter.value;
            if (filter.type === 'lt') return row[filter.column] < filter.value;
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
        gt(column, value) { this.filters.push({ type: 'gt', column, value }); return this; }
        lt(column, value) { this.filters.push({ type: 'lt', column, value }); return this; }

        insert(payload) {
            this.operation = 'insert';
            this.payload = Array.isArray(payload) ? payload : [payload];
            return this;
        }

        upsert(payload) {
            this.operation = 'upsert';
            this.payload = Array.isArray(payload) ? payload : [payload];
            return this;
        }

        update(payload) {
            this.operation = 'update';
            this.payload = payload;
            return this;
        }

        delete() {
            this.operation = 'delete';
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

            if (this.operation === 'insert' || this.operation === 'upsert') {
                const missingColumns = options.missingColumns?.[this.table] || [];
                const missingColumn = missingColumns.find(column =>
                    this.payload.some(row => Object.prototype.hasOwnProperty.call(row, column))
                );
                if (missingColumn) {
                    return {
                        data: null,
                        error: {
                            code: 'PGRST204',
                            message: "Could not find the '" + missingColumn + "' column of '" + this.table + "' in the schema cache",
                        },
                    };
                }
                const inserted = this.payload.map(row => {
                    const next = { ...row };
                    if (!next.id && ['words', 'assessments', 'question_cache'].includes(this.table)) {
                        next.id = `${this.table}-${tableRows.length + 1}`;
                    }
                    if (this.operation === 'upsert' && this.table === 'quiz_sessions') {
                        const existing = tableRows.find(existingRow => existingRow.test_id === next.test_id);
                        if (existing) {
                            Object.assign(existing, next);
                            return existing;
                        }
                    }
                    tableRows.push(next);
                    return next;
                });
                return { data: inserted, error: null };
            }

            let rows = tableRows.filter(row => matches(row, this.filters));
            if (this.operation === 'delete') {
                for (let index = tableRows.length - 1; index >= 0; index--) {
                    if (matches(tableRows[index], this.filters)) tableRows.splice(index, 1);
                }
                return { data: rows, error: null };
            }
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

test('incrementCacheUsedCount resolves database cache rows by source word record id', async () => {
    const client = seededClient();
    client.db.question_cache.push({
        id: 'cache-source-id',
        feishu_record_id: null,
        source_word_record_id: 'rec-source-word-1',
        user_id: 'user-1',
        word_id: 'word-1',
        round_type: 'primary',
        used_count: 0,
    });
    const adapter = createSupabaseDataAdapter(client);

    const row = await adapter.incrementCacheUsedCount('rec-source-word-1');

    assert.equal(row.id, 'cache-source-id');
    assert.equal(row.used_count, 1);
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

test('addWords inserts multiple words through Supabase addWord path', async () => {
    const client = seededClient();
    const adapter = createSupabaseDataAdapter(client);

    const result = await adapter.addWords('qiuqiu', [
        { word: 'orange', meaning: 'a citrus fruit', level: MIDDLE, POS: ['noun'] },
        { Word: 'brisk', Meaning: 'quick and active', Level: MIDDLE, POS: 'adj.' },
    ]);

    assert.equal(result.success, true);
    assert.equal(result.count, 2);
    assert.deepEqual(result.errors, []);
    assert.equal(client.db.words.at(-2).word, 'orange');
    assert.equal(client.db.words.at(-1).word, 'brisk');
    assert.deepEqual(client.db.word_parts_of_speech.slice(-2), [
        { word_id: client.db.words.at(-2).id, part_of_speech_id: 1, position: 1 },
        { word_id: client.db.words.at(-1).id, part_of_speech_id: 2, position: 1 },
    ]);
});

test('question cache status summarizes Supabase rows by level', async () => {
    const client = seededClient();
    const adapter = createSupabaseDataAdapter(client);
    client.db.question_cache[0] = {
        ...client.db.question_cache[0],
        level: MIDDLE,
        round_type: 'primary',
        quality_status: 'ready',
        question_type: 1,
        question_text: 'I ate an _____ after lunch.',
        options: ['A. apple', 'B. pear', 'C. chair', 'D. desk'],
        answer: 'A',
        option_meanings: ['fruit', 'fruit', 'seat', 'furniture'],
        correct_meaning: 'a fruit',
        generated_at: '2026-07-19T12:00:00.000Z',
    };

    const status = await adapter.getQuestionCacheStatus('qiuqiu');

    assert.equal(status.configured, true);
    assert.equal(status.total, 1);
    assert.equal(status.ready, 1);
    assert.equal(status.byLevel[MIDDLE].ready, 1);
});

test('getQuestionCache normalizes known elementary mojibake before enum filtering', async () => {
    const ELEMENTARY = String.fromCharCode(0x5c0f, 0x5b66);
    const MOJIBAKE_ELEMENTARY = String.fromCodePoint(0x0421, 0x0467);
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'test_user', username_key: 'test_user' }],
        words: [{
            id: 'word-1',
            feishu_record_id: 'rec-word-1',
            user_id: 'user-1',
            word: 'corn',
            meaning_en: 'yellow food',
            level: ELEMENTARY,
            mastery_status: 'pending',
        }],
        question_cache: [{
            id: 'cache-1',
            feishu_record_id: 'rec-cache-1',
            user_id: 'user-1',
            word_id: 'word-1',
            level: ELEMENTARY,
            round_type: 'primary',
            quality_status: 'ready',
            question_type: 1,
            question_text: 'I eat _____.',
            options: ['A. corn', 'B. desk', 'C. run', 'D. blue'],
            answer: 'A',
            used_count: 0,
            generated_at: '2026-07-19T12:00:00.000Z',
        }],
    });
    const adapter = createSupabaseDataAdapter(client);

    const rows = await adapter.getQuestionCache('test_user', MOJIBAKE_ELEMENTARY, 'primary');

    assert.equal(rows.length, 1);
    assert.equal(rows[0].level, ELEMENTARY);
});

test('rebuildQuestionCacheForUser writes ready elementary cache rows to Supabase', async () => {
    const ELEMENTARY = String.fromCharCode(0x5c0f, 0x5b66);
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: ELEMENTARY }],
        words: [
            ['corn', 'A yellow food that grows on a tall plant.'],
            ['cheek', 'The soft side of your face.'],
            ['roll', 'To move by turning over and over.'],
            ['puppy', 'A young dog.'],
            ['kitten', 'A young cat.'],
            ['chick', 'A baby bird.'],
            ['climb', 'To go up something.'],
            ['sweater', 'Warm clothes for the top of your body.'],
            ['clap', 'To hit your hands together to make a sound.'],
            ['swing', 'A seat that moves back and forth.'],
        ].map(([word, meaning], index) => ({
            id: `word-${index + 1}`,
            feishu_record_id: `rec-word-${index + 1}`,
            user_id: 'user-1',
            word,
            meaning_en: meaning,
            meaning_zh: meaning,
            level: ELEMENTARY,
            mastery_status: 'pending',
            entered_at: `2026-07-19T00:00:${String(index).padStart(2, '0')}.000Z`,
        })),
        assessments: [],
        question_cache: [],
    });
    const adapter = createSupabaseDataAdapter(client);

    const result = await adapter.rebuildQuestionCacheForUser('qiuqiu');

    assert.equal(result.configured, true);
    assert.equal(result.level, ELEMENTARY);
    assert.equal(result.count, 20);
    const cornQuestion = client.db.question_cache.find(row =>
        row.word_id === 'word-1' && row.round_type === 'primary'
    );
    assert.match(cornQuestion.question_text, /dinner today/);
    assert.equal(client.db.question_cache.filter(row =>
        row.user_id === 'user-1' &&
        row.level === ELEMENTARY &&
        row.round_type === 'primary' &&
        row.quality_status === 'ready'
    ).length, 10);
});

test('updateUserLearningSettings updates Supabase user level and removes stale cache', async () => {
    const ELEMENTARY = String.fromCharCode(0x5c0f, 0x5b66);
    const HIGH = String.fromCharCode(0x9ad8, 0x4e2d);
    const client = createFakeSupabase({
        users: [{
            id: 'user-1',
            username: 'qiuqiu',
            username_key: 'qiuqiu',
            learning_level: HIGH,
            level_changed_at: null,
        }],
        words: [],
        assessments: [],
        question_cache: [{
            id: 'cache-1',
            user_id: 'user-1',
            word_id: 'word-1',
            level: HIGH,
            quality_status: 'ready',
        }],
    });
    const adapter = createSupabaseDataAdapter(client);

    const result = await adapter.updateUserLearningSettings('qiuqiu', ELEMENTARY);

    assert.equal(result.success, true);
    assert.equal(result.settings.learningLevel, ELEMENTARY);
    assert.equal(client.db.users[0].learning_level, ELEMENTARY);
    assert.ok(client.db.users[0].level_changed_at);
    assert.equal(client.db.question_cache.length, 0);
});

test('updateUserLearningSettings repairs missing migrated user level despite cooldown timestamp', async () => {
    const HIGH = String.fromCharCode(0x9ad8, 0x4e2d);
    const client = createFakeSupabase({
        users: [{
            id: 'user-1',
            username: 'yusi',
            username_key: 'yusi',
            learning_level: null,
            level_changed_at: new Date().toISOString(),
        }],
        words: [],
        assessments: [],
        question_cache: [{
            id: 'cache-1',
            user_id: 'user-1',
            word_id: 'word-1',
            level: HIGH,
            quality_status: 'ready',
        }],
    });
    const adapter = createSupabaseDataAdapter(client);

    const result = await adapter.updateUserLearningSettings('yusi', HIGH);

    assert.equal(result.success, true);
    assert.equal(result.settings.learningLevel, HIGH);
    assert.equal(client.db.users[0].learning_level, HIGH);
    assert.ok(client.db.users[0].level_changed_at);
    assert.equal(client.db.question_cache.length, 0);
});
test('quiz session persistence saves and restores unexpired Supabase sessions', async () => {
    const client = seededClient();
    const adapter = createSupabaseDataAdapter(client);
    const questions = [{ word: 'Apple', answer: 'A', options: ['A. Apple', 'B. Pear'] }];

    await adapter.saveQuizSession('qiuqiu', 'quiz-1', questions, {
        now: () => '2026-07-20T00:00:00.000Z',
    });
    const session = await adapter.getQuizSession('qiuqiu', 'quiz-1', {
        now: () => '2026-07-20T01:00:00.000Z',
    });

    assert.deepEqual(session.questions, questions);
    assert.equal(session.user_id, 'user-1');
    assert.equal(client.db.quiz_sessions[0].test_id, 'quiz-1');
    assert.equal(client.db.quiz_sessions[0].expires_at, '2026-07-21T00:00:00.000Z');
});

test('quiz session persistence ignores expired sessions and deletes submitted sessions', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
        quiz_sessions: [{
            test_id: 'expired-quiz',
            user_id: 'user-1',
            questions: [{ word: 'Apple' }],
            created_at: '2026-07-18T00:00:00.000Z',
            expires_at: '2026-07-19T00:00:00.000Z',
        }, {
            test_id: 'fresh-quiz',
            user_id: 'user-1',
            questions: [{ word: 'Pear' }],
            created_at: '2026-07-20T00:00:00.000Z',
            expires_at: '2026-07-21T00:00:00.000Z',
        }],
    });
    const adapter = createSupabaseDataAdapter(client);

    assert.equal(await adapter.getQuizSession('qiuqiu', 'expired-quiz', {
        now: () => '2026-07-20T00:00:00.000Z',
    }), null);
    assert.deepEqual(await adapter.deleteQuizSession('qiuqiu', 'fresh-quiz'), { deleted: 1 });
    assert.deepEqual(client.db.quiz_sessions.map(row => row.test_id), ['expired-quiz']);
    assert.deepEqual(await adapter.cleanupExpiredQuizSessions({
        now: () => '2026-07-20T00:00:00.000Z',
    }), { deleted: 1 });
    assert.deepEqual(client.db.quiz_sessions, []);
});

test('getAssessmentsForTest returns only rows for one user and test id', async () => {
    const client = createFakeSupabase({
        users: [
            { id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' },
            { id: 'user-2', username: 'other', username_key: 'other' },
        ],
        assessments: [
            { id: 'a-1', user_id: 'user-1', test_id: 'real-target', word_snapshot: 'Apple', source_word_record_id: 'rec-word-1', question_type: '1', is_correct: 'correct', assessed_at: '2026-07-21T00:00:00.000Z', options: [] },
            { id: 'a-2', user_id: 'user-1', test_id: 'real-other', word_snapshot: 'Pear', source_word_record_id: 'rec-word-2', question_type: '1', is_correct: 'wrong', assessed_at: '2026-07-21T00:01:00.000Z', options: [] },
            { id: 'a-3', user_id: 'user-2', test_id: 'real-target', word_snapshot: 'Desk', source_word_record_id: 'rec-word-3', question_type: '1', is_correct: 'wrong', assessed_at: '2026-07-21T00:02:00.000Z', options: [] },
        ],
    });
    const adapter = createSupabaseDataAdapter(client);

    const rows = await adapter.getAssessmentsForTest('qiuqiu', 'real-target');

    assert.deepEqual(rows.map(row => row.id), ['a-1']);
});

test('createReviewRound builds a Supabase review round from wrong submitted assessments', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
        words: [{
            id: 'word-1',
            feishu_record_id: 'rec-word-1',
            user_id: 'user-1',
            word: 'Apple',
            meaning_en: 'a fruit',
            meaning_zh: 'ƻ��',
            level: MIDDLE,
            mastery_status: 'pending',
            entered_at: '2026-07-18T00:00:00.000Z',
        }],
        assessments: [{
            id: 'a-1',
            user_id: 'user-1',
            word_id: 'word-1',
            source_word_record_id: 'rec-word-1',
            test_id: 'real-source',
            word_snapshot: 'Apple',
            question_type: '1',
            question_text: 'I ate an _____.',
            options: ['A. Apple', 'B. Pear', 'C. Chair', 'D. Desk'],
            correct_answer: 'A',
            submitted_answer: 'B',
            answer_confidence: 'sure',
            is_correct: 'wrong',
            assessed_at: '2026-07-21T00:00:00.000Z',
            learning_day: '2026-07-21',
            level: MIDDLE,
        }],
    });
    const adapter = createSupabaseDataAdapter(client);

    const round = await adapter.createReviewRound({ userId: 'qiuqiu', sourceTestId: 'real-source' });

    assert.equal(round.sourceTestId, 'real-source');
    assert.equal(round.questions.length, 1);
    assert.equal(round.questions[0].type, 4);
    assert.equal(round.questions[0].correctMeaning, 'ƻ��');
    const reviewRows = client.db.assessments.filter(row => row.test_id === round.reviewId);
    assert.equal(reviewRows.length, 1);
    assert.equal(reviewRows[0].assessment_kind, 'review');
    assert.equal(reviewRows[0].source_test_id, 'real-source');
    assert.equal(reviewRows[0].review_status, 'active');
});


test('createReviewRound tolerates assessments without parent_review_id', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'draggy', username_key: 'draggy' }],
        words: [{
            id: 'word-1',
            feishu_record_id: 'rec-word-1',
            user_id: 'user-1',
            word: 'Attitude',
            meaning_en: 'a way of thinking',
            meaning_zh: 'attitude',
            level: MIDDLE,
            mastery_status: 'pending',
            entered_at: '2026-07-18T00:00:00.000Z',
        }],
        assessments: [{
            id: 'a-1',
            user_id: 'user-1',
            word_id: 'word-1',
            source_word_record_id: 'rec-word-1',
            test_id: 'real-source',
            word_snapshot: 'Attitude',
            question_type: '1',
            correct_answer: 'A',
            submitted_answer: 'B',
            is_correct: 'wrong',
            assessed_at: '2026-07-21T00:00:00.000Z',
            learning_day: '2026-07-21',
            level: MIDDLE,
        }],
    }, {
        missingColumns: { assessments: ['parent_review_id'] },
    });
    const adapter = createSupabaseDataAdapter(client);

    const round = await adapter.createReviewRound({ userId: 'draggy', sourceTestId: 'real-source' });

    assert.equal(round.questions.length, 1);
    const retry = await adapter.createReviewRound({ userId: 'draggy', sourceTestId: 'real-source' });
    const reviewRows = client.db.assessments.filter(row => row.assessment_kind === 'review');
    assert.equal(retry.reviewId, round.reviewId);
    assert.equal(reviewRows.length, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(reviewRows[0], 'parent_review_id'), false);
});

test('concurrent review generation returns one active round', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
        words: [{ id: 'word-1', feishu_record_id: 'rec-word-1', user_id: 'user-1', word: 'Apple', meaning_en: 'a fruit', meaning_zh: 'apple', level: MIDDLE, mastery_status: 'pending', entered_at: '2026-07-18T00:00:00.000Z' }],
        assessments: [{ id: 'a-1', user_id: 'user-1', word_id: 'word-1', source_word_record_id: 'rec-word-1', test_id: 'real-source', word_snapshot: 'Apple', question_type: '1', correct_answer: 'A', submitted_answer: 'B', is_correct: 'wrong', assessed_at: '2026-07-21T00:00:00.000Z', learning_day: '2026-07-21', level: MIDDLE }],
    });
    const adapter = createSupabaseDataAdapter(client);
    const [first, second] = await Promise.all([
        adapter.createReviewRound({ userId: 'qiuqiu', sourceTestId: 'real-source' }),
        adapter.createReviewRound({ userId: 'qiuqiu', sourceTestId: 'real-source' }),
    ]);

    assert.equal(first.reviewId, second.reviewId);
    assert.equal(client.db.assessments.filter(row => row.assessment_kind === 'review').length, 1);
});

test('review active, defer, and summary flows use Supabase assessment metadata', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
        assessments: [{ id: 'review-row-1', user_id: 'user-1', source_word_record_id: 'rec-word-1', test_id: 'real-review-r1', source_test_id: 'real-source', word_snapshot: 'Apple', question_type: '4', correct_answer: 'apple', submitted_answer: null, is_correct: null, assessed_at: '2026-07-21T00:00:00.000Z', review_status: 'active', assessment_kind: 'review' }],
    });
    const adapter = createSupabaseDataAdapter(client);

    const active = await adapter.getActiveReviewRound({ userId: 'qiuqiu', sourceTestId: 'real-source' });
    assert.equal(active.reviewId, 'real-review-r1');
    const deferred = await adapter.deferReviewRound({ userId: 'qiuqiu', reviewId: 'real-review-r1' });
    assert.deepEqual(deferred.remainingRecordIds, ['rec-word-1']);
    const summary = await adapter.getReviewSummary({ userId: 'qiuqiu', sourceTestId: 'real-source' });
    assert.deepEqual(summary.deferredRecordIds, ['rec-word-1']);
    assert.equal(summary.reviewed, 1);
});

test('submitReviewRound scores Supabase type-four review rows', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu' }],
        words: [],
        assessments: [{
            id: 'review-row-1',
            user_id: 'user-1',
            word_id: 'word-1',
            source_word_record_id: 'rec-word-1',
            test_id: 'real-review-r1',
            word_snapshot: 'Apple',
            question_type: '4',
            question_text: '',
            options: [],
            correct_answer: 'apple',
            submitted_answer: null,
            answer_confidence: null,
            is_correct: null,
            assessed_at: '2026-07-21T00:00:00.000Z',
            learning_day: '2026-07-21',
            assessment_kind: 'review',
            review_round: '1',
            review_status: 'active',
            source_test_id: 'real-source',
            parent_review_id: '',
        }],
    });
    const adapter = createSupabaseDataAdapter(client);

    const result = await adapter.submitReviewRound({
        userId: 'qiuqiu',
        reviewId: 'real-review-r1',
        answers: [{ text: 'apple', confidence: 'sure' }],
    });

    assert.equal(result.reviewId, 'real-review-r1');
    assert.equal(result.correct, 1);
    assert.equal(result.total, 1);
    assert.equal(result.complete, true);
    assert.equal(client.db.assessments[0].submitted_answer, 'apple');
    assert.equal(client.db.assessments[0].is_correct, 'correct');
    assert.equal(client.db.assessments[0].review_status, 'complete');

    const retry = await adapter.submitReviewRound({
        userId: 'qiuqiu',
        reviewId: 'real-review-r1',
        answers: [{ text: 'apple', confidence: 'sure' }],
    });
    assert.equal(retry.total, 1);
    assert.equal(client.db.assessments.length, 1);
});

test('rebuildQuestionCacheForUser inherits level and uses word-specific distractors for unassigned words', async () => {
    const JUNIOR_HIGH = String.fromCharCode(0x4e2d, 0x5b66);
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: JUNIOR_HIGH }],
        words: ['apple', 'bridge', 'candle', 'dinner', 'engine', 'forest', 'garden', 'hammer', 'island', 'jacket'].map((word, index) => ({
            id: `word-${index + 1}`,
            feishu_record_id: `rec-word-${index + 1}`,
            user_id: 'user-1',
            word,
            meaning_en: `Meaning ${index + 1}`,
            meaning_zh: `Meaning ${index + 1}`,
            level: null,
            context_en: `This sentence contains ${word}.`,
            distractors: ['alpha', 'bravo', 'charlie'],
            old_distractors: [],
            mastery_status: 'pending',
            entered_at: `2026-07-19T00:00:${String(index).padStart(2, '0')}.000Z`,
        })),
        assessments: [],
        question_cache: [],
    });
    const adapter = createSupabaseDataAdapter(client);

    const result = await adapter.rebuildQuestionCacheForUser('qiuqiu');

    assert.equal(result.level, JUNIOR_HIGH);
    assert.equal(result.count, 20);
    assert.equal(client.db.question_cache.filter(row => row.level === JUNIOR_HIGH && row.round_type === 'primary').length, 10);
    assert.equal(client.db.question_cache.filter(row => row.level === JUNIOR_HIGH && row.round_type === 'review').length, 10);
});

test('rebuildQuestionCacheForUser falls back for an unknown elementary word', async () => {
    const ELEMENTARY = String.fromCharCode(0x5c0f, 0x5b66);
    const words = ['corn', 'cheek', 'roll', 'puppy', 'kitten', 'chick', 'climb', 'sweater', 'clap', 'abstract'];
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'Draggy', username_key: 'draggy', learning_level: ELEMENTARY }],
        words: words.map((word, index) => ({
            id: `word-${index + 1}`,
            feishu_record_id: `rec-word-${index + 1}`,
            user_id: 'user-1',
            word,
            meaning_en: `Meaning of ${word}`,
            meaning_zh: `Meaning of ${word}`,
            level: null,
            context_en: word === 'abstract' ? null : '',
            distractors: [],
            old_distractors: [],
            mastery_status: 'pending',
            entered_at: `2026-07-19T00:00:${String(index).padStart(2, '0')}.000Z`,
        })),
        assessments: [],
        question_cache: [],
    });
    const adapter = createSupabaseDataAdapter(client);

    const result = await adapter.rebuildQuestionCacheForUser('Draggy');

    assert.equal(result.level, ELEMENTARY);
    assert.equal(result.count, 20);
    assert.equal(client.db.question_cache.filter(row => row.round_type === 'primary' && row.quality_status === 'ready').length, 10);
    assert.equal(client.db.question_cache.some(row => row.question_text.includes('Please read')), false);
});

test('rebuildQuestionCacheForUser skips middle-school words without natural context and approved distractors', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: ['genaine', 'repair', 'draggy', 'straight'].map((word, index) => ({
            id: `word-${index + 1}`,
            feishu_record_id: `rec-word-${index + 1}`,
            user_id: 'user-1',
            word,
            meaning_en: `Meaning ${index + 1}`,
            meaning_zh: `Meaning ${index + 1}`,
            level: MIDDLE,
            context_en: null,
            distractors: [],
            old_distractors: [],
            mastery_status: 'pending',
            entered_at: `2026-07-19T00:00:${String(index).padStart(2, '0')}.000Z`,
        })),
        assessments: [],
        question_cache: [],
    });
    const adapter = createSupabaseDataAdapter(client);

    const result = await adapter.rebuildQuestionCacheForUser('qiuqiu');

    assert.equal(result.level, MIDDLE);
    assert.equal(result.count, 0);
    assert.equal(client.db.question_cache.length, 0);
});

test('rebuildQuestionCacheForUser creates middle-school type 3 fallback cache when context is sparse', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [
            ['afford', '负担得起'],
            ['trick', '窍门'],
            ['whistle', '哨声'],
            ['stream', '小溪'],
        ].map(([word, meaning], index) => ({
            id: `word-${index + 1}`,
            feishu_record_id: `rec-word-${index + 1}`,
            user_id: 'user-1',
            word,
            meaning_en: `Meaning ${index + 1}`,
            meaning_zh: meaning,
            level: MIDDLE,
            context_en: null,
            distractors: [],
            old_distractors: [],
            mastery_status: 'pending',
            entered_at: `2026-07-19T00:00:0${index}.000Z`,
        })),
        assessments: [],
        question_cache: [],
    });
    const adapter = createSupabaseDataAdapter(client);

    const result = await adapter.rebuildQuestionCacheForUser('qiuqiu');

    assert.equal(result.level, MIDDLE);
    assert.equal(result.count, 8);
    assert.equal(client.db.question_cache.filter(row => row.round_type === 'primary').length, 4);
    assert.equal(client.db.question_cache.every(row => row.question_type === '3'), true);
    assert.equal(client.db.question_cache.every(row => row.quality_status === 'ready'), true);
    assert.equal(client.db.question_cache.every(row => !String(row.question_text || '').includes('Meaning')), true);
    assert.deepEqual(
        client.db.question_cache
            .filter(row => row.round_type === 'primary')
            .map(row => row.correct_meaning),
        ['负担得起', '窍门', '哨声', '小溪']
    );
});
test('rebuildQuestionCacheForUser filters sparse middle-school fallback distractors to Chinese-meaning words', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [
            ['genaine', ''],
            ['bomb', ''],
            ['crowded', ''],
            ['afford', '负担得起'],
            ['trick', '窍门'],
            ['whistle', '哨声'],
            ['stream', '小溪'],
        ].map(([word, meaning], index) => ({
            id: `word-${index + 1}`,
            feishu_record_id: `rec-word-${index + 1}`,
            user_id: 'user-1',
            word,
            meaning_en: `Meaning ${index + 1}`,
            meaning_zh: meaning,
            level: MIDDLE,
            context_en: null,
            distractors: [],
            old_distractors: [],
            mastery_status: 'pending',
            entered_at: `2026-07-19T00:00:0${index}.000Z`,
        })),
        assessments: [],
        question_cache: [],
    });
    const adapter = createSupabaseDataAdapter(client);

    const result = await adapter.rebuildQuestionCacheForUser('qiuqiu');

    assert.equal(result.count, 8);
    const optionText = client.db.question_cache.flatMap(row => row.options).join(' ').toLowerCase();
    assert.equal(optionText.includes('genaine'), false);
    assert.equal(optionText.includes('bomb'), false);
    assert.equal(optionText.includes('crowded'), false);
});
test('rebuildQuestionCacheForUser varies sparse middle-school fallback distractors by target word', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [
            ['bomb', '炸弹'],
            ['crowded', '拥挤的'],
            ['resilient', '有弹性的'],
            ['afford', '负担得起'],
            ['trick', '窍门'],
            ['whistle', '哨声'],
            ['stream', '小溪'],
        ].map(([word, meaning], index) => ({
            id: `word-${index + 1}`,
            feishu_record_id: `rec-word-${index + 1}`,
            user_id: 'user-1',
            word,
            meaning_en: `Meaning ${index + 1}`,
            meaning_zh: meaning,
            level: MIDDLE,
            context_en: null,
            distractors: [],
            old_distractors: [],
            mastery_status: 'pending',
            entered_at: `2026-07-19T00:00:0${index}.000Z`,
        })),
        assessments: [],
        question_cache: [],
    });
    const adapter = createSupabaseDataAdapter(client);

    await adapter.rebuildQuestionCacheForUser('qiuqiu');

    const wordById = new Map(client.db.words.map(word => [word.id, word.word]));
    const distractorSets = client.db.question_cache
        .filter(row => row.round_type === 'primary')
        .map(row => ({
            target: wordById.get(row.word_id),
            options: row.options.map(option => option.replace(/^[A-D]\.\s+/, '')),
        }))
        .filter(row => ['afford', 'trick', 'whistle', 'stream'].includes(row.target))
        .map(row => row.options.filter(option => option !== row.target).sort().join('|'));
    assert.ok(distractorSets.length >= 4);
    assert.ok(new Set(distractorSets).size > 1, distractorSets.join('; '));
});
test('rebuildQuestionCacheForUser does not use all candidate words as middle-school fallback distractors', async () => {
    const client = createFakeSupabase({
        users: [{ id: 'user-1', username: 'qiuqiu', username_key: 'qiuqiu', learning_level: MIDDLE }],
        words: [
            {
                id: 'word-1',
                feishu_record_id: 'rec-word-1',
                user_id: 'user-1',
                word: 'repair',
                meaning_en: 'to fix something damaged',
                meaning_zh: 'to fix something damaged',
                level: MIDDLE,
                context_en: "After the storm, the carpenter's repair of the damaged roof kept the house dry.",
                distractors: [],
                old_distractors: [],
                mastery_status: 'pending',
                entered_at: '2026-07-19T00:00:00.000Z',
            },
            ...['crowded', 'bomb', 'straight'].map((word, index) => ({
                id: `word-${index + 2}`,
                feishu_record_id: `rec-word-${index + 2}`,
                user_id: 'user-1',
                word,
                meaning_en: `Meaning ${index + 2}`,
                meaning_zh: `Meaning ${index + 2}`,
                level: MIDDLE,
                context_en: `${word} appears in a separate sentence.`,
                distractors: [],
                old_distractors: [],
                mastery_status: 'pending',
                entered_at: `2026-07-19T00:00:0${index + 1}.000Z`,
            })),
        ],
        assessments: [],
        question_cache: [],
    });
    const adapter = createSupabaseDataAdapter(client);

    const result = await adapter.rebuildQuestionCacheForUser('qiuqiu');

    assert.equal(result.count, 0);
    assert.equal(client.db.question_cache.length, 0);
});
