const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const {
  MIGRATION_PATHS,
  applyQuestionGenerationMigrations,
  normalizeDatabaseUrl,
  VERIFICATION_SQL,
} = require('../scripts/apply-question-generation-migrations');

const RPC_SIGNATURES = Object.freeze({
  claim_question_generation_jobs: 'public.claim_question_generation_jobs(text,integer,bigint)',
  renew_question_generation_job: 'public.renew_question_generation_job(uuid,text,bigint)',
  publish_question_generation_variants: 'public.publish_question_generation_variants(uuid,text,jsonb)',
  complete_question_generation_job: 'public.complete_question_generation_job(uuid,text)',
  fail_question_generation_job: 'public.fail_question_generation_job(uuid,text,integer,bigint,bigint,text,text,jsonb)',
  enqueue_question_generation_job_if_needed: 'public.enqueue_question_generation_job_if_needed(uuid,uuid,text)',
});

const RPC_STATE_KEYS = Object.freeze(
  Object.keys(RPC_SIGNATURES).flatMap(name => [
    `rpc_${name}_signature`,
    `rpc_${name}_security_definer`,
    `rpc_${name}_public_execute`,
    `rpc_${name}_anon_execute`,
    `rpc_${name}_authenticated_execute`,
    `rpc_${name}_service_role_execute`,
  ])
);

test('normalizes a DATABASE_URL whose password contains unencoded reserved characters', () => {
  assert.equal(
    normalizeDatabaseUrl('postgresql://postgres:abc?def!@db.example.com:5432/postgres'),
    'postgresql://postgres:abc%3Fdef!@db.example.com:5432/postgres'
  );
});

test('migration paths are fixed to the two approved SQL files in order', () => {
  assert.deepEqual(
    MIGRATION_PATHS.map(filePath => path.basename(filePath)),
    [
      '20260803_question_generation_jobs.sql',
      '20260803_question_generation_claim_rpc.sql',
    ]
  );
  assert.ok(MIGRATION_PATHS.every(filePath => path.dirname(filePath).endsWith(`${path.sep}migrations`)));
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
  jobs_rls_enabled: true,
  enqueue_trigger: true,
  fingerprint_unique_index: true,
  claim_function: true,
  claim_public_execute: false,
  claim_anon_execute: false,
  claim_authenticated_execute: false,
  claim_service_role_execute: false,
  ...Object.fromEntries(RPC_STATE_KEYS.map(key => [key, key.endsWith('_public_execute') || key.endsWith('_anon_execute') || key.endsWith('_authenticated_execute') ? false : true])),
  rpc_old_claim_signature_absent: true,
});

const INCOMPLETE_STATE = Object.freeze({
  ...COMPLETE_STATE,
  claim_function: false,
  claim_service_role_execute: false,
  rpc_claim_question_generation_jobs_service_role_execute: false,
  rpc_old_claim_signature_absent: false,
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
  assert.equal(result.status, 'applied');
  assert.deepEqual(result.appliedMigrations, MIGRATION_PATHS.map(filePath => path.basename(filePath)));
  assert.deepEqual(result.verification, COMPLETE_STATE);
  assert.doesNotMatch(JSON.stringify(result), /abc|DATABASE_URL|db\.example\.com/);
  assert.equal(harness.instances[0].ended, true);
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
test('verification SQL checks required objects and direct execute ACLs', () => {
  assert.match(VERIFICATION_SQL, /question_generation_jobs/);
  assert.match(VERIFICATION_SQL, /relrowsecurity/);
  assert.match(VERIFICATION_SQL, /words_enqueue_question_generation_job/);
  assert.match(VERIFICATION_SQL, /index_meta\.indisunique/);
  assert.match(VERIFICATION_SQL, /index_meta\.indpred is null/);
  assert.match(VERIFICATION_SQL, /claim_question_generation_jobs/);
  assert.match(VERIFICATION_SQL, /grantee = 0/);
  assert.match(VERIFICATION_SQL, /rolname = 'anon'/);
  assert.match(VERIFICATION_SQL, /rolname = 'authenticated'/);
  assert.match(VERIFICATION_SQL, /rolname = 'service_role'/);
  for (const [name, signature] of Object.entries(RPC_SIGNATURES)) {
    assert.ok(VERIFICATION_SQL.includes(signature), signature);
    assert.match(VERIFICATION_SQL, new RegExp('rpc_' + name + '_security_definer'));
  }
  assert.match(VERIFICATION_SQL, /prosecdef/);
  assert.match(VERIFICATION_SQL, /rpc_old_claim_signature_absent/);
});

test('approved SQL files are transactional and idempotent', () => {
  const [jobsSql, claimSql] = MIGRATION_PATHS.map(filePath => fs.readFileSync(filePath, 'utf8'));

  for (const sql of [jobsSql, claimSql]) {
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
  const compactClaimSql = claimSql.replace(/\s+/g, '');
  for (const [name, signature] of Object.entries(RPC_SIGNATURES)) {
    const [, signatureWithoutSchema] = signature.split('public.');
    assert.match(claimSql, new RegExp('create or replace function public\\.' + name + '\\(', 'i'));
    assert.ok(compactClaimSql.includes('revokeallonfunctionpublic.' + signatureWithoutSchema + 'frompublic,anon,authenticated'), name);
    assert.ok(compactClaimSql.includes('grantexecuteonfunctionpublic.' + signatureWithoutSchema + 'toservice_role'), name);
    assert.match(claimSql, new RegExp('function public\\.' + name + '[\\s\\S]*security definer', 'i'));
  }});

test('root prestart runs only the fixed migration runner before the original server command', () => {
  const rootPackage = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8')
  );

  assert.equal(rootPackage.scripts.prestart, 'node backend/scripts/apply-question-generation-migrations.js');
  assert.equal(rootPackage.scripts.start, 'node backend/server.js');
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

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DATABASE_URL is required/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /server.*listen/i);
});
