'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { Client } = require('pg');

const VERIFICATION_SQL = `
/* question-generation-migration-state */
with claim_proc as (
  select to_regprocedure('public.claim_question_generation_jobs(text,integer,bigint)')::oid as oid
), old_claim_proc as (
  select to_regprocedure('public.claim_question_generation_jobs(text,integer,timestamptz,timestamptz,timestamptz,text,text[],text[],boolean)')::oid as oid
), rpc_specs(name, signature) as (
  values
    ('claim_question_generation_jobs', 'public.claim_question_generation_jobs(text,integer,bigint)'),
    ('renew_question_generation_job', 'public.renew_question_generation_job(uuid,text,bigint)'),
    ('publish_question_generation_variants', 'public.publish_question_generation_variants(uuid,text,jsonb)'),
    ('complete_question_generation_job', 'public.complete_question_generation_job(uuid,text)'),
    ('fail_question_generation_job', 'public.fail_question_generation_job(uuid,text,integer,bigint,bigint,text,text,jsonb)'),
    ('enqueue_question_generation_job_if_needed', 'public.enqueue_question_generation_job_if_needed(uuid,uuid,text)')
), rpc_proc as (
  select spec.name, spec.signature, to_regprocedure(spec.signature)::oid as oid
  from rpc_specs as spec
), rpc_state as (
  select
    rpc.name,
    rpc.oid is not null as signature,
    coalesce(proc.prosecdef, false) as security_definer,
    coalesce(bool_or(acl.grantee = 0 and acl.privilege_type = 'EXECUTE'), false) as public_execute,
    coalesce(bool_or(role.rolname = 'anon' and acl.privilege_type = 'EXECUTE'), false) as anon_execute,
    coalesce(bool_or(role.rolname = 'authenticated' and acl.privilege_type = 'EXECUTE'), false) as authenticated_execute,
    coalesce(bool_or(role.rolname = 'service_role' and acl.privilege_type = 'EXECUTE'), false) as service_role_execute
  from rpc_proc as rpc
  left join pg_catalog.pg_proc as proc on proc.oid = rpc.oid
  left join lateral aclexplode(
    case when proc.oid is null then null::aclitem[]
         else coalesce(proc.proacl, acldefault('f', proc.proowner))
    end
  ) as acl on true
  left join pg_catalog.pg_roles as role on role.oid = acl.grantee
  group by rpc.name, rpc.oid, proc.prosecdef
)
select
  to_regclass('public.question_generation_jobs') is not null as jobs_table,
  coalesce((
    select cls.relrowsecurity
    from pg_catalog.pg_class as cls
    join pg_catalog.pg_namespace as namespace on namespace.oid = cls.relnamespace
    where namespace.nspname = 'public' and cls.relname = 'question_generation_jobs'
  ), false) as jobs_rls_enabled,
  exists (
    select 1
    from pg_catalog.pg_trigger as trigger
    where trigger.tgrelid = to_regclass('public.words')
      and trigger.tgname = 'words_enqueue_question_generation_job'
      and not trigger.tgisinternal
      and trigger.tgenabled <> 'D'
  ) as enqueue_trigger,
  exists (
    select 1
    from pg_catalog.pg_class as index_class
    join pg_catalog.pg_namespace as namespace on namespace.oid = index_class.relnamespace
    join pg_catalog.pg_index as index_meta on index_meta.indexrelid = index_class.oid
    where namespace.nspname = 'public'
      and index_class.relname = 'question_cache_fingerprint_upsert_unique_idx'
      and index_meta.indisunique
      and index_meta.indpred is null
      and pg_get_indexdef(index_meta.indexrelid) like '%(user_id, word_id, question_fingerprint)%'
  ) as fingerprint_unique_index,
  exists (
    select 1
    from pg_catalog.pg_proc as revision_proc
    join pg_catalog.pg_namespace as revision_namespace
      on revision_namespace.oid = revision_proc.pronamespace
    where revision_namespace.nspname = 'public'
      and revision_proc.proname = 'wordbot_question_generation_revision'
      and revision_proc.prosrc like '%20260804%'
  ) as backfill_hardening_revision,
  (select oid is not null from claim_proc) as claim_function,
  false as claim_public_execute,
  false as claim_anon_execute,
  false as claim_authenticated_execute,
  false as claim_service_role_execute,
  (select signature from rpc_state where name = 'claim_question_generation_jobs') as rpc_claim_question_generation_jobs_signature,
  (select security_definer from rpc_state where name = 'claim_question_generation_jobs') as rpc_claim_question_generation_jobs_security_definer,
  (select public_execute from rpc_state where name = 'claim_question_generation_jobs') as rpc_claim_question_generation_jobs_public_execute,
  (select anon_execute from rpc_state where name = 'claim_question_generation_jobs') as rpc_claim_question_generation_jobs_anon_execute,
  (select authenticated_execute from rpc_state where name = 'claim_question_generation_jobs') as rpc_claim_question_generation_jobs_authenticated_execute,
  (select service_role_execute from rpc_state where name = 'claim_question_generation_jobs') as rpc_claim_question_generation_jobs_service_role_execute,
  (select signature from rpc_state where name = 'renew_question_generation_job') as rpc_renew_question_generation_job_signature,
  (select security_definer from rpc_state where name = 'renew_question_generation_job') as rpc_renew_question_generation_job_security_definer,
  (select public_execute from rpc_state where name = 'renew_question_generation_job') as rpc_renew_question_generation_job_public_execute,
  (select anon_execute from rpc_state where name = 'renew_question_generation_job') as rpc_renew_question_generation_job_anon_execute,
  (select authenticated_execute from rpc_state where name = 'renew_question_generation_job') as rpc_renew_question_generation_job_authenticated_execute,
  (select service_role_execute from rpc_state where name = 'renew_question_generation_job') as rpc_renew_question_generation_job_service_role_execute,
  (select signature from rpc_state where name = 'publish_question_generation_variants') as rpc_publish_question_generation_variants_signature,
  (select security_definer from rpc_state where name = 'publish_question_generation_variants') as rpc_publish_question_generation_variants_security_definer,
  (select public_execute from rpc_state where name = 'publish_question_generation_variants') as rpc_publish_question_generation_variants_public_execute,
  (select anon_execute from rpc_state where name = 'publish_question_generation_variants') as rpc_publish_question_generation_variants_anon_execute,
  (select authenticated_execute from rpc_state where name = 'publish_question_generation_variants') as rpc_publish_question_generation_variants_authenticated_execute,
  (select service_role_execute from rpc_state where name = 'publish_question_generation_variants') as rpc_publish_question_generation_variants_service_role_execute,
  (select signature from rpc_state where name = 'complete_question_generation_job') as rpc_complete_question_generation_job_signature,
  (select security_definer from rpc_state where name = 'complete_question_generation_job') as rpc_complete_question_generation_job_security_definer,
  (select public_execute from rpc_state where name = 'complete_question_generation_job') as rpc_complete_question_generation_job_public_execute,
  (select anon_execute from rpc_state where name = 'complete_question_generation_job') as rpc_complete_question_generation_job_anon_execute,
  (select authenticated_execute from rpc_state where name = 'complete_question_generation_job') as rpc_complete_question_generation_job_authenticated_execute,
  (select service_role_execute from rpc_state where name = 'complete_question_generation_job') as rpc_complete_question_generation_job_service_role_execute,
  (select signature from rpc_state where name = 'fail_question_generation_job') as rpc_fail_question_generation_job_signature,
  (select security_definer from rpc_state where name = 'fail_question_generation_job') as rpc_fail_question_generation_job_security_definer,
  (select public_execute from rpc_state where name = 'fail_question_generation_job') as rpc_fail_question_generation_job_public_execute,
  (select anon_execute from rpc_state where name = 'fail_question_generation_job') as rpc_fail_question_generation_job_anon_execute,
  (select authenticated_execute from rpc_state where name = 'fail_question_generation_job') as rpc_fail_question_generation_job_authenticated_execute,
  (select service_role_execute from rpc_state where name = 'fail_question_generation_job') as rpc_fail_question_generation_job_service_role_execute,
  (select service_role_execute from rpc_state where name = 'enqueue_question_generation_job_if_needed') as rpc_enqueue_question_generation_job_if_needed_service_role_execute,
  (select signature from rpc_state where name = 'enqueue_question_generation_job_if_needed') as rpc_enqueue_question_generation_job_if_needed_signature,
  (select security_definer from rpc_state where name = 'enqueue_question_generation_job_if_needed') as rpc_enqueue_question_generation_job_if_needed_security_definer,
  (select public_execute from rpc_state where name = 'enqueue_question_generation_job_if_needed') as rpc_enqueue_question_generation_job_if_needed_public_execute,
  (select anon_execute from rpc_state where name = 'enqueue_question_generation_job_if_needed') as rpc_enqueue_question_generation_job_if_needed_anon_execute,
  (select authenticated_execute from rpc_state where name = 'enqueue_question_generation_job_if_needed') as rpc_enqueue_question_generation_job_if_needed_authenticated_execute,
  (select oid is null from old_claim_proc) as rpc_old_claim_signature_absent
`;
const MIGRATION_PATHS = Object.freeze([
  path.resolve(__dirname, '..', 'migrations', '20260803_question_generation_jobs.sql'),
  path.resolve(__dirname, '..', 'migrations', '20260803_question_generation_claim_rpc.sql'),
  path.resolve(__dirname, '..', 'migrations', '20260804_question_generation_backfill_hardening.sql'),
]);

const RPC_EXPECTATION_KEYS = Object.freeze([
  'claim_question_generation_jobs',
  'renew_question_generation_job',
  'publish_question_generation_variants',
  'complete_question_generation_job',
  'fail_question_generation_job',
  'enqueue_question_generation_job_if_needed',
].flatMap(name => [
  `rpc_${name}_signature`,
  `rpc_${name}_security_definer`,
  `rpc_${name}_public_execute`,
  `rpc_${name}_anon_execute`,
  `rpc_${name}_authenticated_execute`,
  `rpc_${name}_service_role_execute`,
]));

const EXPECTED_STATE = Object.freeze({
  jobs_table: true,
  jobs_rls_enabled: true,
  enqueue_trigger: true,
  fingerprint_unique_index: true,
  claim_function: true,
  claim_public_execute: false,
  claim_anon_execute: false,
  claim_authenticated_execute: false,
  claim_service_role_execute: false,
  backfill_hardening_revision: true,
  ...Object.fromEntries(RPC_EXPECTATION_KEYS.map(key => [
    key,
    !key.endsWith('_public_execute') && !key.endsWith('_anon_execute') && !key.endsWith('_authenticated_execute'),
  ])),
  rpc_old_claim_signature_absent: true,
});
function normalizeDatabaseUrl(databaseUrl) {
  try {
    new URL(databaseUrl);
    return databaseUrl;
  } catch {}

  const match = databaseUrl.match(/^((?:postgres(?:ql)?):\/\/)([^:/?#]+):(.+)@([^/]+)(\/.*)$/);
  if (!match) throw new Error('DATABASE_URL is not a valid PostgreSQL connection URL');
  const [, scheme, username, password, host, databasePath] = match;
  const normalized = `${scheme}${username}:${encodeURIComponent(password)}@${host}${databasePath}`;
  new URL(normalized);
  return normalized;
}

function normalizeVerification(row = {}) {
  return Object.fromEntries(
    Object.keys(EXPECTED_STATE).map(key => [key, row[key] === true || row[key] === 't'])
  );
}

function verificationFailures(verification) {
  return Object.entries(EXPECTED_STATE)
    .filter(([key, expected]) => verification[key] !== expected)
    .map(([key]) => key);
}

async function inspectMigrationState(client) {
  await client.query('BEGIN READ ONLY');
  try {
    const result = await client.query(VERIFICATION_SQL);
    await client.query('COMMIT');
    return normalizeVerification(result.rows[0]);
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    throw error;
  }
}

async function applyQuestionGenerationMigrations({
  env = process.env,
  Client: DatabaseClient = Client,
  readFile = fs.readFile,
} = {}) {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for question-generation migrations');
  }

  const client = new DatabaseClient({
    connectionString: normalizeDatabaseUrl(env.DATABASE_URL),
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    let verification = await inspectMigrationState(client);
    if (verificationFailures(verification).length === 0) {
      return { status: 'already_complete', appliedMigrations: [], verification };
    }

    const appliedMigrations = [];
    for (const migrationPath of MIGRATION_PATHS) {
      const sql = await readFile(migrationPath, 'utf8');
      if (!String(sql).trim()) throw new Error(`Migration file is empty: ${path.basename(migrationPath)}`);
      await client.query(sql);
      appliedMigrations.push(path.basename(migrationPath));
    }

    verification = await inspectMigrationState(client);
    const failures = verificationFailures(verification);
    if (failures.length > 0) {
      throw new Error(`Question-generation migration verification failed: ${failures.join(', ')}`);
    }

    return { status: 'applied', appliedMigrations, verification };
  } finally {
    await client.end();
  }
}

function publicFailureMessage(error) {
  const message = String(error?.message || '');
  const safePrefixes = [
    'DATABASE_URL is required',
    'DATABASE_URL is not a valid PostgreSQL connection URL',
    'Question-generation migration verification failed',
    'Migration file is empty',
  ];
  if (safePrefixes.some(prefix => message.startsWith(prefix))) return message;
  const code = typeof error?.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code)
    ? ` (${error.code})`
    : '';
  return `Database migration failed${code}`;
}

async function main() {
  const result = await applyQuestionGenerationMigrations();
  console.log(JSON.stringify({
    component: 'question-generation-migrations',
    ...result,
  }));
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[question-generation-migrations] ${publicFailureMessage(error)}`);
    process.exitCode = 1;
  });
}
module.exports = {
  MIGRATION_PATHS,
  VERIFICATION_SQL,
  applyQuestionGenerationMigrations,
  normalizeDatabaseUrl,
};
