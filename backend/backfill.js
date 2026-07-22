require('dotenv').config();

const crypto = require('crypto');
const { Client } = require('pg');

const AUTH_ONLY_WORD_RECORD_IDS = new Set([
  'recvnacJpRa48s',
  'recvnfE765MZdP',
  'recvpw4lpJj2uE',
]);

const DOCUMENTED_COUNTS = { words: 454, tests: 2500, cache: 708 };
const DOCUMENTED_CLEANUP_COUNTS = { emptyTests: 10, authOnlyWords: 3, inheritedLevels: 135 };
const ELEMENTARY = '\u5c0f\u5b66';
const MIDDLE = '\u4e2d\u5b66';
const HIGH = '\u9ad8\u4e2d';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function loadEnvironment({ execute = false } = {}) {
  const env = {
    FEISHU_APP_ID: requiredEnv('FEISHU_APP_ID'),
    FEISHU_APP_SECRET: requiredEnv('FEISHU_APP_SECRET'),
    FEISHU_WORD_APP_TOKEN: requiredEnv('FEISHU_WORD_APP_TOKEN'),
    FEISHU_WORD_TABLE_ID: requiredEnv('FEISHU_WORD_TABLE_ID'),
    FEISHU_TEST_APP_TOKEN: requiredEnv('FEISHU_TEST_APP_TOKEN'),
    FEISHU_TEST_TABLE_ID: requiredEnv('FEISHU_TEST_TABLE_ID'),
    FEISHU_QUESTION_CACHE_APP_TOKEN: requiredEnv('FEISHU_QUESTION_CACHE_APP_TOKEN'),
    FEISHU_QUESTION_CACHE_TABLE_ID: requiredEnv('FEISHU_QUESTION_CACHE_TABLE_ID'),
    SUPABASE_URL: requiredEnv('SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY: requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    DATABASE_URL: requiredEnv('DATABASE_URL'),
  };
  if (execute && !env.DATABASE_URL) throw new Error('DATABASE_URL is required for --execute');
  return env;
}

function normalizeDatabaseUrl(databaseUrl) {
  try {
    new URL(databaseUrl);
    return databaseUrl;
  } catch {}
  const match = databaseUrl.match(/^((?:postgres(?:ql)?):\/\/)([^:/?#]+):(.+)@([^/]+)(\/.*)$/);
  if (!match) throw new Error('DATABASE_URL is not a valid PostgreSQL connection URL');
  const [, scheme, username, password, host, path] = match;
  const normalized = `${scheme}${username}:${encodeURIComponent(password)}@${host}${path}`;
  new URL(normalized);
  return normalized;
}

function text(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.length ? text(value[0]) : '';
  if (typeof value === 'object') {
    if ('text' in value) return text(value.text);
    if ('value' in value) return text(value.value);
  }
  return String(value).trim();
}

function canonicalUsernameKey(value) {
  return text(value).replace(/\s+/g, '').toLowerCase();
}

function canonicalDisplayName(raw, key) {
  if (key === 'draggy') return 'Draggy';
  return text(raw) || key;
}

function stableUuid(namespace, value) {
  const bytes = crypto.createHash('sha256').update(`${namespace}:${value}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeLevel(value) {
  const raw = text(value);
  if (!raw) return null;
  const mappings = new Map([
    [ELEMENTARY, ELEMENTARY],
    ['??', ELEMENTARY],
    ['\u0421\u0467', ELEMENTARY],
    ['\u704f\u5fd3\ue15f', ELEMENTARY],
    [MIDDLE, MIDDLE],
    ['\u4e36\u6d93\ue15f', MIDDLE],
    [HIGH, HIGH],
    ['\u696d\u6a3a\u8151', HIGH],
    ['\u6942\u6a39\u8151', HIGH],
    ['CET4_6_TOEFL', 'CET4_6_TOEFL'],
  ]);
  return mappings.get(raw) || null;
}

function normalizePartsOfSpeech(value) {
  const raw = text(value).toLowerCase();
  if (!raw) return [];
  const abbreviations = new Map([
    ['n.', 'noun'], ['n', 'noun'], ['v.', 'verb'], ['v', 'verb'],
    ['adj.', 'adjective'], ['adj', 'adjective'], ['adv.', 'adverb'], ['adv', 'adverb'],
  ]);
  return raw.split(',').map(part => part.trim()).filter(Boolean).map(part => abbreviations.get(part) || part);
}

function optionValue(value) {
  if (Array.isArray(value)) return value.length ? text(value[0]) : null;
  return text(value) || null;
}

function normalizeMasteryStatus(value, warnings, recordId) {
  const raw = optionValue(value);
  const mapping = { Pending: 'pending', optXjbXS2F: 'pending', Mastered: 'mastered', optF5P0W3O: 'mastered' };
  if (!raw) return 'pending';
  if (mapping[raw]) return mapping[raw];
  warnings.push(`Unknown mastery status ${raw} on WORD ${recordId}`);
  return null;
}

function normalizeCorrectness(value, warnings, recordId) {
  const raw = optionValue(value);
  const mapping = { optHGT7gYf: 'correct', optbe4bsQk: 'wrong', correct: 'correct', wrong: 'wrong' };
  if (!raw) return null;
  if (mapping[raw]) return mapping[raw];
  warnings.push(`Unknown correctness option ${raw} on TEST ${recordId}`);
  return null;
}

function normalizeMultiDefinition(value, warnings, recordId) {
  const raw = optionValue(value);
  if (!raw) return { value: null, source: null };
  const mapping = { opthB7bmkB: 'yes', optpWwFJpq: 'no', optH7bmkB: 'unknown' };
  if (!mapping[raw]) {
    warnings.push(`Unknown multi_definition option ${raw} on WORD ${recordId}`);
    return { value: null, source: raw };
  }
  return { value: mapping[raw], source: mapping[raw] === 'unknown' ? raw : null };
}

function parseEpochMillis(value, { required = false, label = 'timestamp', warnings = [] } = {}) {
  const raw = text(value);
  if (!raw) {
    if (required) warnings.push(`Missing required ${label}`);
    return null;
  }
  if (!/^\d{10,16}$/.test(raw)) {
    warnings.push(`Invalid ${label}: ${raw}`);
    return null;
  }
  const date = new Date(Number(raw));
  if (Number.isNaN(date.getTime())) {
    warnings.push(`Invalid ${label}: ${raw}`);
    return null;
  }
  return date.toISOString();
}

function parseInteger(value, { label, warnings, defaultValue = 0 } = {}) {
  const raw = text(value);
  if (!raw) return defaultValue;
  if (!/^\d+$/.test(raw)) {
    warnings.push(`Invalid ${label}: ${raw}`);
    return null;
  }
  return Number(raw);
}

function parseArray(value, { label, warnings, commaSeparated = false } = {}) {
  if (Array.isArray(value)) return value;
  const raw = text(value);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  if (commaSeparated) return raw.split(',').map(item => item.trim()).filter(Boolean);
  warnings.push(`Invalid JSON array for ${label}`);
  return null;
}

function parseAssessmentOptions(value) {
  if (Array.isArray(value)) return { options: value, malformed: false };
  const raw = text(value);
  if (!raw) return { options: [], malformed: false };
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { options: parsed, malformed: false };
  } catch {}
  return { options: [], malformed: true };
}

function parseFlags(value) {
  const raw = text(value);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(text).filter(Boolean);
  } catch {}
  return raw.split(',').map(item => item.trim()).filter(Boolean);
}

function hasAuthFields(fields) {
  return Boolean(text(fields.auth_password_hash) || text(fields.auth_password_salt) || text(fields.parent_password_hash) || text(fields.phone));
}

function userCompleteness(fields) {
  return [
    'auth_password_hash', 'auth_password_salt', 'auth_created_at', 'parent_username',
    'parent_password_hash', 'parent_password_salt', 'parent_created_at', 'phone',
    'phone_verified_at', 'Learning_Level', 'Level_Changed_At',
  ].reduce((score, field) => score + (text(fields[field]) ? 1 : 0), 0);
}

function learningDayShanghai(isoTimestamp) {
  if (!isoTimestamp) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(isoTimestamp));
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function isRealAssessment(testId) {
  const value = text(testId);
  return value === 'real' || value.startsWith('real-');
}

function transformBackfill({ words: sourceWords, tests: sourceTests, cache: sourceCache }) {
  const warnings = [];
  const blockingErrors = [];
  const quarantine = { questionCache: [] };
  const summary = {
    input: { words: sourceWords.length, tests: sourceTests.length, cache: sourceCache.length },
    skipped: { emptyTests: 0, testUser1: 0, authOnlyWords: 0, orphanCache: 0 },
    levelFixes: { inherited: 0, unresolved: 0 },
    canonicalMerges: [],
    nullableCases: {
      assessmentMissingWord: 0,
      missingCorrectAnswer: 0,
      answerPresentResultNull: 0,
      invalidAssessmentOptions: 0,
      invalidAssessmentOptionSamples: [],
    },
  };

  const userCandidates = new Map();
  const rawVariants = new Map();
  for (const record of sourceWords) {
    const fields = record.fields || {};
    const key = canonicalUsernameKey(fields.user);
    if (!key || key === 'test_user1') continue;
    if (!rawVariants.has(key)) rawVariants.set(key, new Set());
    rawVariants.get(key).add(text(fields.user));
    if (!userCandidates.has(key)) userCandidates.set(key, []);
    userCandidates.get(key).push(record);
  }

  for (const record of [...sourceTests, ...sourceCache]) {
    const key = canonicalUsernameKey(record.fields?.user);
    if (!key || key === 'test_user1') continue;
    if (!rawVariants.has(key)) rawVariants.set(key, new Set());
    rawVariants.get(key).add(text(record.fields?.user));
  }

  const users = [...userCandidates.entries()].map(([key, records]) => {
    const ranked = [...records].sort((left, right) => userCompleteness(right.fields || {}) - userCompleteness(left.fields || {}));
    const record = ranked[0];
    const fields = { ...(record.fields || {}) };
    for (const candidate of ranked.slice(1)) {
      for (const [field, value] of Object.entries(candidate.fields || {})) {
        if (!text(fields[field]) && text(value)) fields[field] = value;
      }
    }
    return {
      id: stableUuid('user', key),
      feishu_record_id: record.record_id,
      username: canonicalDisplayName(fields.user, key),
      username_key: key,
      password_hash: text(fields.auth_password_hash) || null,
      password_salt: text(fields.auth_password_salt) || null,
      auth_created_at: parseEpochMillis(fields.auth_created_at, { label: `users.auth_created_at ${key}`, warnings }),
      parent_username: text(fields.parent_username) || null,
      parent_password_hash: text(fields.parent_password_hash) || null,
      parent_password_salt: text(fields.parent_password_salt) || null,
      parent_created_at: parseEpochMillis(fields.parent_created_at, { label: `users.parent_created_at ${key}`, warnings }),
      phone: text(fields.phone) || null,
      phone_verified_at: parseEpochMillis(fields.phone_verified_at, { label: `users.phone_verified_at ${key}`, warnings }),
      learning_level: normalizeLevel(fields.Learning_Level),
      level_changed_at: parseEpochMillis(fields.Level_Changed_At, { label: `users.level_changed_at ${key}`, warnings }),
    };
  });
  const usersByKey = new Map(users.map(user => [user.username_key, user]));
  if (rawVariants.get('draggy')?.has('draggy') && rawVariants.get('draggy')?.has('Draggy')) {
    summary.canonicalMerges.push('draggy -> Draggy');
  } else if (usersByKey.has('draggy')) {
    summary.canonicalMerges.push('draggy key -> Draggy');
  }

  const words = [];
  const wordPartsOfSpeech = [];
  const wordsByFeishuId = new Map();
  for (const record of sourceWords) {
    const fields = record.fields || {};
    const userKey = canonicalUsernameKey(fields.user);
    const isAuthOnly = AUTH_ONLY_WORD_RECORD_IDS.has(record.record_id) || (!text(fields.Word) && !text(fields.Meaning) && hasAuthFields(fields));
    if (AUTH_ONLY_WORD_RECORD_IDS.has(record.record_id) && !hasAuthFields(fields)) {
      blockingErrors.push(`Auth-only WORD ${record.record_id} has no account fields`);
    }
    if (userKey === 'test_user1') {
      summary.skipped.testUser1 += 1;
      if (isAuthOnly) summary.skipped.authOnlyWords += 1;
      continue;
    }
    if (isAuthOnly) {
      summary.skipped.authOnlyWords += 1;
      continue;
    }
    const user = usersByKey.get(userKey);
    if (!user) {
      blockingErrors.push(`WORD ${record.record_id} has no canonical user for ${text(fields.user)}`);
      continue;
    }
    const wordText = text(fields.Word);
    const meaning = text(fields.Meaning);
    if (!wordText || !meaning) {
      blockingErrors.push(`WORD ${record.record_id} is missing Word or Meaning`);
      continue;
    }
    let level = normalizeLevel(fields.Level);
    if (!level && !text(fields.Level)) {
      level = user.learning_level;
      if (level) summary.levelFixes.inherited += 1;
      else summary.levelFixes.unresolved += 1;
    } else if (!level) {
      blockingErrors.push(`WORD ${record.record_id} has unknown level ${text(fields.Level)}`);
    }
    const masteryStatus = normalizeMasteryStatus(fields.Status, warnings, record.record_id);
    if (!masteryStatus) blockingErrors.push(`WORD ${record.record_id} has unmapped mastery status`);
    const multiDefinition = normalizeMultiDefinition(fields.multi_definition, warnings, record.record_id);
    const enteredAt = parseEpochMillis(fields.record_time, { required: true, label: `WORD ${record.record_id} record_time`, warnings });
    if (!enteredAt) blockingErrors.push(`WORD ${record.record_id} has invalid record_time`);
    const row = {
      id: stableUuid('word', record.record_id),
      feishu_record_id: record.record_id,
      user_id: user.id,
      user_key: userKey,
      word: wordText,
      meaning_en: meaning,
      meaning_zh: text(fields.CN_Meaning) || null,
      context_en: text(fields.Context) || null,
      context_zh: text(fields.Context_CN) || null,
      distractors: parseArray(fields.Distractors, { label: `WORD ${record.record_id} Distractors`, warnings, commaSeparated: true }),
      old_distractors: parseArray(fields.Old_Distractors, { label: `WORD ${record.record_id} Old_Distractors`, warnings, commaSeparated: true }),
      level,
      mastery_status: masteryStatus,
      multi_definition: multiDefinition.value,
      source_multi_definition_option_id: multiDefinition.source,
      error_count: parseInteger(fields.Error_Count, { label: `WORD ${record.record_id} Error_Count`, warnings }),
      quality_flags: parseFlags(fields.Quality_Flags),
      quality_note: text(fields.Quality_Note) || null,
      entered_at: enteredAt,
      remembered_at: parseEpochMillis(fields.remember_time, { label: `WORD ${record.record_id} remember_time`, warnings }),
    };
    words.push(row);
    wordsByFeishuId.set(record.record_id, row);
    const parts = normalizePartsOfSpeech(fields.POS);
    if (parts.length) wordPartsOfSpeech.push({ feishu_record_id: record.record_id, word_id: row.id, parts });
  }

  const assessments = [];
  for (const record of sourceTests) {
    const fields = record.fields || {};
    if (Object.keys(fields).length === 0) {
      summary.skipped.emptyTests += 1;
      continue;
    }
    const userKey = canonicalUsernameKey(fields.user);
    if (userKey === 'test_user1') {
      summary.skipped.testUser1 += 1;
      continue;
    }
    const user = usersByKey.get(userKey);
    if (!user) {
      blockingErrors.push(`TEST ${record.record_id} has no canonical user for ${text(fields.user)}`);
      continue;
    }
    const sourceWordRecordId = text(fields.record_id) || null;
    const word = sourceWordRecordId ? wordsByFeishuId.get(sourceWordRecordId) : null;
    if (!word) summary.nullableCases.assessmentMissingWord += 1;
    const assessedAt = parseEpochMillis(fields.test_time, { required: true, label: `TEST ${record.record_id} test_time`, warnings });
    if (!assessedAt) blockingErrors.push(`TEST ${record.record_id} has invalid test_time`);
    const correctness = normalizeCorrectness(fields.is_correct, warnings, record.record_id);
    const submittedAnswer = text(fields.your_answer) || null;
    const migrationFlags = [];
    if (!text(fields.correct_answer)) {
      migrationFlags.push('missing-correct-answer');
      summary.nullableCases.missingCorrectAnswer += 1;
    }
    if (submittedAnswer && !correctness) {
      migrationFlags.push('answer-present-result-null');
      summary.nullableCases.answerPresentResultNull += 1;
    }
    const parsedOptions = parseAssessmentOptions(fields.options);
    const options = parsedOptions.options;
    if (parsedOptions.malformed) {
      migrationFlags.push('malformed_options');
      summary.nullableCases.invalidAssessmentOptions += 1;
      if (summary.nullableCases.invalidAssessmentOptionSamples.length < 10) {
        summary.nullableCases.invalidAssessmentOptionSamples.push(record.record_id);
      }
    }
    assessments.push({
      id: stableUuid('assessment', record.record_id),
      feishu_record_id: record.record_id,
      user_id: user.id,
      user_key: userKey,
      word_id: word?.id || null,
      source_word_record_id: sourceWordRecordId,
      test_id: text(fields.test_id),
      is_real_assessment: isRealAssessment(fields.test_id),
      assessed_at: assessedAt,
      learning_day: learningDayShanghai(assessedAt),
      question_type: text(fields.question_type),
      level: normalizeLevel(fields.level),
      word_snapshot: text(fields.word),
      question_text: text(fields.context) || null,
      options,
      correct_answer: text(fields.correct_answer) || null,
      submitted_answer: submittedAnswer,
      answer_confidence: correctness ? 'sure' : null,
      is_correct: correctness,
      source: text(fields.source) || null,
      assessment_kind: text(fields.assessment_kind) || null,
      review_round: text(fields.review_round) || null,
      review_status: text(fields.review_status) || null,
      source_question_id: text(fields.source_question_id) || null,
      source_test_id: text(fields.source_test_id) || null,
      migration_flags: migrationFlags,
    });
  }

  const questionCache = [];
  for (const record of sourceCache) {
    const fields = record.fields || {};
    const userKey = canonicalUsernameKey(fields.user);
    if (userKey === 'test_user1') {
      summary.skipped.testUser1 += 1;
      continue;
    }
    const user = usersByKey.get(userKey);
    if (!user) {
      blockingErrors.push(`QUESTION_CACHE ${record.record_id} has no canonical user for ${text(fields.user)}`);
      continue;
    }
    const sourceWordRecordId = text(fields.word_record_id);
    const word = wordsByFeishuId.get(sourceWordRecordId);
    if (!word || word.user_id !== user.id) {
      const reason = word ? 'word-owner-mismatch' : 'missing-word-reference';
      quarantine.questionCache.push({
        feishu_record_id: record.record_id,
        user: text(fields.user),
        source_word_record_id: sourceWordRecordId,
        word: text(fields.word),
        reason,
      });
      if (reason === 'missing-word-reference') summary.skipped.orphanCache += 1;
      continue;
    }
    const options = parseArray(fields.options, { label: `QUESTION_CACHE ${record.record_id} options`, warnings });
    const optionMeanings = parseArray(fields.option_meanings, { label: `QUESTION_CACHE ${record.record_id} option_meanings`, warnings });
    if (!options || !optionMeanings) blockingErrors.push(`QUESTION_CACHE ${record.record_id} has invalid JSON arrays`);
    const generatedAt = parseEpochMillis(fields.generated_at, { required: true, label: `QUESTION_CACHE ${record.record_id} generated_at`, warnings });
    if (!generatedAt) blockingErrors.push(`QUESTION_CACHE ${record.record_id} has invalid generated_at`);
    questionCache.push({
      id: stableUuid('cache', record.record_id),
      feishu_record_id: record.record_id,
      user_id: user.id,
      user_key: userKey,
      word_id: word.id,
      source_word_record_id: sourceWordRecordId,
      level: normalizeLevel(fields.level),
      question_type: text(fields.question_type),
      round_type: text(fields.round_type),
      quality_status: text(fields.quality_status),
      question_text: text(fields.question_text),
      context_zh: text(fields.context_cn) || null,
      suffix: text(fields.suffix) || null,
      options: options || [],
      answer: text(fields.answer),
      option_meanings: optionMeanings || [],
      correct_meaning: text(fields.correct_meaning) || null,
      ai_audit_status: text(fields.ai_audit_status) || null,
      source_version: text(fields.source_version) || null,
      used_count: parseInteger(fields.used_count, { label: `QUESTION_CACHE ${record.record_id} used_count`, warnings }),
      generated_at: generatedAt,
      last_used_at: parseEpochMillis(fields.last_used_at, { label: `QUESTION_CACHE ${record.record_id} last_used_at`, warnings }),
    });
  }

  summary.output = {
    users: users.length,
    words: words.length,
    assessments: assessments.length,
    cache: questionCache.length,
    wordPartsOfSpeech: wordPartsOfSpeech.reduce((count, row) => count + row.parts.length, 0),
  };
  return { users, words, wordPartsOfSpeech, assessments, questionCache, quarantine, warnings, blockingErrors, summary };
}

function buildReconciliation(result) {
  const { summary, users, words, assessments, questionCache, quarantine, warnings, blockingErrors } = result;
  const orphanCacheSkipped = quarantine.questionCache.filter(row => row.reason === 'missing-word-reference');
  const blockingCacheRows = quarantine.questionCache.filter(row => row.reason !== 'missing-word-reference');
  const userIds = new Set(users.map(row => row.id));
  const wordIds = new Set(words.map(row => row.id));
  const fk = {
    wordsWithValidUser: words.filter(row => userIds.has(row.user_id)).length,
    assessmentsWithValidUser: assessments.filter(row => userIds.has(row.user_id)).length,
    assessmentsWithValidOrHistoricalWord: assessments.filter(row => row.word_id === null || wordIds.has(row.word_id)).length,
    cacheWithValidUser: questionCache.filter(row => userIds.has(row.user_id)).length,
    cacheWithValidWord: questionCache.filter(row => wordIds.has(row.word_id)).length,
  };
  const driftWarnings = [];
  for (const key of ['words', 'tests', 'cache']) {
    if (summary.input[key] !== DOCUMENTED_COUNTS[key]) {
      driftWarnings.push(`Feishu ${key} count is ${summary.input[key]}, documented snapshot expected ${DOCUMENTED_COUNTS[key]}`);
    }
  }
  if (summary.levelFixes.inherited !== DOCUMENTED_CLEANUP_COUNTS.inheritedLevels) {
    driftWarnings.push(`Inherited level fixes are ${summary.levelFixes.inherited}, documented snapshot expected ${DOCUMENTED_CLEANUP_COUNTS.inheritedLevels}`);
  }
  return {
    source: summary.input,
    expectedInserts: summary.output,
    expectedSkips: {
      wordRows: summary.skipped.authOnlyWords + summary.skipped.testUser1,
      testRows: summary.skipped.emptyTests,
      orphanCacheRows: summary.skipped.orphanCache,
    },
    orphanCacheSkipped,
    foreignKeys: fk,
    warnings: [...driftWarnings, ...warnings],
    blockingErrors: [...blockingErrors, ...blockingCacheRows.map(row => `Quarantined cache ${row.feishu_record_id}: ${row.reason}`)],
  };
}

function printableRow(row) {
  const copy = { ...row };
  delete copy.password_hash;
  delete copy.password_salt;
  delete copy.parent_password_hash;
  delete copy.parent_password_salt;
  delete copy.options;
  delete copy.option_meanings;
  delete copy.distractors;
  delete copy.old_distractors;
  return copy;
}

function printDryRunReport(result) {
  const reconciliation = buildReconciliation(result);
  console.log('\n=== WordBot Feishu -> Supabase Backfill DRY-RUN ===');
  console.log('Mode: DRY-RUN (no Supabase connection, no writes)');
  console.log('\nFeishu input counts:', result.summary.input);
  console.log('Target output counts:', result.summary.output);
  console.log('Canonical user mapping:', result.summary.canonicalMerges.length ? result.summary.canonicalMerges : ['No case variants found']);
  console.log('Skipped rows:', result.summary.skipped);
  console.log(`Orphan cache skipped: ${reconciliation.orphanCacheSkipped.length}`);
  if (reconciliation.orphanCacheSkipped.length) console.table(reconciliation.orphanCacheSkipped);
  console.log('Level fixes:', result.summary.levelFixes);
  console.log('Nullable historical cases:', result.summary.nullableCases);
  console.log('\nFirst 3 users:');
  console.table(result.users.slice(0, 3).map(printableRow));
  console.log('First 5 words:');
  console.table(result.words.slice(0, 5).map(printableRow));
  console.log('First 5 assessments:');
  console.table(result.assessments.slice(0, 5).map(printableRow));
  console.log('\nReconciliation report:');
  console.dir(reconciliation, { depth: null, colors: false });
  return reconciliation;
}

function prepareSqlValue(column, value, jsonColumns) {
  if (jsonColumns.has(column) && value !== null && value !== undefined) return JSON.stringify(value);
  return value;
}

async function insertRows(client, table, columns, rows, conflictTarget = 'feishu_record_id', jsonColumns = new Set()) {
  if (!rows.length) return 0;
  const batchSize = 200;
  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const params = [];
    const groups = batch.map(row => {
      const placeholders = columns.map(column => {
        params.push(prepareSqlValue(column, row[column], jsonColumns));
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    const conflict = conflictTarget ? ` ON CONFLICT (${conflictTarget}) DO NOTHING` : ' ON CONFLICT DO NOTHING';
    const insertResult = await client.query(`INSERT INTO public.${table} (${columns.join(', ')}) VALUES ${groups.join(', ')}${conflict}`, params);
    inserted += insertResult.rowCount || 0;
  }
  return inserted;
}

function isDatabaseNetworkError(error) {
  const codes = new Set(['ENOTFOUND', 'ENETUNREACH', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT']);
  for (let current = error; current; current = current.cause) {
    if (codes.has(current.code)) return true;
    if (/getaddrinfo ENOTFOUND|network is unreachable|timeout expired/i.test(current.message || '')) return true;
  }
  return false;
}

async function insertRowsViaRest(supabase, table, columns, rows, conflictTarget, selectColumns) {
  if (!rows.length) return 0;
  const batchSize = 200;
  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize).map(row => Object.fromEntries(columns.map(column => [column, row[column]])));
    const options = { onConflict: conflictTarget, ignoreDuplicates: true };
    const { data, error } = await supabase.from(table).upsert(batch, options).select(selectColumns);
    if (error) throw new Error(`REST insert failed for ${table}: ${error.message}`);
    inserted += data?.length || 0;
  }
  return inserted;
}

async function fetchIdMap(client, table, sourceColumn, values) {
  if (!values.length) return new Map();
  const result = await client.query(`SELECT id, ${sourceColumn} FROM public.${table} WHERE ${sourceColumn} = ANY($1::text[])`, [values]);
  return new Map(result.rows.map(row => [row[sourceColumn], row.id]));
}

async function executeBackfill(result, databaseUrl) {
  const reconciliation = buildReconciliation(result);
  if (reconciliation.blockingErrors.length) {
    throw new Error(`Execution blocked by reconciliation errors:\n- ${reconciliation.blockingErrors.join('\n- ')}`);
  }
  const client = new Client({ connectionString: normalizeDatabaseUrl(databaseUrl), ssl: { rejectUnauthorized: false } });
  await client.connect();
  const insertedCounts = {};
  try {
    await client.query('BEGIN');
    insertedCounts.users = await insertRows(client, 'users', [
      'id', 'feishu_record_id', 'username', 'password_hash', 'password_salt', 'auth_created_at',
      'parent_username', 'parent_password_hash', 'parent_password_salt', 'parent_created_at',
      'phone', 'phone_verified_at', 'learning_level', 'level_changed_at',
    ], result.users, null);
    const userIdMap = await fetchIdMap(client, 'users', 'username_key', result.users.map(row => row.username_key));
    const wordRows = result.words.map(row => ({ ...row, user_id: userIdMap.get(row.user_key) }));
    insertedCounts.words = await insertRows(client, 'words', [
      'id', 'feishu_record_id', 'user_id', 'word', 'meaning_en', 'meaning_zh', 'context_en', 'context_zh',
      'distractors', 'old_distractors', 'level', 'mastery_status', 'multi_definition',
      'source_multi_definition_option_id', 'error_count', 'quality_flags', 'quality_note', 'entered_at', 'remembered_at',
    ], wordRows, 'feishu_record_id', new Set(['distractors', 'old_distractors']));
    const wordIdMap = await fetchIdMap(client, 'words', 'feishu_record_id', result.words.map(row => row.feishu_record_id));
    const posCodes = [...new Set(result.wordPartsOfSpeech.flatMap(row => row.parts))];
    insertedCounts.parts_of_speech = await insertRows(client, 'parts_of_speech', ['code', 'display_name'], posCodes.map(code => ({ code, display_name: code })), 'code');
    const posResult = await client.query('SELECT id, code FROM public.parts_of_speech WHERE code = ANY($1::text[])', [posCodes]);
    const posIdMap = new Map(posResult.rows.map(row => [row.code, row.id]));
    const junctionRows = result.wordPartsOfSpeech.flatMap(row => row.parts.map((part, index) => ({
      word_id: wordIdMap.get(row.feishu_record_id), part_of_speech_id: posIdMap.get(part), position: index + 1,
    })));
    insertedCounts.word_parts_of_speech = await insertRows(client, 'word_parts_of_speech', ['word_id', 'part_of_speech_id', 'position'], junctionRows, null);
    const assessmentRows = result.assessments.map(row => ({
      ...row,
      user_id: userIdMap.get(row.user_key),
      word_id: row.source_word_record_id ? wordIdMap.get(row.source_word_record_id) || null : null,
    }));
    insertedCounts.assessments = await insertRows(client, 'assessments', [
      'id', 'feishu_record_id', 'user_id', 'word_id', 'source_word_record_id', 'test_id', 'is_real_assessment',
      'assessed_at', 'learning_day', 'question_type', 'level', 'word_snapshot', 'question_text', 'options',
      'correct_answer', 'submitted_answer', 'answer_confidence', 'is_correct', 'source', 'assessment_kind',
      'review_round', 'review_status', 'source_question_id', 'source_test_id', 'migration_flags',
    ], assessmentRows, 'feishu_record_id', new Set(['options']));
    const cacheRows = result.questionCache.map(row => ({
      ...row, user_id: userIdMap.get(row.user_key), word_id: wordIdMap.get(row.source_word_record_id),
    }));
    insertedCounts.question_cache = await insertRows(client, 'question_cache', [
      'id', 'feishu_record_id', 'user_id', 'word_id', 'source_word_record_id', 'level', 'question_type',
      'round_type', 'quality_status', 'question_text', 'context_zh', 'suffix', 'options', 'answer',
      'option_meanings', 'correct_meaning', 'ai_audit_status', 'source_version', 'used_count', 'generated_at', 'last_used_at',
    ], cacheRows, 'feishu_record_id', new Set(['options', 'option_meanings']));
    await client.query('COMMIT');
    console.log('Backfill transaction committed.');
    console.log('Production rows inserted:', insertedCounts);
    console.log('Production skipped rows:', result.summary.skipped);
    return insertedCounts;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

async function executeBackfillViaRest(result) {
  const reconciliation = buildReconciliation(result);
  if (reconciliation.blockingErrors.length) {
    throw new Error(`Execution blocked by reconciliation errors:\n- ${reconciliation.blockingErrors.join('\n- ')}`);
  }
  const supabase = require('./supabase-client');
  const insertedCounts = {};
  const userColumns = [
    'id', 'feishu_record_id', 'username', 'password_hash', 'password_salt', 'auth_created_at',
    'parent_username', 'parent_password_hash', 'parent_password_salt', 'parent_created_at',
    'phone', 'phone_verified_at', 'learning_level', 'level_changed_at',
  ];
  const wordColumns = [
    'id', 'feishu_record_id', 'user_id', 'word', 'meaning_en', 'meaning_zh', 'context_en', 'context_zh',
    'distractors', 'old_distractors', 'level', 'mastery_status', 'multi_definition',
    'source_multi_definition_option_id', 'error_count', 'quality_flags', 'quality_note', 'entered_at', 'remembered_at',
  ];
  const assessmentColumns = [
    'id', 'feishu_record_id', 'user_id', 'word_id', 'source_word_record_id', 'test_id', 'is_real_assessment',
    'assessed_at', 'learning_day', 'question_type', 'level', 'word_snapshot', 'question_text', 'options',
    'correct_answer', 'submitted_answer', 'answer_confidence', 'is_correct', 'source', 'assessment_kind',
    'review_round', 'review_status', 'source_question_id', 'source_test_id', 'migration_flags',
  ];
  const cacheColumns = [
    'id', 'feishu_record_id', 'user_id', 'word_id', 'source_word_record_id', 'level', 'question_type',
    'round_type', 'quality_status', 'question_text', 'context_zh', 'suffix', 'options', 'answer',
    'option_meanings', 'correct_meaning', 'ai_audit_status', 'source_version', 'used_count', 'generated_at', 'last_used_at',
  ];

  insertedCounts.users = await insertRowsViaRest(supabase, 'users', userColumns, result.users, 'feishu_record_id', 'id');
  insertedCounts.words = await insertRowsViaRest(supabase, 'words', wordColumns, result.words, 'feishu_record_id', 'id');
  const posCodes = [...new Set(result.wordPartsOfSpeech.flatMap(row => row.parts))];
  insertedCounts.parts_of_speech = await insertRowsViaRest(
    supabase,
    'parts_of_speech',
    ['code', 'display_name'],
    posCodes.map(code => ({ code, display_name: code })),
    'code',
    'id'
  );
  const { data: posRows, error: posError } = await supabase.from('parts_of_speech').select('id,code').in('code', posCodes);
  if (posError) throw new Error(`REST lookup failed for parts_of_speech: ${posError.message}`);
  const posIdMap = new Map(posRows.map(row => [row.code, row.id]));
  const wordIdMap = new Map(result.words.map(row => [row.feishu_record_id, row.id]));
  const junctionRows = result.wordPartsOfSpeech.flatMap(row => row.parts.map((part, index) => ({
    word_id: wordIdMap.get(row.feishu_record_id),
    part_of_speech_id: posIdMap.get(part),
    position: index + 1,
  })));
  insertedCounts.word_parts_of_speech = await insertRowsViaRest(
    supabase,
    'word_parts_of_speech',
    ['word_id', 'part_of_speech_id', 'position'],
    junctionRows,
    'word_id,part_of_speech_id',
    'word_id'
  );
  insertedCounts.assessments = await insertRowsViaRest(supabase, 'assessments', assessmentColumns, result.assessments, 'feishu_record_id', 'id');
  insertedCounts.question_cache = await insertRowsViaRest(supabase, 'question_cache', cacheColumns, result.questionCache, 'feishu_record_id', 'id');
  console.log('Backfill REST execution completed.');
  console.log('Production rows inserted:', insertedCounts);
  console.log('Production skipped rows:', result.summary.skipped);
  return insertedCounts;
}

async function readFeishuSource() {
  const { getRecords } = require('./feishu');
  const { WORD_TABLE, TEST_TABLE, QUESTION_CACHE_TABLE } = require('./config');
  const [words, tests, cache] = await Promise.all([
    getRecords(WORD_TABLE), getRecords(TEST_TABLE), getRecords(QUESTION_CACHE_TABLE),
  ]);
  return { words, tests, cache };
}

function parseMode(argv) {
  const execute = argv.includes('--execute');
  if (execute && argv.includes('--dry-run')) throw new Error('Choose either --dry-run or --execute, not both');
  const unknown = argv.filter(arg => !['--dry-run', '--execute'].includes(arg));
  if (unknown.length) throw new Error(`Unknown CLI flag(s): ${unknown.join(', ')}`);
  return { execute, dryRun: !execute };
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  const env = loadEnvironment({ execute: mode.execute });
  const source = await readFeishuSource();
  const result = transformBackfill(source);
  const reconciliation = printDryRunReport(result);
  if (mode.execute) {
    console.log('\n--execute selected: starting production transaction after dry-run report.');
    try {
      await executeBackfill(result, env.DATABASE_URL);
    } catch (error) {
      if (!isDatabaseNetworkError(error)) throw error;
      console.warn(`Direct database connection unavailable (${error.code || error.message}); falling back to idempotent Supabase REST batches.`);
      await executeBackfillViaRest(result);
    }
  } else if (reconciliation.blockingErrors.length) {
    console.log(`\nDRY-RUN completed with ${reconciliation.blockingErrors.length} blocking reconciliation issue(s).`);
  } else {
    console.log('\nDRY-RUN completed successfully. No Supabase writes were performed.');
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Backfill failed: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildReconciliation,
  canonicalUsernameKey,
  executeBackfill,
  executeBackfillViaRest,
  insertRowsViaRest,
  isDatabaseNetworkError,
  loadEnvironment,
  normalizeDatabaseUrl,
  normalizeLevel,
  normalizePartsOfSpeech,
  parseEpochMillis,
  prepareSqlValue,
  insertRows,
  transformBackfill,
};
