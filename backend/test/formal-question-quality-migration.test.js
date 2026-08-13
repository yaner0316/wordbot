const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { VERIFICATION_SQL } = require('../scripts/apply-question-generation-migrations');

const file = path.join(__dirname, '..', 'migrations', '20260811_formal_question_quality_gate.sql');
const sql = fs.readFileSync(file, 'utf8');

test('formal question quality migration installs a fail-closed write trigger', () => {
  assert.match(sql, /^\s*begin;/i);
  assert.match(sql, /question_fingerprint/);
  assert.match(sql, /duplicate_option_meanings/);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /set search_path = pg_catalog/i);
  assert.match(sql, /revoke all on function public\.validate_formal_challenge_question_quality\(\)\s+from public, anon, authenticated, service_role/i);
  assert.match(sql, /drop trigger if exists validate_formal_challenge_question_quality/i);
  assert.match(sql, /create trigger validate_formal_challenge_question_quality/i);
  assert.match(sql, /commit;\s*$/i);
});

test('formal question quality migration is idempotent and rejects invalid snapshots', async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.quiz_challenge_questions (
      id uuid primary key,
      question_fingerprint text,
      question_snapshot jsonb not null
    );
  `);

  try {
    await db.exec(sql);
    await db.exec(sql);

    await db.exec('grant insert on table public.quiz_challenge_questions to service_role');
    await db.exec('set role service_role');
    await db.query(`
      insert into public.quiz_challenge_questions (id, question_fingerprint, question_snapshot)
      values ('00000000-0000-0000-0000-000000000001', 'valid-fingerprint',
        '{"optionMeanings":["垫子","枕头","支架","靠背"]}'::jsonb)
    `);
    await db.exec('reset role');

    await assert.rejects(
      db.query(`
        insert into public.quiz_challenge_questions (id, question_fingerprint, question_snapshot)
        values ('00000000-0000-0000-0000-000000000002', '',
          '{"optionMeanings":["甲","乙","丙","丁"]}'::jsonb)
      `),
      /FORMAL_QUIZ_QUALITY_REQUIRED: question_fingerprint/
    );
    await assert.rejects(
      db.query(`
        insert into public.quiz_challenge_questions (id, question_fingerprint, question_snapshot)
        values ('00000000-0000-0000-0000-000000000003', 'short-options',
          '{"optionMeanings":["甲","乙","丙"]}'::jsonb)
      `),
      /FORMAL_QUIZ_QUALITY_REQUIRED: option_meanings/
    );
    await assert.rejects(
      db.query(`
        insert into public.quiz_challenge_questions (id, question_fingerprint, question_snapshot)
        values ('00000000-0000-0000-0000-000000000004', 'duplicate-options',
          '{"optionMeanings":[" 垫子 ","枕头","垫子","靠背"]}'::jsonb)
      `),
      /FORMAL_QUIZ_QUALITY_REQUIRED: duplicate_option_meanings/
    );

    const state = await db.query(`
      select
        not proc.prosecdef as security_invoker,
        proc.proconfig @> array['search_path=pg_catalog'] as safe_search_path,
        not has_function_privilege('public', proc.oid, 'execute') as public_execute_revoked,
        not has_function_privilege('anon', proc.oid, 'execute') as anon_execute_revoked,
        not has_function_privilege('authenticated', proc.oid, 'execute') as authenticated_execute_revoked,
        not has_function_privilege('service_role', proc.oid, 'execute') as service_role_execute_revoked
      from pg_catalog.pg_proc proc
      where proc.oid = to_regprocedure('public.validate_formal_challenge_question_quality()')
    `);
    assert.deepEqual(state.rows, [{
      security_invoker: true,
      safe_search_path: true,
      public_execute_revoked: true,
      anon_execute_revoked: true,
      authenticated_execute_revoked: true,
      service_role_execute_revoked: true,
    }]);

    const verification = await db.query(VERIFICATION_SQL);
    assert.deepEqual({
      formal_quality_function: verification.rows[0].formal_quality_function,
      formal_quality_function_security_invoker: verification.rows[0].formal_quality_function_security_invoker,
      formal_quality_function_safe_search_path: verification.rows[0].formal_quality_function_safe_search_path,
      formal_quality_function_public_execute: verification.rows[0].formal_quality_function_public_execute,
      formal_quality_function_anon_execute: verification.rows[0].formal_quality_function_anon_execute,
      formal_quality_function_authenticated_execute: verification.rows[0].formal_quality_function_authenticated_execute,
      formal_quality_function_service_role_execute: verification.rows[0].formal_quality_function_service_role_execute,
      formal_quality_trigger: verification.rows[0].formal_quality_trigger,
    }, {
      formal_quality_function: true,
      formal_quality_function_security_invoker: true,
      formal_quality_function_safe_search_path: true,
      formal_quality_function_public_execute: false,
      formal_quality_function_anon_execute: false,
      formal_quality_function_authenticated_execute: false,
      formal_quality_function_service_role_execute: false,
      formal_quality_trigger: true,
    });
  } finally {
    await db.close();
  }
});
