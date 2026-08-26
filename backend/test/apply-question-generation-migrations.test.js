const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { PGlite } = require('@electric-sql/pglite');

const {
  MIGRATION_PATHS,
  RPC_VERIFICATION_ALIASES,
  applyQuestionGenerationMigrations,
  normalizeDatabaseUrl,
  VERIFICATION_SQL,
} = require('../scripts/apply-question-generation-migrations');

const RPC_SIGNATURES = Object.freeze({
  claim_question_generation_jobs: 'public.claim_question_generation_jobs(text,integer,bigint)',
  renew_question_generation_job: 'public.renew_question_generation_job(uuid,text,bigint,uuid,bigint)',
  publish_question_generation_variants: 'public.publish_question_generation_variants(uuid,text,bigint,uuid,jsonb)',
  complete_question_generation_job: 'public.complete_question_generation_job(uuid,text,bigint,uuid)',
  fail_question_generation_job: 'public.fail_question_generation_job(uuid,text,bigint,uuid,integer,bigint,bigint,text,text,jsonb)',
  enqueue_question_generation_job_if_needed: 'public.enqueue_question_generation_job_if_needed(uuid,uuid,text)',
  fence_word_question_generation: 'public.fence_word_question_generation(uuid,uuid)',
  finalize_word_question_generation_edit: 'public.finalize_word_question_generation_edit(uuid,uuid)',
  reconcile_word_mastery_status: 'public.reconcile_word_mastery_status(uuid,uuid,text,timestamptz,text,timestamptz)',
  invalidate_formal_quiz_question: 'public.invalidate_formal_quiz_question(uuid,text,uuid,text,timestamptz)',
  replace_formal_quiz_question: 'public.replace_formal_quiz_question(uuid,text,uuid,uuid,text,text,jsonb,timestamptz)',
});

const RPC_STATE_KEYS = Object.freeze(
  Object.keys(RPC_SIGNATURES).flatMap(name => {
    const stateName = RPC_VERIFICATION_ALIASES[name] || name;
    return [
      `rpc_${stateName}_signature`,
      `rpc_${stateName}_security_definer`,
      `rpc_${stateName}_public_execute`,
      `rpc_${stateName}_anon_execute`,
      `rpc_${stateName}_authenticated_execute`,
      `rpc_${stateName}_service_role_execute`,
    ];
  })
);

test('verification keys fit PostgreSQL identifier limits', () => {
  for (const key of RPC_STATE_KEYS) {
    assert.ok(Buffer.byteLength(key, 'utf8') <= 63, key);
  }
});

test('normalizes a DATABASE_URL whose password contains unencoded reserved characters', () => {
  assert.equal(
    normalizeDatabaseUrl('postgresql://postgres:abc?def!@db.example.com:5432/postgres'),
    'postgresql://postgres:abc%3Fdef!@db.example.com:5432/postgres'
  );
});

test('migration paths include the versioned hardening migration in order', () => {
  assert.deepEqual(
    MIGRATION_PATHS.map(filePath => path.basename(filePath)),
    [
      '20260803_question_generation_jobs.sql',
      '20260803_question_generation_claim_rpc.sql',
      '20260804_question_generation_backfill_hardening.sql',
      '20260806_word_edit_generation_version.sql',
      '20260807_formal_quiz_challenges.sql',
      '20260808_formal_bad_question_replacement.sql',
      '20260810_word_edit_cache_fk_hardening.sql',
      '20260811_formal_question_quality_gate.sql',
      '20260814_assessment_parent_review_id.sql',
      '20260814_assessment_context_zh.sql',
      '20260814_reconcile_word_mastery_status.sql',
      '20260816_enqueue_rpc_acl.sql',
      '20260816_assessment_option_meanings.sql',
      '20260817_quiz_session_progress.sql',
      '20260818_formal_chinese_analysis_quality_gate.sql',
      '20260819_mandatory_ai_question_audit.sql',
      '20260824_formal_ai_audit_gate.sql',
      '20260824_game_states.sql',
      '20260825_enqueue_strict_ai_coverage.sql',
    ]
  );
  assert.ok(MIGRATION_PATHS.every(filePath => path.dirname(filePath).endsWith(`${path.sep}migrations`)));
});

test('strict enqueue coverage migration requires approved AI audit rows and preserves manual review', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '20260825_enqueue_strict_ai_coverage.sql'),
    'utf8'
  );

  assert.match(migration, /lower\(btrim\(ai_audit_status\)\) = 'approved'/);
  assert.doesNotMatch(migration, /status in \('ready', 'needs_manual_review'\)/);
});

test('the backend service start command runs migrations before starting the server', () => {
  const backendPackage = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(backendPackage.scripts.prestart, 'node scripts/apply-question-generation-migrations.js');
});

test('missing DATABASE_URL fails before a database client is constructed', async () => {
  let constructed = false;
  class ForbiddenClient {
    constructor() {
      constructed = true;
    }
  }

  await assert.rejects(
    applyQuestionGenerationMigrations({ env: {}, Client: ForbiddenClient }),
    /DATABASE_URL is required/
  );
  assert.equal(constructed, false);
});

const COMPLETE_STATE = Object.freeze({
  jobs_table: true,
  formal_challenges_table: true,
  formal_challenge_questions_table: true,
  formal_display_events_table: true,
  formal_challenges_rls_enabled: true,
  formal_challenge_questions_rls_enabled: true,
  formal_display_events_rls_enabled: true,
  formal_challenges_index: true,
  formal_display_events_index: true,
  jobs_rls_enabled: true,
  enqueue_trigger: true,
  fingerprint_unique_index: true,
  claim_function: true,
  claim_public_execute: false,
  claim_anon_execute: false,
  claim_authenticated_execute: false,
  claim_service_role_execute: false,
  word_generation_version_column: true,
  job_word_version_column: true,
  ...Object.fromEntries(RPC_STATE_KEYS.map(key => [key, key.endsWith('_public_execute') || key.endsWith('_anon_execute') || key.endsWith('_authenticated_execute') ? false : true])),
  rpc_create_formal_quiz_challenge_signature: true,
  rpc_create_formal_quiz_challenge_security_definer: false,
  rpc_create_formal_quiz_challenge_public_execute: false,
  rpc_create_formal_quiz_challenge_anon_execute: false,
  rpc_create_formal_quiz_challenge_authenticated_execute: false,
  rpc_create_formal_quiz_challenge_service_role_execute: true,
  rpc_invalidate_formal_quiz_question_security_definer: false,
  rpc_replace_formal_quiz_question_security_definer: false,
  job_lease_token_column: true,
  formal_quality_function: true,
  formal_quality_function_security_invoker: true,
  formal_quality_function_safe_search_path: true,
  formal_quality_translation_contract: true,
  formal_quality_function_public_execute: false,
  formal_quality_function_anon_execute: false,
  formal_quality_function_authenticated_execute: false,
  formal_quality_function_service_role_execute: false,
  formal_quality_trigger: true,
  assessments_table: true,
  game_states_table: true,
  game_states_rls_enabled: true,
  game_states_service_role_access: true,
  game_states_anon_access: false,
  game_states_authenticated_access: false,
  assessments_rls_enabled: true,
  assessment_parent_review_id_column: true,
  assessment_context_zh_column: true,
  assessment_option_meanings_column: true,
  assessment_parent_review_index: true,
  quiz_session_state_column: true,
  quiz_session_updated_at_column: true,
  quiz_session_updated_at_trigger: true,
  rpc_reconcile_word_mastery_status_safe_search_path: true,
  rpc_publish_question_generation_variants_ai_audit_contract: true,
  rpc_enqueue_job_if_needed_strict_ai_audit_contract: true,
  rpc_create_formal_quiz_challenge_ai_audit_contract: true,
  rpc_replace_formal_quiz_question_ai_audit_contract: true,
  backfill_hardening_revision: true,
  rpc_old_claim_signature_absent: true,
  rpc_old_renew_signature_absent: true,
  rpc_old_publish_signature_absent: true,
  rpc_old_complete_signature_absent: true,
  rpc_old_fail_signature_absent: true,
});

const INCOMPLETE_STATE = Object.freeze({
  ...COMPLETE_STATE,
  claim_function: false,
  claim_service_role_execute: false,
  rpc_claim_question_generation_jobs_service_role_execute: false,
  rpc_old_claim_signature_absent: false,
  backfill_hardening_revision: false,
  word_generation_version_column: false,
  job_word_version_column: false,
  rpc_fence_word_question_generation_signature: false,
  job_lease_token_column: false,
  rpc_fence_word_question_generation_security_definer: false,
  rpc_fence_word_question_generation_service_role_execute: false,
  rpc_finalize_word_edit_signature: false,
  rpc_finalize_word_edit_security_definer: false,
  rpc_finalize_word_edit_service_role_execute: false,
  formal_quality_function: false,
  formal_quality_function_security_invoker: false,
  formal_quality_function_safe_search_path: false,
  formal_quality_translation_contract: false,
  formal_quality_function_public_execute: true,
  formal_quality_trigger: false,
  assessment_parent_review_id_column: false,
  assessment_parent_review_index: false,
});

const QUALITY_GATE_MISSING_STATE = Object.freeze({
  ...COMPLETE_STATE,
  formal_quality_function: false,
  formal_quality_function_security_invoker: false,
  formal_quality_function_safe_search_path: false,
  formal_quality_translation_contract: false,
  formal_quality_function_public_execute: true,
  formal_quality_trigger: false,
});

const ASSESSMENT_PARENT_REVIEW_MISSING_STATE = Object.freeze({
  ...COMPLETE_STATE,
  assessment_parent_review_id_column: false,
  assessment_parent_review_index: false,
});

const ASSESSMENT_CONTEXT_ZH_MISSING_STATE = Object.freeze({
  ...COMPLETE_STATE,
  assessment_context_zh_column: false,
});

const ASSESSMENT_OPTION_MEANINGS_MISSING_STATE = Object.freeze({
  ...COMPLETE_STATE,
  assessment_option_meanings_column: false,
});

const QUIZ_SESSION_SCHEMA_MISSING_STATE = Object.freeze({
  ...COMPLETE_STATE,
  quiz_session_state_column: false,
  quiz_session_updated_at_column: false,
  quiz_session_updated_at_trigger: false,
});

const MANDATORY_AI_AUDIT_MISSING_STATE = Object.freeze({
  ...COMPLETE_STATE,
  rpc_publish_question_generation_variants_ai_audit_contract: false,
});

const FORMAL_AI_AUDIT_MISSING_STATE = Object.freeze({
  ...COMPLETE_STATE,
  rpc_create_formal_quiz_challenge_ai_audit_contract: false,
  rpc_replace_formal_quiz_question_ai_audit_contract: false,
});

const STRICT_ENQUEUE_AI_AUDIT_MISSING_STATE = Object.freeze({
  ...COMPLETE_STATE,
  rpc_enqueue_job_if_needed_strict_ai_audit_contract: false,
});

function createDatabaseHarness({ states, failSql } = {}) {
  const events = [];
  const instances = [];
  const pendingStates = [...(states || [])];

  class FakeClient {
    constructor(config) {
      this.config = config;
      this.ended = false;
      instances.push(this);
    }

    async connect() {
      events.push('connect');
    }

    async query(sql) {
      const statement = String(sql).trim();
      events.push(`query:${statement}`);
      if (failSql && statement === failSql) throw new Error('planned migration failure');
      if (statement.includes('question-generation-migration-state')) {
        const state = pendingStates.shift();
        if (!state) throw new Error('unexpected verification query');
        return { rows: [state] };
      }
      return { rows: [] };
    }

    async end() {
      this.ended = true;
      events.push('end');
    }
  }

  return { Client: FakeClient, events, instances };
}

test('an already complete database is only inspected in a read-only transaction', async () => {
  const harness = createDatabaseHarness({ states: [COMPLETE_STATE] });
  const result = await applyQuestionGenerationMigrations({
    env: { DATABASE_URL: 'postgresql://postgres:test@db.example.com/postgres' },
    Client: harness.Client,
    readFile: async () => {
      throw new Error('complete migrations must not read SQL files');
    },
  });

  assert.equal(result.status, 'already_complete');
  assert.deepEqual(result.appliedMigrations, []);
  assert.deepEqual(result.verification, COMPLETE_STATE);
  assert.equal(harness.events[0], 'connect');
  assert.equal(harness.events[1], 'query:BEGIN READ ONLY');
  assert.match(harness.events[2], /question-generation-migration-state/);
  assert.equal(harness.events[3], 'query:COMMIT');
  assert.equal(harness.events[4], 'end');
});

test('an incomplete database is inspected, migrated in fixed order, and verified again', async () => {
  const harness = createDatabaseHarness({ states: [INCOMPLETE_STATE, COMPLETE_STATE] });
  const migrationSql = new Map([
    [MIGRATION_PATHS[0], '-- migration jobs'],
    [MIGRATION_PATHS[1], '-- migration claim rpc'],
    [MIGRATION_PATHS[2], '-- migration backfill hardening'],
    [MIGRATION_PATHS[3], '-- migration word edit version'],
    [MIGRATION_PATHS[4], '-- migration formal quiz challenges'],
  ]);
  const readPaths = [];
  const databaseUrl = 'postgresql://postgres:abc?def!@db.example.com:5432/postgres';

  const result = await applyQuestionGenerationMigrations({
    env: { DATABASE_URL: databaseUrl },
    Client: harness.Client,
    readFile: async filePath => {
      readPaths.push(filePath);
      return migrationSql.get(filePath);
    },
  });

  assert.deepEqual(readPaths, MIGRATION_PATHS);
  assert.equal(harness.instances[0].config.connectionString, normalizeDatabaseUrl(databaseUrl));
  assert.deepEqual(harness.instances[0].config.ssl, { rejectUnauthorized: false });
  assert.ok(harness.events.indexOf('query:-- migration jobs') < harness.events.indexOf('query:-- migration claim rpc'));
  assert.ok(harness.events.indexOf('query:-- migration claim rpc') < harness.events.indexOf('query:-- migration backfill hardening'));
  assert.ok(harness.events.indexOf('query:-- migration backfill hardening') < harness.events.indexOf('query:-- migration word edit version'));
  assert.ok(harness.events.indexOf('query:-- migration word edit version') < harness.events.indexOf('query:-- migration formal quiz challenges'));
  assert.equal(result.status, 'applied');
  assert.deepEqual(result.appliedMigrations, MIGRATION_PATHS.map(filePath => path.basename(filePath)));
  assert.deepEqual(result.verification, COMPLETE_STATE);
  assert.doesNotMatch(JSON.stringify(result), /abc|DATABASE_URL|db\.example\.com/);
  assert.equal(harness.instances[0].ended, true);
});

test('a database missing only the formal quality gate replays the fixed chain', async () => {
  const harness = createDatabaseHarness({ states: [QUALITY_GATE_MISSING_STATE, COMPLETE_STATE] });
  const readPaths = [];

  const result = await applyQuestionGenerationMigrations({
    env: { DATABASE_URL: 'postgresql://postgres:test@db.example.com/postgres' },
    Client: harness.Client,
    readFile: async filePath => {
      readPaths.push(filePath);
      return `-- ${path.basename(filePath)}`;
    },
  });

  assert.equal(result.status, 'applied');
  assert.deepEqual(readPaths, MIGRATION_PATHS);
  assert.deepEqual(result.verification, COMPLETE_STATE);
});

test('a database missing only assessment parent review support replays the fixed chain', async () => {
  const harness = createDatabaseHarness({
    states: [ASSESSMENT_PARENT_REVIEW_MISSING_STATE, COMPLETE_STATE],
  });
  const readPaths = [];

  const result = await applyQuestionGenerationMigrations({
    env: { DATABASE_URL: 'postgresql://postgres:test@db.example.com/postgres' },
    Client: harness.Client,
    readFile: async filePath => {
      readPaths.push(filePath);
      return `-- ${path.basename(filePath)}`;
    },
  });

  assert.equal(result.status, 'applied');
  assert.deepEqual(readPaths, MIGRATION_PATHS);
  assert.deepEqual(result.verification, COMPLETE_STATE);
});

test('a database missing only assessment context translation support replays the fixed chain', async () => {
  const harness = createDatabaseHarness({
    states: [ASSESSMENT_CONTEXT_ZH_MISSING_STATE, COMPLETE_STATE],
  });
  const readPaths = [];

  const result = await applyQuestionGenerationMigrations({
    env: { DATABASE_URL: 'postgresql://postgres:test@db.example.com/postgres' },
    Client: harness.Client,
    readFile: async filePath => {
      readPaths.push(filePath);
      return `-- ${path.basename(filePath)}`;
    },
  });

  assert.equal(result.status, 'applied');
  assert.deepEqual(readPaths, MIGRATION_PATHS);
  assert.deepEqual(result.verification, COMPLETE_STATE);
});

test('a database missing assessment option meanings replays the fixed chain', async () => {
  const harness = createDatabaseHarness({
    states: [ASSESSMENT_OPTION_MEANINGS_MISSING_STATE, COMPLETE_STATE],
  });
  const readPaths = [];

  const result = await applyQuestionGenerationMigrations({
    env: { DATABASE_URL: 'postgresql://postgres:test@db.example.com/postgres' },
    Client: harness.Client,
    readFile: async filePath => {
      readPaths.push(filePath);
      return `-- ${path.basename(filePath)}`;
    },
  });

  assert.equal(result.status, 'applied');
  assert.deepEqual(readPaths, MIGRATION_PATHS);
  assert.deepEqual(result.verification, COMPLETE_STATE);
});

test('a database missing quiz session progress schema replays the fixed chain', async () => {
  const harness = createDatabaseHarness({
    states: [QUIZ_SESSION_SCHEMA_MISSING_STATE, COMPLETE_STATE],
  });
  const readPaths = [];

  const result = await applyQuestionGenerationMigrations({
    env: { DATABASE_URL: 'postgresql://postgres:test@db.example.com/postgres' },
    Client: harness.Client,
    readFile: async filePath => {
      readPaths.push(filePath);
      return `-- ${path.basename(filePath)}`;
    },
  });

  assert.equal(result.status, 'applied');
  assert.deepEqual(readPaths, MIGRATION_PATHS);
  assert.deepEqual(result.verification, COMPLETE_STATE);
});

test('a database missing only the publish AI-audit contract replays the fixed chain', async () => {
  const harness = createDatabaseHarness({
    states: [MANDATORY_AI_AUDIT_MISSING_STATE, COMPLETE_STATE],
  });
  const readPaths = [];

  const result = await applyQuestionGenerationMigrations({
    env: { DATABASE_URL: 'postgresql://postgres:test@db.example.com/postgres' },
    Client: harness.Client,
    readFile: async filePath => {
      readPaths.push(filePath);
      return `-- ${path.basename(filePath)}`;
    },
  });

  assert.equal(result.status, 'applied');
  assert.deepEqual(readPaths, MIGRATION_PATHS);
  assert.deepEqual(result.verification, COMPLETE_STATE);
});

test('a database missing only the formal AI-audit contracts replays the fixed chain', async () => {
  const harness = createDatabaseHarness({
    states: [FORMAL_AI_AUDIT_MISSING_STATE, COMPLETE_STATE],
  });
  const readPaths = [];

  const result = await applyQuestionGenerationMigrations({
    env: { DATABASE_URL: 'postgresql://postgres:test@db.example.com/postgres' },
    Client: harness.Client,
    readFile: async filePath => {
      readPaths.push(filePath);
      return `-- ${path.basename(filePath)}`;
    },
  });

  assert.equal(result.status, 'applied');
  assert.deepEqual(readPaths, MIGRATION_PATHS);
  assert.deepEqual(result.verification, COMPLETE_STATE);
});

test('a database missing only the strict enqueue AI-audit contract replays the fixed chain', async () => {
  const harness = createDatabaseHarness({
    states: [STRICT_ENQUEUE_AI_AUDIT_MISSING_STATE, COMPLETE_STATE],
  });
  const readPaths = [];

  const result = await applyQuestionGenerationMigrations({
    env: { DATABASE_URL: 'postgresql://postgres:test@db.example.com/postgres' },
    Client: harness.Client,
    readFile: async filePath => {
      readPaths.push(filePath);
      return `-- ${path.basename(filePath)}`;
    },
  });

  assert.equal(result.status, 'applied');
  assert.deepEqual(readPaths, MIGRATION_PATHS);
  assert.deepEqual(result.verification, COMPLETE_STATE);
});

test('a migration SQL failure rejects and always closes the database client', async () => {
  const harness = createDatabaseHarness({ states: [INCOMPLETE_STATE], failSql: '-- migration claim rpc' });

  await assert.rejects(
    applyQuestionGenerationMigrations({
      env: { DATABASE_URL: 'postgresql://postgres:test@db.example.com/postgres' },
      Client: harness.Client,
      readFile: async filePath => filePath === MIGRATION_PATHS[0] ? '-- migration jobs' : '-- migration claim rpc',
    }),
    /planned migration failure/
  );

  assert.equal(harness.instances[0].ended, true);
});

test('post-migration verification failure rejects instead of reporting success', async () => {
  const harness = createDatabaseHarness({ states: [INCOMPLETE_STATE, INCOMPLETE_STATE] });

  await assert.rejects(
    applyQuestionGenerationMigrations({
      env: { DATABASE_URL: 'postgresql://postgres:test@db.example.com/postgres' },
      Client: harness.Client,
      readFile: async filePath => `-- ${path.basename(filePath)}`,
    }),
    /verification failed.*claim_function.*rpc_claim_question_generation_jobs_service_role_execute/i
  );
  assert.equal(harness.instances[0].ended, true);
});

test('post-migration verification fails closed when the formal quality gate remains incomplete', async () => {
  const harness = createDatabaseHarness({
    states: [QUALITY_GATE_MISSING_STATE, QUALITY_GATE_MISSING_STATE],
  });

  await assert.rejects(
    applyQuestionGenerationMigrations({
      env: { DATABASE_URL: 'postgresql://postgres:test@db.example.com/postgres' },
      Client: harness.Client,
      readFile: async filePath => `-- ${path.basename(filePath)}`,
    }),
    /verification failed.*formal_quality_function.*formal_quality_function_security_invoker.*formal_quality_trigger/i
  );
  assert.equal(harness.instances[0].ended, true);
});

test('post-migration verification fails closed when assessment parent review support remains incomplete', async () => {
  const harness = createDatabaseHarness({
    states: [ASSESSMENT_PARENT_REVIEW_MISSING_STATE, ASSESSMENT_PARENT_REVIEW_MISSING_STATE],
  });

  await assert.rejects(
    applyQuestionGenerationMigrations({
      env: { DATABASE_URL: 'postgresql://postgres:test@db.example.com/postgres' },
      Client: harness.Client,
      readFile: async filePath => `-- ${path.basename(filePath)}`,
    }),
    /verification failed.*assessment_parent_review_id_column.*assessment_parent_review_index/i
  );
  assert.equal(harness.instances[0].ended, true);
});

test('post-migration verification fails closed when assessment context translation remains incomplete', async () => {
  const harness = createDatabaseHarness({
    states: [ASSESSMENT_CONTEXT_ZH_MISSING_STATE, ASSESSMENT_CONTEXT_ZH_MISSING_STATE],
  });

  await assert.rejects(
    applyQuestionGenerationMigrations({
      env: { DATABASE_URL: 'postgresql://postgres:test@db.example.com/postgres' },
      Client: harness.Client,
      readFile: async filePath => `-- ${path.basename(filePath)}`,
    }),
    /verification failed.*assessment_context_zh_column/i
  );
  assert.equal(harness.instances[0].ended, true);
});

test('post-migration verification fails closed when assessment option meanings remain missing', async () => {
  const harness = createDatabaseHarness({
    states: [ASSESSMENT_OPTION_MEANINGS_MISSING_STATE, ASSESSMENT_OPTION_MEANINGS_MISSING_STATE],
  });

  await assert.rejects(
    applyQuestionGenerationMigrations({
      env: { DATABASE_URL: 'postgresql://postgres:test@db.example.com/postgres' },
      Client: harness.Client,
      readFile: async filePath => `-- ${path.basename(filePath)}`,
    }),
    /verification failed.*assessment_option_meanings_column/i
  );
  assert.equal(harness.instances[0].ended, true);
});

test('post-migration verification fails closed when quiz session progress schema remains missing', async () => {
  const harness = createDatabaseHarness({
    states: [QUIZ_SESSION_SCHEMA_MISSING_STATE, QUIZ_SESSION_SCHEMA_MISSING_STATE],
  });

  await assert.rejects(
    applyQuestionGenerationMigrations({
      env: { DATABASE_URL: 'postgresql://postgres:test@db.example.com/postgres' },
      Client: harness.Client,
      readFile: async filePath => `-- ${path.basename(filePath)}`,
    }),
    /verification failed.*quiz_session_state_column.*quiz_session_updated_at_column.*quiz_session_updated_at_trigger/i
  );
  assert.equal(harness.instances[0].ended, true);
});

test('verification SQL checks required objects and direct execute ACLs', () => {
  assert.match(VERIFICATION_SQL, /question_generation_jobs/);
  assert.match(VERIFICATION_SQL, /formal_challenges_table/);
  assert.match(VERIFICATION_SQL, /formal_challenge_questions_table/);
  assert.match(VERIFICATION_SQL, /formal_display_events_table/);
  assert.match(VERIFICATION_SQL, /relrowsecurity/);
  assert.match(VERIFICATION_SQL, /words_enqueue_question_generation_job/);
  assert.match(VERIFICATION_SQL, /backfill_hardening_revision/);
  assert.match(VERIFICATION_SQL, /index_meta\.indisunique/);
  assert.match(VERIFICATION_SQL, /index_meta\.indpred is null/);
  assert.match(VERIFICATION_SQL, /claim_question_generation_jobs/);
  assert.match(VERIFICATION_SQL, /grantee = 0/);
  assert.match(VERIFICATION_SQL, /rolname = 'anon'/);
  assert.match(VERIFICATION_SQL, /rolname = 'authenticated'/);
  assert.match(VERIFICATION_SQL, /rolname = 'service_role'/);
  for (const [name, signature] of Object.entries(RPC_SIGNATURES)) {
    const verificationName = RPC_VERIFICATION_ALIASES[name] || name;
    assert.ok(VERIFICATION_SQL.includes(signature), signature);
    assert.match(VERIFICATION_SQL, new RegExp('rpc_' + verificationName + '_security_definer'));
  }
  assert.match(VERIFICATION_SQL, /prosecdef/);
  assert.match(VERIFICATION_SQL, /rpc_old_claim_signature_absent/);
  assert.match(VERIFICATION_SQL, /validate_formal_challenge_question_quality\(\)/);
  assert.match(VERIFICATION_SQL, /formal_quality_function_security_invoker/);
  assert.match(VERIFICATION_SQL, /formal_quality_function_safe_search_path/);
  assert.match(VERIFICATION_SQL, /formal_quality_translation_contract/);
  assert.match(VERIFICATION_SQL, /formal_quality_function_public_execute/);
  assert.match(VERIFICATION_SQL, /formal_quality_function_anon_execute/);
  assert.match(VERIFICATION_SQL, /formal_quality_function_authenticated_execute/);
  assert.match(VERIFICATION_SQL, /formal_quality_function_service_role_execute/);
  assert.match(VERIFICATION_SQL, /has_function_privilege\('service_role',\s*rpc\.oid,\s*'EXECUTE'\)/i);
  assert.match(VERIFICATION_SQL, /formal_quality_trigger/);
  assert.match(VERIFICATION_SQL, /assessment_parent_review_id_column/);
  assert.match(VERIFICATION_SQL, /assessment_context_zh_column/);
  assert.match(VERIFICATION_SQL, /assessment_option_meanings_column/);
  assert.match(VERIFICATION_SQL, /assessment_parent_review_index/);
  assert.match(VERIFICATION_SQL, /assessments_rls_enabled/);
  assert.match(
    VERIFICATION_SQL,
    /has_table_privilege\('service_role',[\s\S]*?'SELECT'\)[\s\S]*?and[\s\S]*?has_table_privilege\('service_role',[\s\S]*?'INSERT'\)[\s\S]*?and[\s\S]*?has_table_privilege\('service_role',[\s\S]*?'UPDATE'\)/i
  );
  assert.match(VERIFICATION_SQL, /has_table_privilege\('anon',[\s\S]*?'SELECT,INSERT,UPDATE,DELETE'\)/i);
  assert.match(VERIFICATION_SQL, /has_table_privilege\('authenticated',[\s\S]*?'SELECT,INSERT,UPDATE,DELETE'\)/i);
  assert.match(VERIFICATION_SQL, /quiz_session_state_column/);
  assert.match(VERIFICATION_SQL, /quiz_session_updated_at_column/);
  assert.match(VERIFICATION_SQL, /quiz_session_updated_at_trigger/);
  assert.match(VERIFICATION_SQL, /rpc_reconcile_word_mastery_status_safe_search_path/);
  assert.match(VERIFICATION_SQL, /rpc_publish_question_generation_variants_ai_audit_contract/);
  assert.match(VERIFICATION_SQL, /rpc_enqueue_job_if_needed_strict_ai_audit_contract/);
  assert.match(VERIFICATION_SQL, /rpc_create_formal_quiz_challenge_ai_audit_contract/);
  assert.match(VERIFICATION_SQL, /rpc_replace_formal_quiz_question_ai_audit_contract/);
});

test('approved SQL files are transactional and idempotent', () => {
  const [jobsSql, claimSql, hardeningSql, versionSql, formalSql, badQuestionSql, cacheFkSql, qualitySql, assessmentParentSql, assessmentContextSql, masteryReconciliationSql, enqueueAclSql, assessmentOptionMeaningsSql, quizSessionProgressSql, formalChineseQualitySql, mandatoryAiAuditSql, formalAiAuditSql] = MIGRATION_PATHS.map(filePath => fs.readFileSync(filePath, 'utf8'));

  for (const sql of [jobsSql, claimSql, hardeningSql, versionSql, formalSql, badQuestionSql, cacheFkSql, qualitySql, assessmentParentSql, assessmentContextSql, masteryReconciliationSql, enqueueAclSql, assessmentOptionMeaningsSql, quizSessionProgressSql, formalChineseQualitySql, mandatoryAiAuditSql, formalAiAuditSql]) {
    assert.match(sql, /^\s*begin;/i);
    assert.match(sql, /commit;\s*$/i);
  }

  assert.match(jobsSql, /create table if not exists public\.question_generation_jobs/i);
  assert.match(jobsSql, /alter table public\.question_generation_jobs enable row level security/i);
  assert.match(jobsSql, /create unique index if not exists question_cache_fingerprint_upsert_unique_idx/i);
  assert.match(jobsSql, /drop trigger if exists words_enqueue_question_generation_job/i);
  assert.match(jobsSql, /create trigger words_enqueue_question_generation_job/i);
  assert.match(jobsSql, /create or replace function public\.enqueue_question_generation_job_for_new_word/i);
  assert.match(claimSql, /drop function if exists public\.claim_question_generation_jobs[\s\S]*timestamptz, text, text\[\], text\[\], boolean/i);
  assert.match(hardeningSql, /wordbot_question_generation_revision[\s\S]*20260804/i);
  assert.match(versionSql, /add column if not exists question_generation_version bigint not null default 1/i);
  assert.match(versionSql, /add column if not exists word_version bigint not null default 1/i);
  assert.match(versionSql, /wordbot_question_generation_revision[\s\S]*20260806-versioned-word-edit/i);
  assert.match(versionSql, /add column if not exists lease_token uuid/i);
  assert.match(versionSql, /create or replace function public\.fence_word_question_generation/i);
  assert.match(versionSql, /create or replace function public\.finalize_word_question_generation_edit/i);
  assert.match(versionSql, /notify\s+pgrst\s*,\s*'reload schema'/i);
  assert.match(versionSql, /quiz_challenge_questions[\s\S]*cache_state\s*=\s*'retired'/i);
  assert.match(versionSql, /not exists\s*\([\s\S]*quiz_challenge_questions[\s\S]*cache_question_id\s*=\s*cache\.id/i);
  assert.match(versionSql, /to_regclass\('public\.quiz_challenge_questions'\)/i);
  assert.match(qualitySql, /create or replace function public\.validate_formal_challenge_question_quality\(\)/i);
  assert.match(qualitySql, /drop trigger if exists validate_formal_challenge_question_quality/i);
  assert.match(assessmentParentSql, /add column if not exists parent_review_id text/i);
  assert.match(assessmentParentSql, /create index if not exists assessments_parent_review_idx/i);
  assert.match(assessmentParentSql, /notify\s+pgrst\s*,\s*'reload schema'/i);
  assert.doesNotMatch(assessmentParentSql, /alter table public\.assessments (?:enable|disable|force|no force) row level security/i);
  assert.doesNotMatch(assessmentParentSql, /\b(?:grant|revoke)\b/i);
  assert.match(assessmentContextSql, /add column if not exists context_zh text/i);
  assert.match(assessmentContextSql, /notify\s+pgrst\s*,\s*'reload schema'/i);
  assert.doesNotMatch(assessmentContextSql, /alter table public\.assessments (?:enable|disable|force|no force) row level security/i);
  assert.doesNotMatch(assessmentContextSql, /\b(?:grant|revoke)\b/i);
  assert.match(assessmentOptionMeaningsSql, /add column if not exists option_meanings jsonb not null default '\[\]'::jsonb/i);
  assert.match(assessmentOptionMeaningsSql, /notify\s+pgrst\s*,\s*'reload schema'/i);
  assert.doesNotMatch(assessmentOptionMeaningsSql, /alter table public\.assessments (?:enable|disable|force|no force) row level security/i);
  assert.doesNotMatch(assessmentOptionMeaningsSql, /\b(?:grant|revoke)\b/i);
  assert.match(quizSessionProgressSql, /add column if not exists session_state jsonb not null default '\{\}'::jsonb/i);
  assert.match(quizSessionProgressSql, /add column if not exists updated_at timestamptz not null default now\(\)/i);
  assert.match(quizSessionProgressSql, /security invoker/i);
  assert.match(quizSessionProgressSql, /set search_path = pg_catalog/i);
  assert.match(quizSessionProgressSql, /quiz_sessions_updated_at_trigger/i);
  assert.match(mandatoryAiAuditSql, /create or replace function public\.publish_question_generation_variants/i);
  assert.match(mandatoryAiAuditSql, /lower\(btrim\(variant->>'ai_audit_status'\)\)\s*=\s*'approved'/i);
  assert.match(mandatoryAiAuditSql, /security definer/i);
  assert.match(mandatoryAiAuditSql, /set search_path = public/i);
  assert.match(mandatoryAiAuditSql, /revoke all on function public\.publish_question_generation_variants\(uuid, text, bigint, uuid, jsonb\)/i);
  assert.match(mandatoryAiAuditSql, /grant execute on function public\.publish_question_generation_variants\(uuid, text, bigint, uuid, jsonb\)\s+to service_role/i);
  assert.match(formalAiAuditSql, /create or replace function public\.create_formal_quiz_challenge/i);
  assert.match(formalAiAuditSql, /FORMAL_CHALLENGE_CACHE_AI_AUDIT_REQUIRED/);
  assert.match(formalAiAuditSql, /create or replace function public\.replace_formal_quiz_question/i);
  assert.match(formalAiAuditSql, /FORMAL_REPLACEMENT_CACHE_AI_AUDIT_REQUIRED/);
  assert.match(formalAiAuditSql, /security invoker/i);
  assert.match(formalAiAuditSql, /set search_path = pg_catalog, public/i);
  assert.match(formalAiAuditSql, /revoke all on function public\.create_formal_quiz_challenge\(uuid, text, text, jsonb, timestamptz\)/i);
  assert.match(formalAiAuditSql, /grant execute on function public\.create_formal_quiz_challenge\(uuid, text, text, jsonb, timestamptz\)\s+to service_role/i);
  assert.match(formalAiAuditSql, /revoke all on function public\.replace_formal_quiz_question\(uuid, text, uuid, uuid, text, text, jsonb, timestamptz\)/i);
  assert.match(formalAiAuditSql, /grant execute on function public\.replace_formal_quiz_question\(uuid, text, uuid, uuid, text, text, jsonb, timestamptz\)\s+to service_role/i);
  assert.match(masteryReconciliationSql, /create or replace function public\.reconcile_word_mastery_status/i);
  assert.match(masteryReconciliationSql, /security definer/i);
  assert.match(masteryReconciliationSql, /set search_path = pg_catalog/i);
  assert.match(masteryReconciliationSql, /for update/i);
  assert.match(masteryReconciliationSql, /is distinct from/i);
  assert.match(enqueueAclSql, /revoke all on function public\.enqueue_question_generation_job_if_needed\(uuid, uuid, text\)[\s\S]*service_role/i);
  assert.match(enqueueAclSql, /grant execute on function public\.enqueue_question_generation_job_if_needed\(uuid, uuid, text\)[\s\S]*to service_role/i);
  const rpcSql = `${claimSql}\n${versionSql}\n${formalSql}\n${badQuestionSql}\n${masteryReconciliationSql}\n${formalAiAuditSql}`;
  const compactRpcSql = rpcSql.replace(/\s+/g, '');
  for (const [name, signature] of Object.entries(RPC_SIGNATURES)) {
    const [, signatureWithoutSchema] = signature.split('public.');
    assert.match(rpcSql, new RegExp('create or replace function public\\.' + name + '\\(', 'i'));
    assert.ok(compactRpcSql.includes('revokeallonfunctionpublic.' + signatureWithoutSchema + 'frompublic,anon,authenticated'), name);
    assert.ok(compactRpcSql.includes('grantexecuteonfunctionpublic.' + signatureWithoutSchema + 'toservice_role'), name);
    const securityKeyword = name === 'invalidate_formal_quiz_question' || name === 'replace_formal_quiz_question'
      ? 'security invoker'
      : 'security definer';
    assert.match(rpcSql, new RegExp('function public\\.' + name + '[\\s\\S]*' + securityKeyword, 'i'));
  }});

test('assessment option meanings migration preserves RLS and ACL and defaults existing submissions safely', async () => {
  const migrationPath = path.join(__dirname, '..', 'migrations', '20260816_assessment_option_meanings.sql');
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');
  const db = new PGlite();

  try {
    await db.exec(`
      create role anon;
      create role service_role;
      create table public.assessments (
        id uuid primary key
      );
      alter table public.assessments enable row level security;
      grant select on table public.assessments to anon;
      grant insert, update on table public.assessments to service_role;
      insert into public.assessments (id) values ('00000000-0000-0000-0000-000000000001');
    `);
    const before = await db.query(`
      select relrowsecurity, coalesce(relacl::text, '') as relacl
      from pg_catalog.pg_class
      where oid = 'public.assessments'::regclass
    `);

    await db.exec(migrationSql);
    await db.exec(migrationSql);

    const column = await db.query(`
      select format_type(attribute.atttypid, attribute.atttypmod) as type,
             attribute.attnotnull,
             pg_get_expr(default_meta.adbin, default_meta.adrelid) as default_expr
      from pg_catalog.pg_attribute as attribute
      left join pg_catalog.pg_attrdef as default_meta
        on default_meta.adrelid = attribute.attrelid
       and default_meta.adnum = attribute.attnum
      where attrelid = 'public.assessments'::regclass
        and attname = 'option_meanings'
        and not attisdropped
    `);
    assert.equal(column.rows[0].type, 'jsonb');
    assert.equal(column.rows[0].attnotnull, true);
    assert.match(column.rows[0].default_expr, /'\[\]'::jsonb/i);

    const existing = await db.query(`select option_meanings from public.assessments`);
    assert.deepEqual(existing.rows, [{ option_meanings: [] }]);

    const after = await db.query(`
      select relrowsecurity, coalesce(relacl::text, '') as relacl
      from pg_catalog.pg_class
      where oid = 'public.assessments'::regclass
    `);
    assert.deepEqual(after.rows, before.rows);

    const verification = await db.query(VERIFICATION_SQL);
    assert.equal(verification.rows[0].assessment_option_meanings_column, true);
  } finally {
    await db.close();
  }
});

test('manual schema defines assessment option meanings for fresh databases', () => {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'manual-ddl.sql'), 'utf8');
  const assessments = schema.match(/create table public\.assessments \(([\s\S]*?)\n\);/i);
  assert.ok(assessments);
  assert.match(assessments[1], /option_meanings jsonb not null default '\[\]'::jsonb/i);
});

test('root prestart runs only the fixed migration runner before the original server command', () => {
  const rootPackage = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8')
  );

  assert.equal(rootPackage.scripts.prestart, 'node backend/scripts/apply-question-generation-migrations.js');
  assert.equal(rootPackage.scripts.start, 'node backend/server.js');
});

test('assessment parent review migration preserves RLS and ACL while adding the nullable text column and partial index', async () => {
  const migrationPath = path.join(__dirname, '..', 'migrations', '20260814_assessment_parent_review_id.sql');
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');
  const db = new PGlite();

  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create table public.assessments (
        id uuid primary key,
        user_id uuid not null,
        review_status text
      );
      alter table public.assessments enable row level security;
      grant select on table public.assessments to anon;
      grant insert, update on table public.assessments to service_role;
    `);
    const before = await db.query(`
      select relrowsecurity, coalesce(relacl::text, '') as relacl
      from pg_catalog.pg_class
      where oid = 'public.assessments'::regclass
    `);

    await db.exec(migrationSql);
    await db.exec(migrationSql);

    const column = await db.query(`
      select format_type(atttypid, atttypmod) as type, attnotnull
      from pg_catalog.pg_attribute
      where attrelid = 'public.assessments'::regclass
        and attname = 'parent_review_id'
        and not attisdropped
    `);
    assert.deepEqual(column.rows, [{ type: 'text', attnotnull: false }]);

    const indexes = await db.query(`
      select pg_get_indexdef(index_meta.indexrelid) as definition,
             pg_get_expr(index_meta.indpred, index_meta.indrelid) as predicate
      from pg_catalog.pg_index index_meta
      join pg_catalog.pg_class index_class on index_class.oid = index_meta.indexrelid
      where index_class.relname = 'assessments_parent_review_idx'
    `);
    assert.equal(indexes.rows.length, 1);
    assert.match(indexes.rows[0].definition, /\(user_id, parent_review_id, review_status\)/i);
    assert.match(indexes.rows[0].predicate, /parent_review_id IS NOT NULL/i);

    const after = await db.query(`
      select relrowsecurity, coalesce(relacl::text, '') as relacl
      from pg_catalog.pg_class
      where oid = 'public.assessments'::regclass
    `);
    assert.deepEqual(after.rows, before.rows);

    const verification = await db.query(VERIFICATION_SQL);
    assert.deepEqual({
      assessments_table: verification.rows[0].assessments_table,
      assessments_rls_enabled: verification.rows[0].assessments_rls_enabled,
      assessment_parent_review_id_column: verification.rows[0].assessment_parent_review_id_column,
      assessment_parent_review_index: verification.rows[0].assessment_parent_review_index,
    }, {
      assessments_table: true,
      assessments_rls_enabled: true,
      assessment_parent_review_id_column: true,
      assessment_parent_review_index: true,
    });
  } finally {
    await db.close();
  }
});

test('assessment parent review migration accepts an existing compatible column and index', async () => {
  const migrationPath = path.join(__dirname, '..', 'migrations', '20260814_assessment_parent_review_id.sql');
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');
  const db = new PGlite();

  try {
    await db.exec(`
      create table public.assessments (
        id uuid primary key,
        user_id uuid not null,
        parent_review_id text,
        review_status text
      );
      create index assessments_parent_review_idx
        on public.assessments (user_id, parent_review_id, review_status)
        where parent_review_id is not null;
    `);
    await db.exec(migrationSql);
    await db.exec(migrationSql);

    const result = await db.query(`
      select count(*)::integer as count
      from pg_catalog.pg_class
      where relname = 'assessments_parent_review_idx'
    `);
    assert.deepEqual(result.rows, [{ count: 1 }]);
  } finally {
    await db.close();
  }
});

test('the real runner exits nonzero without DATABASE_URL and does not start the server', () => {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  const result = spawnSync(
    process.execPath,
    [path.resolve(__dirname, '..', 'scripts', 'apply-question-generation-migrations.js')],
    {
      cwd: path.resolve(__dirname, '..', '..'),
      env,
      encoding: 'utf8',
    }
  );

  assert.equal(result.error, undefined, result.error?.message);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DATABASE_URL is required/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /server.*listen/i);
});
