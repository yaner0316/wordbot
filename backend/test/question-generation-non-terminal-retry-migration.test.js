'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { MIGRATION_PATHS } = require('../scripts/apply-question-generation-migrations');

const migrationName = '20260910_question_generation_non_terminal_retry.sql';
const migrationPath = path.resolve(__dirname, '..', 'migrations', migrationName);
const migrationSql = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : '';

test('non-terminal retry migration is part of the ordered migration set', () => {
    assert.equal(MIGRATION_PATHS.map(filePath => path.basename(filePath)).includes(migrationName), true);
});

test('failure RPC keeps every eligible target in retry_wait with capped backoff', () => {
    assert.match(migrationSql, /create or replace function public\.fail_question_generation_job\s*\(/i);
    assert.match(migrationSql, /set search_path = pg_catalog/i);
    assert.match(migrationSql, /set status = 'retry_wait'/i);
    assert.match(migrationSql, /least\([\s\S]*p_max_backoff_ms[\s\S]*p_base_backoff_ms/i);
    assert.doesNotMatch(migrationSql, /needs_manual_review/i);
});

test('failure RPC remains lease guarded and service-role only', () => {
    assert.match(migrationSql, /job\.lease_owner = p_worker_id/i);
    assert.match(migrationSql, /job\.word_version = p_expected_word_version/i);
    assert.match(migrationSql, /job\.lease_token = p_lease_token/i);
    assert.match(migrationSql, /revoke all on function public\.fail_question_generation_job[\s\S]*from public, anon, authenticated/i);
    assert.match(migrationSql, /grant execute on function public\.fail_question_generation_job[\s\S]*to service_role/i);
});
