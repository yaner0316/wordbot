'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationName = '20260910_question_generation_checkpoints.sql';
const sql = fs.readFileSync(path.resolve(__dirname, '..', 'migrations', migrationName), 'utf8');

test('checkpoint migration adds durable JSON state and an owned-lease save RPC', () => {
    assert.match(sql, /add column if not exists generation_checkpoint jsonb/i);
    assert.match(sql, /create or replace function public\.save_question_generation_checkpoint/i);
    assert.match(sql, /job\.lease_owner\s*=\s*p_worker_id/i);
    assert.match(sql, /job\.word_version\s*=\s*p_expected_word_version/i);
    assert.match(sql, /job\.lease_token\s*=\s*p_lease_token/i);
    assert.match(sql, /job\.lease_expires_at\s*>\s*v_now/i);
    assert.match(sql, /generation_checkpoint\s*=\s*coalesce\(p_checkpoint/i);
});

test('checkpoint RPC is service-role only and completion clears durable progress', () => {
    assert.match(sql, /revoke all on function public\.save_question_generation_checkpoint[\s\S]*from public, anon, authenticated/i);
    assert.match(sql, /grant execute on function public\.save_question_generation_checkpoint[\s\S]*to service_role/i);
    assert.match(sql, /create or replace function public\.complete_question_generation_job/i);
    assert.match(sql, /generation_checkpoint\s*=\s*'\{\}'::jsonb/i);
    assert.match(sql, /word\.mastery_status is distinct from 'mastered'/i);
});

test('latest claim contract includes null mastery status as a coverage target', () => {
    assert.match(sql, /create or replace function public\.claim_question_generation_jobs/i);
    assert.match(sql, /word\.mastery_status is distinct from 'mastered'/i);
    assert.doesNotMatch(sql, /word\.mastery_status\s*<>\s*'mastered'/i);
    assert.match(sql, /user_job_rank/i);
});
