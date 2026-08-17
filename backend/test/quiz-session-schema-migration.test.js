'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  MIGRATION_PATHS,
  VERIFICATION_SQL,
} = require('../scripts/apply-question-generation-migrations');

const MIGRATION_NAME = '20260817_quiz_session_progress.sql';

test('startup migration chain owns the complete quiz session progress schema', () => {
  const migrationPath = MIGRATION_PATHS.find(filePath => path.basename(filePath) === MIGRATION_NAME);
  assert.ok(migrationPath, `${MIGRATION_NAME} must run during startup`);

  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /^\s*begin;/i);
  assert.match(sql, /add column if not exists session_state jsonb not null default '\{\}'::jsonb/i);
  assert.match(sql, /add column if not exists updated_at timestamptz not null default now\(\)/i);
  assert.match(sql, /create or replace function public\.touch_quiz_sessions_updated_at\(\)[\s\S]*security invoker[\s\S]*set search_path = pg_catalog/i);
  assert.match(sql, /if not exists[\s\S]*quiz_sessions_updated_at_trigger[\s\S]*create trigger quiz_sessions_updated_at_trigger[\s\S]*before update on public\.quiz_sessions[\s\S]*execute function public\.touch_quiz_sessions_updated_at\(\)/i);
  assert.match(sql, /revoke all on function public\.touch_quiz_sessions_updated_at\(\)\s+from public, anon, authenticated/i);
  assert.match(sql, /notify\s+pgrst\s*,\s*'reload schema'/i);
  assert.match(sql, /commit;\s*$/i);
  assert.doesNotMatch(sql, /\b(?:delete|truncate|drop)\b/i);
});

test('startup verification fails closed on both quiz session columns and the trigger', () => {
  assert.match(VERIFICATION_SQL, /quiz_session_state_column/i);
  assert.match(VERIFICATION_SQL, /quiz_session_updated_at_column/i);
  assert.match(VERIFICATION_SQL, /quiz_session_updated_at_trigger/i);
  assert.match(VERIFICATION_SQL, /proc\.proname\s*=\s*'touch_quiz_sessions_updated_at'/i);
});
