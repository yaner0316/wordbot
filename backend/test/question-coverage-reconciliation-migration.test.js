'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { MIGRATION_PATHS } = require('../scripts/apply-question-generation-migrations');

const migrationName = '20260910_question_coverage_reconciliation.sql';
const migrationPath = path.resolve(__dirname, '..', 'migrations', migrationName);
const sql = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : '';

test('coverage reconciliation migration is ordered after non-terminal retry', () => {
    const names = MIGRATION_PATHS.map(filePath => path.basename(filePath));
    assert.ok(names.indexOf(migrationName) > names.indexOf('20260910_question_generation_non_terminal_retry.sql'));
});

test('enqueue RPC checks current user level and current semantic audit policy', () => {
    assert.match(sql, /create or replace function public\.enqueue_question_generation_job_if_needed/i);
    assert.match(sql, /attribute\.attname = 'learning_level'[\s\S]*execute 'select learning_level::text from public\.users where id = \$1'/i);
    assert.match(sql, /cache\.level::text = v_learning_level/i);
    assert.match(sql, /unique-answer-v2/i);
    assert.match(sql, /lower\(btrim\(cache\.ai_audit_status\)\) = 'approved'/i);
});

test('exact coverage planner cannot be vetoed by the RPC approximate pair check', () => {
    assert.match(sql, /coalesce\(nullif\(p_reason, ''\), 'coverage_reconcile'\)\s*<>\s*'coverage_reconcile'[\s\S]*v_ready_fingerprints >= 2/i);
});

test('enqueue RPC revives only stale-version, ready, or legacy terminal jobs', () => {
    assert.match(sql, /question_generation_jobs\.word_version <> excluded\.word_version/i);
    assert.match(sql, /question_generation_jobs\.status in \('ready', 'needs_manual_review'\)/i);
    assert.match(sql, /word\.mastery_status is distinct from 'mastered'/i);
    assert.doesNotMatch(sql, /question_generation_jobs\.status in \('pending', 'generating', 'validating', 'repairing', 'retry_wait'\)/i);
});

test('enqueue RPC confirms a concurrent same-version executable job', () => {
    assert.match(sql, /if v_affected > 0 then[\s\S]*return true[\s\S]*status in \('pending', 'generating', 'validating', 'repairing', 'retry_wait'\)/i);
});

test('enqueue RPC remains service-role only', () => {
    assert.match(sql, /revoke all on function public\.enqueue_question_generation_job_if_needed[\s\S]*from public, anon, authenticated, service_role/i);
    assert.match(sql, /grant execute on function public\.enqueue_question_generation_job_if_needed[\s\S]*to service_role/i);
});
