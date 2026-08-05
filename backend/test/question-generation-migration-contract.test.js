'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '20260803_question_generation_jobs.sql'),
    'utf8'
);
const claimMigration = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '20260803_question_generation_claim_rpc.sql'),
    'utf8'
);

function functionBody(name) {
    const match = claimMigration.match(new RegExp(
        `create or replace function public\\.${name}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`,
        'i'
    ));
    assert.ok(match, `${name} must be defined`);
    return match[1];
}

test('question cache upsert conflict columns have a matching non-partial unique index', () => {
    assert.match(
        migration,
        /create unique index if not exists question_cache_fingerprint_upsert_unique_idx\s+on public\.question_cache \(user_id, word_id, question_fingerprint\);/i
    );
});
test('claim, renew, publish, complete, and fail authorize leases with the database clock only', () => {
    for (const name of [
        'claim_question_generation_jobs',
        'renew_question_generation_job',
        'publish_question_generation_variants',
        'complete_question_generation_job',
        'fail_question_generation_job',
    ]) {
        assert.match(functionBody(name), /clock_timestamp\s*\(\s*\)/i, `${name} must use clock_timestamp()`);
    }
    assert.doesNotMatch(claimMigration, /p_(?:due|expired)_before|p_lease_expires_at|p_lease_valid_after/i);
    assert.match(claimMigration, /p_lease_duration_ms\s+bigint/i);
});

test('all lease, publish, and conditional enqueue RPCs are security definer and service-role only', () => {
    for (const name of [
        'claim_question_generation_jobs',
        'renew_question_generation_job',
        'publish_question_generation_variants',
        'complete_question_generation_job',
        'fail_question_generation_job',
        'enqueue_question_generation_job_if_needed',
    ]) {
        const definition = claimMigration.match(new RegExp(
            `create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`,
            'i'
        ))?.[0] || '';
        assert.match(definition, /security definer/i, `${name} must be SECURITY DEFINER`);
        assert.match(claimMigration, new RegExp(`revoke all on function public\\.${name}\\(`, 'i'));
        assert.match(claimMigration, new RegExp(`grant execute on function public\\.${name}\\(`, 'i'));
    }
});

test('publish RPC locks and validates the lease before atomically publishing two distinct variants and retiring old ones', () => {
    const body = functionBody('publish_question_generation_variants');
    const lockIndex = body.search(/for update/i);
    const leaseIndex = body.search(/lease_owner[\s\S]*status[\s\S]*lease_expires_at\s*>\s*v_now/i);
    const insertIndex = body.search(/insert into public\.question_cache/i);
    assert.ok(lockIndex >= 0 && leaseIndex > lockIndex && insertIndex > leaseIndex);
    assert.match(body, /jsonb_array_length\s*\(\s*p_variants\s*\)\s*<>\s*2/i);
    assert.match(body, /count\s*\(\s*distinct[\s\S]*question_fingerprint/i);
    assert.match(body, /count\s*\(\s*distinct[\s\S]*question_text/i);
    assert.match(body, /on conflict\s*\(\s*user_id\s*,\s*word_id\s*,\s*question_fingerprint\s*\)\s*do update/i);
    assert.match(body, /update public\.question_cache[\s\S]*cache_state\s*=\s*'retired'/i);
});

test('publish authorization is NULL-safe and owns reserved availability metadata', () => {
    const body = functionBody('publish_question_generation_variants');
    assert.match(body, /coalesce\s*\(\s*btrim\s*\(\s*p_worker_id\s*\)\s*,\s*''\s*\)\s*=\s*''/i);
    assert.match(body, /v_job\.lease_owner\s+is\s+null/i);
    assert.match(body, /lease_owner\s+is\s+distinct\s+from\s+p_worker_id/i);
    assert.match(body, /case\s+when\s+ordinal\s*=\s*1\s+then\s+null[\s\S]*v_now\s*\+\s*interval\s+'18 hours'/i);
    assert.doesNotMatch(body, /variant->>'available_from'/i);
    assert.match(body, /jsonb_array_length\s*\(\s*variant->'options'\s*\)\s*=\s*4/i);
    assert.match(body, /jsonb_array_length\s*\(\s*variant->'option_meanings'\s*\)\s*=\s*4/i);
    assert.match(body, /variant->>'question_type'\s*\)\s*=\s*'1'/i);
});

test('conditional enqueue applies the same minimum cache quality and active-state gates as formal readiness', () => {
    const body = functionBody('enqueue_question_generation_job_if_needed');
    assert.match(body, /cache_state\s+in\s*\(\s*'active'\s*,\s*'reserved_next_day'\s*\)/i);
    assert.match(body, /question_type\s*=\s*'1'/i);
    assert.match(body, /jsonb_array_length\s*\(\s*options\s*\)\s*=\s*4/i);
    assert.match(body, /jsonb_array_length\s*\(\s*option_meanings\s*\)\s*=\s*4/i);
    assert.match(body, /answer\s+in\s*\(\s*'A'\s*,\s*'B'\s*,\s*'C'\s*,\s*'D'\s*\)/i);
    assert.match(body, /btrim\s*\(\s*correct_meaning\s*\)\s*<>\s*''/i);
    assert.match(body, /jsonb_array_elements_text\s*\(\s*options\s*\)/i);
    assert.match(body, /jsonb_array_elements_text\s*\(\s*option_meanings\s*\)/i);
});

test('both migrations notify PostgREST to reload its schema cache', () => {
    assert.match(migration, /notify\s+pgrst\s*,\s*'reload schema'/i);
    assert.match(claimMigration, /notify\s+pgrst\s*,\s*'reload schema'/i);
});
test('conditional enqueue RPC locks and rechecks ownership, mastery, cache readiness, and recoverable job state', () => {
    const body = functionBody('enqueue_question_generation_job_if_needed');
    const lockIndex = body.search(/from public\.words[\s\S]*for update/i);
    const insertIndex = body.search(/insert into public\.question_generation_jobs/i);
    assert.ok(lockIndex >= 0 && insertIndex > lockIndex);
    assert.match(body, /user_id\s*=\s*p_user_id/i);
    assert.match(body, /mastery_status\s*=\s*'mastered'[\s\S]*p_reason[\s\S]*(?:<>|!=)\s*'cache_backfill'/i);
    assert.match(body, /count\s*\(\s*distinct\s+question_fingerprint\s*\)[\s\S]*<\s*2/i);
    assert.match(body, /round_type\s*=\s*'primary'/i);
    assert.match(body, /quality_status\s*=\s*'ready'/i);
    assert.match(body, /question_fingerprint\s+is not null/i);
    assert.match(body, /return\s+(?:true|v_applied)/i);
    assert.match(body, /on conflict\s*\(\s*word_id\s*\)\s*do update/i);
    assert.match(body, /status\s*=\s*'pending'/i);
    assert.match(body, /question_generation_jobs\.status\s+in\s*\(\s*'ready'\s*,\s*'needs_manual_review'\s*\)/i);
    assert.match(body, /v_word\.word[\s\S]*genaine/i);
});

test('new-word enqueue trigger rejects invalid English words and known bad spellings', () => {
    assert.match(migration, /new\.word[\s\S]*genaine/i);
    assert.match(migration, /\^\[a-z\][\s\S]*\$/i);
});


test('job tables and claim RPC remain service-role only', () => {
    assert.ok(migration.includes('alter table public.question_generation_jobs enable row level security;'));
    assert.ok(migration.includes('revoke all on table public.question_generation_jobs from anon, authenticated;'));
    assert.ok(migration.includes('grant select, insert, update, delete on table public.question_generation_jobs to service_role;'));
    assert.ok(migration.includes('function public.enqueue_question_generation_job_for_new_word()'));
    assert.ok(migration.includes('after insert on public.words'));
    assert.ok(migration.includes("on conflict (word_id) do nothing"));
});

test('cache backfill cannot be vetoed by the RPC approximate readiness check', () => {
    const body = functionBody('enqueue_question_generation_job_if_needed');
    assert.match(body, /if\s+coalesce\s*\(\s*nullif\s*\(\s*p_reason[\s\S]*cache_backfill[\s\S]*or\s+v_ready_fingerprints\s*<\s*2/i);
});

test('claim quarantines or excludes historical jobs for invalid words', () => {
    const body = functionBody('claim_question_generation_jobs');
    assert.match(body, /join\s+public\.words\s+as\s+word[\s\S]*word\.id\s*=\s*job\.word_id/i);
    assert.match(body, /word\.word[\s\S]*genaine/i);
    assert.match(claimMigration, /update\s+public\.question_generation_jobs[\s\S]*needs_manual_review[\s\S]*invalid_word/i);
});
