'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { Client } = require('pg');

const RPC_VERIFICATION_ALIASES = Object.freeze({
  enqueue_question_generation_job_if_needed: 'enqueue_job_if_needed',
  finalize_word_question_generation_edit: 'finalize_word_edit',
});

const VERIFICATION_SQL = `
/* question-generation-migration-state */
with claim_proc as (
  select to_regprocedure('public.claim_question_generation_jobs(text,integer,bigint)')::oid as oid
), old_claim_proc as (
  select to_regprocedure('public.claim_question_generation_jobs(text,integer,timestamptz,timestamptz,timestamptz,text,text[],text[],boolean)')::oid as oid
), formal_quality_proc as (
  select to_regprocedure('public.validate_formal_challenge_question_quality()')::oid as oid
), formal_quality_state as (
  select
    quality.oid is not null as function_exists,
    coalesce(not proc.prosecdef, false) as security_invoker,
    coalesce(proc.proconfig @> array['search_path=pg_catalog'], false) as safe_search_path,
    coalesce(bool_or(acl.grantee = 0 and acl.privilege_type = 'EXECUTE'), false) as public_execute,
    coalesce(bool_or(role.rolname = 'anon' and acl.privilege_type = 'EXECUTE'), false) as anon_execute,
    coalesce(bool_or(role.rolname = 'authenticated' and acl.privilege_type = 'EXECUTE'), false) as authenticated_execute,
    coalesce(bool_or(role.rolname = 'service_role' and acl.privilege_type = 'EXECUTE'), false) as service_role_execute
  from formal_quality_proc as quality
  left join pg_catalog.pg_proc as proc on proc.oid = quality.oid
  left join lateral aclexplode(
    case when proc.oid is null then null::aclitem[]
         else coalesce(proc.proacl, acldefault('f', proc.proowner))
    end
  ) as acl on true
  left join pg_catalog.pg_roles as role on role.oid = acl.grantee
  group by quality.oid, proc.prosecdef, proc.proconfig
), rpc_specs(name, signature) as (
  values
    ('claim_question_generation_jobs', 'public.claim_question_generation_jobs(text,integer,bigint)'),
    ('renew_question_generation_job', 'public.renew_question_generation_job(uuid,text,bigint,uuid,bigint)'),
    ('publish_question_generation_variants', 'public.publish_question_generation_variants(uuid,text,bigint,uuid,jsonb)'),
    ('complete_question_generation_job', 'public.complete_question_generation_job(uuid,text,bigint,uuid)'),
    ('fail_question_generation_job', 'public.fail_question_generation_job(uuid,text,bigint,uuid,integer,bigint,bigint,text,text,jsonb)'),
    ('enqueue_question_generation_job_if_needed', 'public.enqueue_question_generation_job_if_needed(uuid,uuid,text)'),
    ('fence_word_question_generation', 'public.fence_word_question_generation(uuid,uuid)'),
    ('finalize_word_question_generation_edit', 'public.finalize_word_question_generation_edit(uuid,uuid)'),
    ('reconcile_word_mastery_status', 'public.reconcile_word_mastery_status(uuid,uuid,text,timestamptz,text,timestamptz)'),
    ('create_formal_quiz_challenge', 'public.create_formal_quiz_challenge(uuid,text,text,jsonb,timestamptz)')
    ,('invalidate_formal_quiz_question', 'public.invalidate_formal_quiz_question(uuid,text,uuid,text,timestamptz)')
    ,('replace_formal_quiz_question', 'public.replace_formal_quiz_question(uuid,text,uuid,uuid,text,text,jsonb,timestamptz)')
), rpc_proc as (
  select spec.name, spec.signature, to_regprocedure(spec.signature)::oid as oid
  from rpc_specs as spec
), rpc_state as (
  select
    rpc.name,
    rpc.oid is not null as signature,
    coalesce(proc.prosecdef, false) as security_definer,
    coalesce(proc.proconfig @> array['search_path=pg_catalog'], false) as safe_search_path,
    coalesce(bool_or(acl.grantee = 0 and acl.privilege_type = 'EXECUTE'), false) as public_execute,
    coalesce(bool_or(role.rolname = 'anon' and acl.privilege_type = 'EXECUTE'), false) as anon_execute,
    coalesce(bool_or(role.rolname = 'authenticated' and acl.privilege_type = 'EXECUTE'), false) as authenticated_execute,
    coalesce(has_function_privilege('service_role', rpc.oid, 'EXECUTE'), false) as service_role_execute
  from rpc_proc as rpc
  left join pg_catalog.pg_proc as proc on proc.oid = rpc.oid
  left join lateral aclexplode(
    case when proc.oid is null then null::aclitem[]
         else coalesce(proc.proacl, acldefault('f', proc.proowner))
    end
  ) as acl on true
  left join pg_catalog.pg_roles as role on role.oid = acl.grantee
  group by rpc.name, rpc.oid, proc.prosecdef, proc.proconfig
)
select
  to_regclass('public.question_generation_jobs') is not null as jobs_table,
  to_regclass('public.quiz_challenges') is not null as formal_challenges_table,
  to_regclass('public.quiz_challenge_questions') is not null as formal_challenge_questions_table,
  to_regclass('public.quiz_display_events') is not null as formal_display_events_table,
  to_regclass('public.assessments') is not null as assessments_table,
  coalesce((
    select cls.relrowsecurity
    from pg_catalog.pg_class as cls
    join pg_catalog.pg_namespace as namespace on namespace.oid = cls.relnamespace
    where namespace.nspname = 'public' and cls.relname = 'question_generation_jobs'
  ), false) as jobs_rls_enabled,
  coalesce((select cls.relrowsecurity from pg_catalog.pg_class as cls join pg_catalog.pg_namespace as namespace on namespace.oid = cls.relnamespace where namespace.nspname = 'public' and cls.relname = 'quiz_challenges'), false) as formal_challenges_rls_enabled,
  coalesce((select cls.relrowsecurity from pg_catalog.pg_class as cls join pg_catalog.pg_namespace as namespace on namespace.oid = cls.relnamespace where namespace.nspname = 'public' and cls.relname = 'quiz_challenge_questions'), false) as formal_challenge_questions_rls_enabled,
  coalesce((select cls.relrowsecurity from pg_catalog.pg_class as cls join pg_catalog.pg_namespace as namespace on namespace.oid = cls.relnamespace where namespace.nspname = 'public' and cls.relname = 'quiz_display_events'), false) as formal_display_events_rls_enabled,
  coalesce((select cls.relrowsecurity from pg_catalog.pg_class as cls join pg_catalog.pg_namespace as namespace on namespace.oid = cls.relnamespace where namespace.nspname = 'public' and cls.relname = 'assessments'), false) as assessments_rls_enabled,
  exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = to_regclass('public.assessments')
      and attribute.attname = 'parent_review_id'
      and attribute.atttypid = 'text'::regtype
      and not attribute.attnotnull
      and not attribute.attisdropped
  ) as assessment_parent_review_id_column,
  exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = to_regclass('public.assessments')
      and attribute.attname = 'context_zh'
      and attribute.atttypid = 'text'::regtype
      and not attribute.attnotnull
      and not attribute.attisdropped
  ) as assessment_context_zh_column,
  exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_attrdef as default_meta
      on default_meta.adrelid = attribute.attrelid
     and default_meta.adnum = attribute.attnum
    where attribute.attrelid = to_regclass('public.assessments')
      and attribute.attname = 'option_meanings'
      and attribute.atttypid = 'jsonb'::regtype
      and attribute.attnotnull
      and not attribute.attisdropped
      and pg_get_expr(default_meta.adbin, default_meta.adrelid) = '''[]''::jsonb'
  ) as assessment_option_meanings_column,
  exists (
    select 1
    from pg_catalog.pg_class as index_class
    join pg_catalog.pg_namespace as namespace on namespace.oid = index_class.relnamespace
    join pg_catalog.pg_index as index_meta on index_meta.indexrelid = index_class.oid
    where namespace.nspname = 'public'
      and index_class.relname = 'assessments_parent_review_idx'
      and index_meta.indrelid = to_regclass('public.assessments')
      and not index_meta.indisunique
      and index_meta.indpred is not null
      and pg_get_indexdef(index_meta.indexrelid) like '%(user_id, parent_review_id, review_status)%'
      and lower(pg_get_expr(index_meta.indpred, index_meta.indrelid)) like '%parent_review_id%is not null%'
  ) as assessment_parent_review_index,
  (select function_exists from formal_quality_state) as formal_quality_function,
  (select security_invoker from formal_quality_state) as formal_quality_function_security_invoker,
  (select safe_search_path from formal_quality_state) as formal_quality_function_safe_search_path,
  (select public_execute from formal_quality_state) as formal_quality_function_public_execute,
  (select anon_execute from formal_quality_state) as formal_quality_function_anon_execute,
  (select authenticated_execute from formal_quality_state) as formal_quality_function_authenticated_execute,
  (select service_role_execute from formal_quality_state) as formal_quality_function_service_role_execute,
  exists (
    select 1
    from pg_catalog.pg_trigger as trigger
    where trigger.tgrelid = to_regclass('public.quiz_challenge_questions')
      and trigger.tgname = 'validate_formal_challenge_question_quality'
      and trigger.tgfoid = (select oid from formal_quality_proc)
      and trigger.tgtype = 23
      and not trigger.tgisinternal
      and trigger.tgenabled <> 'D'
  ) as formal_quality_trigger,
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
  exists (select 1 from pg_catalog.pg_class as index_class join pg_catalog.pg_namespace as namespace on namespace.oid = index_class.relnamespace where namespace.nspname = 'public' and index_class.relname = 'quiz_display_events_meaning_time_idx') as formal_display_events_index,
  exists (select 1 from pg_catalog.pg_class as index_class join pg_catalog.pg_namespace as namespace on namespace.oid = index_class.relnamespace where namespace.nspname = 'public' and index_class.relname = 'quiz_challenges_user_status_idx') as formal_challenges_index,
  exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = to_regclass('public.words')
      and attribute.attname = 'question_generation_version'
      and attribute.atttypid = 'bigint'::regtype
      and attribute.attnotnull
      and not attribute.attisdropped
  ) as word_generation_version_column,
  exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = to_regclass('public.question_generation_jobs')
      and attribute.attname = 'word_version'
      and attribute.atttypid = 'bigint'::regtype
      and attribute.attnotnull
      and not attribute.attisdropped
  ) as job_word_version_column,
  exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = to_regclass('public.question_generation_jobs')
      and attribute.attname = 'lease_token'
      and attribute.atttypid = 'uuid'::regtype
      and not attribute.attisdropped
  ) as job_lease_token_column,
  exists (
    select 1
    from pg_catalog.pg_proc as revision_proc
    join pg_catalog.pg_namespace as revision_namespace
      on revision_namespace.oid = revision_proc.pronamespace
    where revision_namespace.nspname = 'public'
      and revision_proc.proname = 'wordbot_question_generation_revision'
      and revision_proc.prosrc like '%20260806-versioned-word-edit%'
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
  (select service_role_execute from rpc_state where name = 'enqueue_question_generation_job_if_needed') as rpc_enqueue_job_if_needed_service_role_execute,
  (select signature from rpc_state where name = 'enqueue_question_generation_job_if_needed') as rpc_enqueue_job_if_needed_signature,
  (select security_definer from rpc_state where name = 'enqueue_question_generation_job_if_needed') as rpc_enqueue_job_if_needed_security_definer,
  (select public_execute from rpc_state where name = 'enqueue_question_generation_job_if_needed') as rpc_enqueue_job_if_needed_public_execute,
  (select anon_execute from rpc_state where name = 'enqueue_question_generation_job_if_needed') as rpc_enqueue_job_if_needed_anon_execute,
  (select authenticated_execute from rpc_state where name = 'enqueue_question_generation_job_if_needed') as rpc_enqueue_job_if_needed_authenticated_execute,
  (select service_role_execute from rpc_state where name = 'fence_word_question_generation') as rpc_fence_word_question_generation_service_role_execute,
  (select signature from rpc_state where name = 'fence_word_question_generation') as rpc_fence_word_question_generation_signature,
  (select security_definer from rpc_state where name = 'fence_word_question_generation') as rpc_fence_word_question_generation_security_definer,
  (select public_execute from rpc_state where name = 'fence_word_question_generation') as rpc_fence_word_question_generation_public_execute,
  (select anon_execute from rpc_state where name = 'fence_word_question_generation') as rpc_fence_word_question_generation_anon_execute,
  (select authenticated_execute from rpc_state where name = 'fence_word_question_generation') as rpc_fence_word_question_generation_authenticated_execute,
  (select service_role_execute from rpc_state where name = 'finalize_word_question_generation_edit') as rpc_finalize_word_edit_service_role_execute,
  (select signature from rpc_state where name = 'create_formal_quiz_challenge') as rpc_create_formal_quiz_challenge_signature,
  (select security_definer from rpc_state where name = 'create_formal_quiz_challenge') as rpc_create_formal_quiz_challenge_security_definer,
  (select public_execute from rpc_state where name = 'create_formal_quiz_challenge') as rpc_create_formal_quiz_challenge_public_execute,
  (select anon_execute from rpc_state where name = 'create_formal_quiz_challenge') as rpc_create_formal_quiz_challenge_anon_execute,
  (select authenticated_execute from rpc_state where name = 'create_formal_quiz_challenge') as rpc_create_formal_quiz_challenge_authenticated_execute,
  (select service_role_execute from rpc_state where name = 'create_formal_quiz_challenge') as rpc_create_formal_quiz_challenge_service_role_execute,
  (select signature from rpc_state where name = 'invalidate_formal_quiz_question') as rpc_invalidate_formal_quiz_question_signature,
  (select security_definer from rpc_state where name = 'invalidate_formal_quiz_question') as rpc_invalidate_formal_quiz_question_security_definer,
  (select public_execute from rpc_state where name = 'invalidate_formal_quiz_question') as rpc_invalidate_formal_quiz_question_public_execute,
  (select anon_execute from rpc_state where name = 'invalidate_formal_quiz_question') as rpc_invalidate_formal_quiz_question_anon_execute,
  (select authenticated_execute from rpc_state where name = 'invalidate_formal_quiz_question') as rpc_invalidate_formal_quiz_question_authenticated_execute,
  (select service_role_execute from rpc_state where name = 'invalidate_formal_quiz_question') as rpc_invalidate_formal_quiz_question_service_role_execute,
  (select signature from rpc_state where name = 'replace_formal_quiz_question') as rpc_replace_formal_quiz_question_signature,
  (select security_definer from rpc_state where name = 'replace_formal_quiz_question') as rpc_replace_formal_quiz_question_security_definer,
  (select public_execute from rpc_state where name = 'replace_formal_quiz_question') as rpc_replace_formal_quiz_question_public_execute,
  (select anon_execute from rpc_state where name = 'replace_formal_quiz_question') as rpc_replace_formal_quiz_question_anon_execute,
  (select authenticated_execute from rpc_state where name = 'replace_formal_quiz_question') as rpc_replace_formal_quiz_question_authenticated_execute,
  (select service_role_execute from rpc_state where name = 'replace_formal_quiz_question') as rpc_replace_formal_quiz_question_service_role_execute,
  (select signature from rpc_state where name = 'finalize_word_question_generation_edit') as rpc_finalize_word_edit_signature,
  (select security_definer from rpc_state where name = 'finalize_word_question_generation_edit') as rpc_finalize_word_edit_security_definer,
  (select public_execute from rpc_state where name = 'finalize_word_question_generation_edit') as rpc_finalize_word_edit_public_execute,
  (select anon_execute from rpc_state where name = 'finalize_word_question_generation_edit') as rpc_finalize_word_edit_anon_execute,
  (select authenticated_execute from rpc_state where name = 'finalize_word_question_generation_edit') as rpc_finalize_word_edit_authenticated_execute,
  (select signature from rpc_state where name = 'reconcile_word_mastery_status') as rpc_reconcile_word_mastery_status_signature,
  (select security_definer from rpc_state where name = 'reconcile_word_mastery_status') as rpc_reconcile_word_mastery_status_security_definer,
  (select public_execute from rpc_state where name = 'reconcile_word_mastery_status') as rpc_reconcile_word_mastery_status_public_execute,
  (select anon_execute from rpc_state where name = 'reconcile_word_mastery_status') as rpc_reconcile_word_mastery_status_anon_execute,
  (select authenticated_execute from rpc_state where name = 'reconcile_word_mastery_status') as rpc_reconcile_word_mastery_status_authenticated_execute,
  (select service_role_execute from rpc_state where name = 'reconcile_word_mastery_status') as rpc_reconcile_word_mastery_status_service_role_execute,
  (select safe_search_path from rpc_state where name = 'reconcile_word_mastery_status') as rpc_reconcile_word_mastery_status_safe_search_path,
  (select oid is null from old_claim_proc) as rpc_old_claim_signature_absent,
  to_regprocedure('public.renew_question_generation_job(uuid,text,bigint)') is null as rpc_old_renew_signature_absent,
  to_regprocedure('public.publish_question_generation_variants(uuid,text,jsonb)') is null as rpc_old_publish_signature_absent,
  to_regprocedure('public.complete_question_generation_job(uuid,text)') is null as rpc_old_complete_signature_absent,
  to_regprocedure('public.fail_question_generation_job(uuid,text,integer,bigint,bigint,text,text,jsonb)') is null as rpc_old_fail_signature_absent
`;
const MIGRATION_PATHS = Object.freeze([
  path.resolve(__dirname, '..', 'migrations', '20260803_question_generation_jobs.sql'),
  path.resolve(__dirname, '..', 'migrations', '20260803_question_generation_claim_rpc.sql'),
  path.resolve(__dirname, '..', 'migrations', '20260804_question_generation_backfill_hardening.sql'),
  path.resolve(__dirname, '..', 'migrations', '20260806_word_edit_generation_version.sql'),
  path.resolve(__dirname, '..', 'migrations', '20260807_formal_quiz_challenges.sql'),
  path.resolve(__dirname, '..', 'migrations', '20260808_formal_bad_question_replacement.sql'),
  path.resolve(__dirname, '..', 'migrations', '20260810_word_edit_cache_fk_hardening.sql'),
  path.resolve(__dirname, '..', 'migrations', '20260811_formal_question_quality_gate.sql'),
  path.resolve(__dirname, '..', 'migrations', '20260814_assessment_parent_review_id.sql'),
  path.resolve(__dirname, '..', 'migrations', '20260814_assessment_context_zh.sql'),
  path.resolve(__dirname, '..', 'migrations', '20260814_reconcile_word_mastery_status.sql'),
  path.resolve(__dirname, '..', 'migrations', '20260816_enqueue_rpc_acl.sql'),
  path.resolve(__dirname, '..', 'migrations', '20260816_assessment_option_meanings.sql'),
]);

const RPC_EXPECTATION_KEYS = Object.freeze([
  'claim_question_generation_jobs',
  'renew_question_generation_job',
  'publish_question_generation_variants',
  'complete_question_generation_job',
  'fail_question_generation_job',
  'enqueue_question_generation_job_if_needed',
  'fence_word_question_generation',
  'finalize_word_question_generation_edit',
  'reconcile_word_mastery_status',
  'create_formal_quiz_challenge',
  'invalidate_formal_quiz_question',
  'replace_formal_quiz_question',
].flatMap(name => {
  const verificationName = RPC_VERIFICATION_ALIASES[name] || name;
  return [
    `rpc_${verificationName}_signature`,
    `rpc_${verificationName}_security_definer`,
    `rpc_${verificationName}_public_execute`,
    `rpc_${verificationName}_anon_execute`,
    `rpc_${verificationName}_authenticated_execute`,
    `rpc_${verificationName}_service_role_execute`,
  ];
}));

const EXPECTED_STATE = Object.freeze({
  jobs_table: true,
  formal_challenges_table: true,
  formal_challenge_questions_table: true,
  formal_display_events_table: true,
  formal_challenges_rls_enabled: true,
  formal_challenge_questions_rls_enabled: true,
  formal_display_events_rls_enabled: true,
  formal_display_events_index: true,
  formal_challenges_index: true,
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
  backfill_hardening_revision: true,
  job_lease_token_column: true,
  formal_quality_function: true,
  formal_quality_function_security_invoker: true,
  formal_quality_function_safe_search_path: true,
  formal_quality_function_public_execute: false,
  formal_quality_function_anon_execute: false,
  formal_quality_function_authenticated_execute: false,
  formal_quality_function_service_role_execute: false,
  formal_quality_trigger: true,
  assessments_table: true,
  assessments_rls_enabled: true,
  assessment_parent_review_id_column: true,
  assessment_context_zh_column: true,
  assessment_option_meanings_column: true,
  assessment_parent_review_index: true,
  rpc_reconcile_word_mastery_status_safe_search_path: true,
  ...Object.fromEntries(RPC_EXPECTATION_KEYS.map(key => [
    key,
    !key.endsWith('_public_execute') && !key.endsWith('_anon_execute') && !key.endsWith('_authenticated_execute'),
  ])),
  rpc_create_formal_quiz_challenge_security_definer: false,
  rpc_invalidate_formal_quiz_question_security_definer: false,
  rpc_replace_formal_quiz_question_security_definer: false,
  rpc_old_claim_signature_absent: true,
  rpc_old_renew_signature_absent: true,
  rpc_old_publish_signature_absent: true,
  rpc_old_complete_signature_absent: true,
  rpc_old_fail_signature_absent: true,
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
      try {
        await client.query(sql);
      } catch (error) {
        error.migrationFile = path.basename(migrationPath);
        throw error;
      }
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
  const migration = error?.migrationFile ? ` in ${error.migrationFile}` : '';
  const table = error?.table ? ` table=${error.table}` : '';
  const constraint = error?.constraint ? ` constraint=${error.constraint}` : '';
  return `Database migration failed${migration}${code}${table}${constraint}`;
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
  RPC_VERIFICATION_ALIASES,
  VERIFICATION_SQL,
  applyQuestionGenerationMigrations,
  normalizeDatabaseUrl,
};
