const test = require('node:test');
const assert = require('node:assert/strict');

const { buildReconciliation, canonicalUsernameKey, insertRows, insertRowsViaRest, isDatabaseNetworkError, normalizeDatabaseUrl, normalizeLevel, normalizePartsOfSpeech, prepareSqlValue, transformBackfill } = require('./backfill');

test('normalizes canonical usernames, levels, and compound parts of speech', () => {
  assert.equal(canonicalUsernameKey(' Drag gy '), 'draggy');
  assert.equal(normalizeLevel('??'), '\u5c0f\u5b66');
  assert.equal(normalizeLevel('\u0421\u0467'), '\u5c0f\u5b66');
  assert.deepEqual(normalizePartsOfSpeech('n., adjective'), ['noun', 'adjective']);
  assert.deepEqual(normalizePartsOfSpeech('phrasal verb'), ['phrasal verb']);
});

test('serializes JSONB arrays without changing Postgres text arrays', () => {
  assert.equal(prepareSqlValue('options', ['A', 'B'], new Set(['options'])), '["A","B"]');
  assert.deepEqual(prepareSqlValue('migration_flags', ['flag'], new Set(['options'])), ['flag']);
});

test('encodes reserved characters in an otherwise valid PostgreSQL password', () => {
  const normalized = normalizeDatabaseUrl('postgresql://postgres:abc?def!@db.example.com:5432/postgres');

  assert.equal(normalized, 'postgresql://postgres:abc%3Fdef!@db.example.com:5432/postgres');
  assert.equal(new URL(normalized).password, 'abc%3Fdef!');
});

test('reports the actual number of inserted rows across batches', async () => {
  const batchSizes = [];
  const client = {
    async query(sql) {
      const batchSize = (sql.match(/\), \(/g) || []).length + 1;
      batchSizes.push(batchSize);
      return { rowCount: batchSize - 1 };
    },
  };
  const rows = Array.from({ length: 201 }, (_, index) => ({ id: index + 1 }));

  const inserted = await insertRows(client, 'sample', ['id'], rows, 'id');

  assert.deepEqual(batchSizes, [200, 1]);
  assert.equal(inserted, 199);
});

test('reports actual REST inserts and recognizes direct database network failures', async () => {
  const batches = [];
  const supabase = {
    from(table) {
      assert.equal(table, 'sample');
      return {
        upsert(batch, options) {
          batches.push({ batch, options });
          return {
            async select(columns) {
              assert.equal(columns, 'id');
              return { data: batch.slice(1).map(row => ({ id: row.id })), error: null };
            },
          };
        },
      };
    },
  };
  const rows = Array.from({ length: 201 }, (_, index) => ({ id: index + 1, ignored: true }));

  const inserted = await insertRowsViaRest(supabase, 'sample', ['id'], rows, 'id', 'id');

  assert.equal(inserted, 199);
  assert.deepEqual(batches.map(entry => entry.batch.length), [200, 1]);
  assert.deepEqual(batches[0].batch[0], { id: 1 });
  assert.deepEqual(batches[0].options, { onConflict: 'id', ignoreDuplicates: true });
  assert.equal(isDatabaseNetworkError(Object.assign(new Error('unreachable'), { code: 'ENOTFOUND' })), true);
  assert.equal(isDatabaseNetworkError(Object.assign(new Error('bad password'), { code: '28P01' })), false);
});

test('transforms cleanup rules and preserves reconciliable foreign keys', () => {
  const source = {
    words: [
      { record_id: 'word-draggy-1', fields: { user: 'Draggy', Word: 'apple', Meaning: 'a fruit', Level: '', POS: 'n., adjective', Status: 'optXjbXS2F', multi_definition: ['opthB7bmkB'], record_time: '1700000000000', auth_password_hash: 'hash', auth_password_salt: 'salt' } },
      { record_id: 'word-draggy-2', fields: { user: ' draggy ', Word: 'run', Meaning: 'move fast', Level: '??', Learning_Level: '\u5c0f\u5b66', POS: 'verb phrase', Status: 'Mastered', record_time: 1700000001000 } },
      { record_id: 'recvnacJpRa48s', fields: { user: 'xiaopan', auth_password_hash: 'hash2', auth_password_salt: 'salt2', auth_created_at: 1700000002000 } },
      { record_id: 'recvpw4lpJj2uE', fields: { user: 'test_user1', auth_password_hash: 'ignored', auth_password_salt: 'ignored' } },
      { record_id: 'word-test-user', fields: { user: 'test_user', Word: 'keep', Meaning: 'retain', Level: '\u5c0f\u5b66', Status: 'Pending', record_time: 1700000003000 } },
    ],
    tests: [
      { record_id: 'empty-test', fields: {} },
      { record_id: 'assessment-1', fields: { user: 'draggy', record_id: 'word-draggy-1', test_id: 'real-1', test_time: '1700000004000', question_type: '1', level: '??', word: 'apple', options: '[object Object]', correct_answer: 'A', your_answer: 'A', is_correct: ['optHGT7gYf'] } },
      { record_id: 'assessment-orphan', fields: { user: 'Draggy', record_id: 'deleted-word', test_id: 'real-2', test_time: 1700000005000, question_type: '2', word: 'gone', options: '[]' } },
      { record_id: 'assessment-invalid-json', fields: { user: 'Draggy', record_id: 'word-draggy-2', test_id: 'real-3', test_time: 1700000005500, question_type: '3', word: 'run', options: '["A. run", invalid]', correct_answer: 'A' } },
      { record_id: 'assessment-valid-json', fields: { user: 'Draggy', record_id: 'word-draggy-2', test_id: 'real-4', test_time: 1700000005750, question_type: '3', word: 'run', options: '["A. run","B. walk"]', correct_answer: 'A' } },
    ],
    cache: [
      { record_id: 'cache-1', fields: { user: 'Draggy', word_record_id: 'word-draggy-1', word: 'apple', level: '\u5c0f\u5b66', question_type: '1', round_type: 'primary', quality_status: 'ready', question_text: 'Pick apple', options: '["A","B","C","D"]', answer: 'A', option_meanings: '["a","b","c","d"]', used_count: '0', generated_at: '1700000006000' } },
      { record_id: 'cache-orphan', fields: { user: 'Draggy', word_record_id: 'deleted-word', word: 'gone', level: '\u5c0f\u5b66', question_type: '1', round_type: 'primary', quality_status: 'ready', question_text: 'Missing word', options: '["A","B","C","D"]', answer: 'A', option_meanings: '["a","b","c","d"]', used_count: '0', generated_at: '1700000007000' } },
    ],
  };

  const result = transformBackfill(source);
  assert.equal(result.users.length, 3);
  assert.equal(result.users.find(user => user.username_key === 'draggy').username, 'Draggy');
  assert.equal(result.users.some(user => user.username_key === 'test_user1'), false);
  assert.equal(result.words.length, 3);
  assert.equal(result.words.find(word => word.word === 'apple').level, '\u5c0f\u5b66');
  assert.deepEqual(result.wordPartsOfSpeech.find(row => row.feishu_record_id === 'word-draggy-1').parts, ['noun', 'adjective']);
  assert.equal(result.assessments.length, 4);
  assert.equal(result.assessments[0].is_correct, 'correct');
  assert.deepEqual(result.assessments[0].options, []);
  assert.deepEqual(result.assessments[0].migration_flags, ['malformed_options']);
  assert.equal(result.assessments[1].word_id, null);
  assert.deepEqual(result.assessments[2].options, []);
  assert.deepEqual(result.assessments[2].migration_flags, ['malformed_options']);
  assert.deepEqual(result.assessments[3].options, ['A. run', 'B. walk']);
  assert.deepEqual(result.assessments[3].migration_flags, []);
  assert.equal(result.blockingErrors.some(message => message.includes('invalid options')), false);
  assert.equal(result.questionCache.length, 1);
  assert.equal(result.quarantine.questionCache.length, 1);
  assert.equal(result.summary.skipped.orphanCache, 1);
  assert.equal(result.summary.skipped.emptyTests, 1);
  assert.equal(result.summary.skipped.testUser1, 1);
  assert.equal(result.summary.skipped.authOnlyWords, 2);
  assert.equal(result.summary.levelFixes.inherited, 1);
  assert.equal(result.summary.nullableCases.invalidAssessmentOptions, 2);

  const reconciliation = buildReconciliation(result);
  assert.equal(reconciliation.expectedSkips.orphanCacheRows, 1);
  assert.equal(reconciliation.blockingErrors.some(message => message.includes('cache-orphan')), false);
  assert.deepEqual(reconciliation.orphanCacheSkipped, [{
    feishu_record_id: 'cache-orphan',
    user: 'Draggy',
    source_word_record_id: 'deleted-word',
    word: 'gone',
    reason: 'missing-word-reference',
  }]);
});

test('keeps cache word-owner mismatches blocking', () => {
  const result = transformBackfill({
    words: [
      { record_id: 'word-a', fields: { user: 'alpha', Word: 'apple', Meaning: 'a fruit', Level: '\u5c0f\u5b66' } },
      { record_id: 'word-b', fields: { user: 'beta', Word: 'ball', Meaning: 'a sphere', Level: '\u5c0f\u5b66' } },
    ],
    tests: [],
    cache: [
      { record_id: 'cache-owner-mismatch', fields: { user: 'alpha', word_record_id: 'word-b', word: 'ball' } },
    ],
  });

  const reconciliation = buildReconciliation(result);
  assert.equal(result.summary.skipped.orphanCache, 0);
  assert.equal(reconciliation.blockingErrors.some(message => message.includes('word-owner-mismatch')), true);
});

test('blocks a known account-carrier row that no longer contains account fields', () => {
  const result = transformBackfill({
    words: [{ record_id: 'recvpw4lpJj2uE', fields: { user: 'test_user1' } }],
    tests: [],
    cache: [],
  });
  assert.equal(result.blockingErrors.some(message => message.includes('has no account fields')), true);
});
