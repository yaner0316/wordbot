'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    MIGRATION_PATHS,
    VERIFICATION_SQL,
} = require('../scripts/apply-question-generation-migrations');

const migrationPath = path.join(
    __dirname,
    '..',
    'migrations',
    '20260806_word_edit_generation_version.sql'
);
const migration = fs.readFileSync(migrationPath, 'utf8');

function functionBody(name) {
    const match = migration.match(new RegExp(
        `create or replace function public\\.${name}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`,
        'i'
    ));
    assert.ok(match, `${name} must be defined by the version migration`);
    return match[1];
}

test('fixed migration runner verifies the version columns, revision, and edit RPC ACLs', () => {
    assert.ok(MIGRATION_PATHS.some(filePath => path.basename(filePath) === '20260806_word_edit_generation_version.sql'));
    assert.match(VERIFICATION_SQL, /question_generation_version/i);
    assert.match(VERIFICATION_SQL, /word_version/i);
    assert.match(VERIFICATION_SQL, /20260806-versioned-word-edit/i);
    assert.match(VERIFICATION_SQL, /lease_token/i);
    assert.match(VERIFICATION_SQL, /fence_word_question_generation/i);
    assert.match(VERIFICATION_SQL, /finalize_word_question_generation_edit/i);
    assert.match(VERIFICATION_SQL, /rpc_fence_word_question_generation_service_role_execute/i);
    assert.match(VERIFICATION_SQL, /rpc_finalize_word_question_generation_edit_service_role_execute/i);
});

test('fence locks the exact owned word before incrementing its version and upserting an unclaimable job', () => {
    const body = functionBody('fence_word_question_generation');
    const lockIndex = body.search(/from public\.words[\s\S]*for update/i);
    const versionIndex = body.search(/question_generation_version[\s\S]*\+\s*1/i);
    const jobIndex = body.search(/insert into public\.question_generation_jobs/i);
    const cacheIndex = body.search(/delete from public\.question_cache/i);
    assert.ok(lockIndex >= 0 && versionIndex > lockIndex && jobIndex > versionIndex && cacheIndex > jobIndex);
    assert.match(body, /word_id\s*=\s*p_word_id/i);
    assert.match(body, /user_id\s*=\s*p_user_id/i);
    assert.match(body, /word_version[\s\S]*v_version/i);
    assert.match(body, /9999-12-31/i);
    assert.match(body, /on conflict\s*\(\s*word_id\s*\)\s*do update/i);
    assert.match(body, /lease_owner\s*=\s*null/i);
});

test('enqueue, claim, lease transitions, and publish all require the current word version', () => {
    const enqueue = functionBody('enqueue_question_generation_job_if_needed');
    assert.match(enqueue, /for update/i);
    assert.match(enqueue, /word_version[\s\S]*question_generation_version/i);
    assert.match(enqueue, /question_generation_jobs\.word_version\s*<>\s*excluded\.word_version/i);

    for (const name of [
        'claim_question_generation_jobs',
        'renew_question_generation_job',
        'publish_question_generation_variants',
        'complete_question_generation_job',
        'fail_question_generation_job',
    ]) {
        assert.match(
            functionBody(name),
            /question_generation_version\s*=\s*(?:job|v_job)\.word_version|(?:job|v_job)\.word_version\s+is distinct from\s+v_word\.question_generation_version/i,
            `${name} must compare the job and word versions`
        );
    }
});


test('claim creates a new lease token and every lease transition accepts it with the expected word version', () => {
    const claim = functionBody('claim_question_generation_jobs');
    assert.match(claim, /lease_token\s*=\s*gen_random_uuid\(\)/i);
    for (const name of [
        'renew_question_generation_job',
        'publish_question_generation_variants',
        'complete_question_generation_job',
        'fail_question_generation_job',
    ]) {
        const body = functionBody(name);
        assert.match(migration, new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?p_expected_word_version\\s+bigint`, 'i'), name);
        assert.match(migration, new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?p_lease_token\\s+uuid`, 'i'), name);
        assert.match(body, /lease_token\s*(?:=|is distinct from)\s*p_lease_token/i, name);
    }
});
test('publish uses word-then-job lock order and rejects mastered or invalid words before cache writes', () => {
    const body = functionBody('publish_question_generation_variants');
    const wordLockIndex = body.search(/select word\.\*[\s\S]*?from public\.words[\s\S]*?for update/i);
    const jobLockIndex = body.search(/select job\.\*[\s\S]*?from public\.question_generation_jobs[\s\S]*?for update/i);
    const cacheWriteIndex = body.search(/insert into public\.question_cache/i);
    assert.ok(wordLockIndex >= 0 && jobLockIndex > wordLockIndex && cacheWriteIndex > jobLockIndex);
    assert.match(body, /v_word\.mastery_status\s*=\s*'mastered'/i);
    assert.match(body, /v_word\.word[\s\S]*genaine/i);
});

test('finalize atomically removes cache and job for mastered or invalid words', () => {
    const body = functionBody('finalize_word_question_generation_edit');
    assert.match(body, /from public\.words[\s\S]*for update/i);
    assert.match(body, /mastery_status\s*=\s*'mastered'/i);
    assert.match(body, /delete from public\.question_cache/i);
    assert.match(body, /delete from public\.question_generation_jobs/i);
    assert.match(body, /word_version[\s\S]*question_generation_version/i);
});

test('all new public functions preserve the service-role-only execution boundary', () => {
    const compact = migration.replace(/\s+/g, '');
    for (const signature of [
        'fence_word_question_generation(uuid,uuid)',
        'finalize_word_question_generation_edit(uuid,uuid)',
    ]) {
        const name = signature.slice(0, signature.indexOf('('));
        assert.match(migration, new RegExp(`function public\\.${name}\\([\\s\\S]*?security definer`, 'i'));
        assert.ok(compact.includes(`revokeallonfunctionpublic.${signature}frompublic,anon,authenticated`));
        assert.ok(compact.includes(`grantexecuteonfunctionpublic.${signature}toservice_role`));
    }
});
