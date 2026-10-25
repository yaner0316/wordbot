'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { PGlite } = require('@electric-sql/pglite');
const { MIGRATION_PATHS, VERIFICATION_SQL } = require('../scripts/apply-question-generation-migrations');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const WORD_ID = '22222222-2222-4222-8222-222222222222';
const FORMAL_NOW = '2026-08-24T00:00:00.000Z';

const BASE_SCHEMA_SQL = `
create role anon;
create role authenticated;
create role service_role;

create type public.wordbot_level as enum ('elementary', 'middle', 'high', 'CET4_6_TOEFL');
create type public.question_type as enum ('1', '2', '3', '4');
create type public.round_type as enum ('primary', 'review');
create type public.question_quality_status as enum ('pending', 'ready', 'failed', 'stale');
create type public.mastery_status as enum ('pending', 'recognized', 'consolidating', 'mastered');

create table public.users (
    id uuid primary key,
    username text not null
);

create table public.words (
    id uuid primary key,
    user_id uuid not null references public.users(id) on delete cascade,
    word text not null,
    meaning_en text not null,
    meaning_zh text,
    context_en text,
    level public.wordbot_level,
    mastery_status public.mastery_status not null default 'pending',
    remembered_at timestamptz,
    entered_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (id, user_id)
);

create table public.assessments (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.users(id) on delete cascade,
    parent_review_id text,
    question_text text,
    options jsonb not null default '[]'::jsonb,
    correct_answer text,
    review_status text
);

alter table public.assessments enable row level security;

create table public.quiz_sessions (
    test_id text primary key,
    user_id uuid not null references public.users(id) on delete cascade,
    questions jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default (now() + interval '1 hour')
);

create table public.question_cache (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.users(id) on delete cascade,
    word_id uuid not null,
    source_word_record_id text,
    level public.wordbot_level not null,
    question_type public.question_type not null,
    round_type public.round_type not null,
    quality_status public.question_quality_status not null default 'pending',
    question_text text not null,
    context_zh text,
    suffix text,
    options jsonb not null,
    answer text not null,
    option_meanings jsonb not null,
    correct_meaning text,
    ai_audit_status text,
    source_version text,
    used_count bigint not null default 0,
    generated_at timestamptz not null default now(),
    last_used_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (word_id, user_id) references public.words(id, user_id) on delete cascade
);

insert into public.users (id, username) values ('${USER_ID}', 'qiuqiu');
insert into public.words (id, user_id, word, meaning_en, context_en, level)
values ('${WORD_ID}', '${USER_ID}', 'apple', 'a fruit', 'The child ate an apple.', 'middle');
`;

function variantsJson({ aiAuditStatus = 'approved' } = {}) {
    return JSON.stringify([
        {
            source_word_record_id: 'rec-apple',
            level: 'middle',
            question_type: '1',
            question_text: 'The child ate an ___ after school.',
            context_zh: 'The child ate an apple after school.',
            options: ['A. apple', 'B. pear', 'C. plum', 'D. peach'],
            answer: 'A',
            option_meanings: ['apple meaning', 'pear meaning', 'plum meaning', 'peach meaning'],
            correct_meaning: 'a fruit',
            ai_audit_status: aiAuditStatus,
            question_fingerprint: 'apple-v1-a',
        },
        {
            source_word_record_id: 'rec-apple',
            level: 'middle',
            question_type: '1',
            question_text: 'She packed an ___ in her lunch box.',
            context_zh: 'She packed an apple in her lunch box.',
            options: ['A. apple', 'B. grape', 'C. melon', 'D. lemon'],
            answer: 'A',
            option_meanings: ['apple meaning', 'grape meaning', 'melon meaning', 'lemon meaning'],
            correct_meaning: 'a fruit',
            ai_audit_status: aiAuditStatus,
            question_fingerprint: 'apple-v1-b',
        },
    ]);
}

async function createDatabase(directory) {
    const db = new PGlite(directory);
    await db.exec(BASE_SCHEMA_SQL);
    for (const migrationPath of MIGRATION_PATHS) {
        await db.exec(await fs.readFile(migrationPath, 'utf8'));
    }
    return db;
}

async function fenceWord(db) {
    await db.query(
        'select * from public.fence_word_question_generation($1::uuid, $2::uuid)',
        [USER_ID, WORD_ID]
    );
}
test('teaching migration preserves legacy rows and persists publish/challenge/assessment snapshots across disk reopen',async()=>{
 const os=require('node:os'),path=require('node:path');
 const base=process.env.WORDBOT_FIX_EVIDENCE_DIR || (process.platform==='win32' ? path.join(__dirname,'.pglite-tmp') : os.tmpdir());
 await fs.mkdir(base,{recursive:true});
 const directory=await fs.mkdtemp(path.join(base,'wordbot-teaching-'));
 let db=await createDatabase(directory);
 try {
  await insertFormalWords(db,1);await insertFormalCacheRow(db,{index:1,cacheQuestionId:formalCacheId('0000',1)});
  const legacy=(await db.query('select to_jsonb(c) value from question_cache c where word_id=$1',[formalWordId(1)])).rows;
  await db.exec(await fs.readFile(MIGRATION_PATHS.at(-1),'utf8'));
  await db.exec(await fs.readFile(MIGRATION_PATHS.at(-1),'utf8'));
  assert.deepEqual((await db.query('select to_jsonb(c) value from question_cache c where word_id=$1',[formalWordId(1)])).rows,legacy);
  await db.query("select enqueue_question_generation_job_if_needed($1,$2,'cache_backfill')",[USER_ID,WORD_ID]);
  const job=(await db.query("select * from claim_question_generation_jobs('teaching-worker',1,60000)")).rows[0];
  const make=(index)=>{
   const options=index?['A. apple','B. orange','C. pen','D. desk']:['A. apple','B. pear','C. chair','D. book'];
   const meanings=index?['苹果','橙子','钢笔','书桌']:['苹果','梨','椅子','书'];
   return {source_word_record_id:'rec-apple',level:'middle',question_type:'1',question_text:index?'She picked an _____ from the apple tree behind her house.':'The _____ for this pie came from an apple tree behind our house.',context_zh:index?'她从屋后的苹果树上摘了一个苹果。':'这个派所用的苹果来自我们屋后的苹果树。',options,answer:'A',option_meanings:meanings,correct_meaning:'苹果',ai_audit_status:'approved',source_version:'supabase-contextual-variant-v3|unique-answer-v2|teaching-analysis-v1',question_fingerprint:'teaching-'+index,teaching_analysis:{schemaVersion:1,clue:'apple tree',clueReason:'苹果树是句中明确的水果来源。',correctWord:'apple',correctReason:'苹果树结的是苹果，所以对应苹果。',options:options.map((opt,i)=>({word:opt.slice(3),fits:i===0,meaning:meanings[i],reason:i===0?'苹果对应句中明确的苹果树来源。':'这个选项不是句中苹果树所结的果实。'}))}};
  };
  const variants=[make(0),make(1)];
  const pub=(await db.query('select * from publish_question_generation_variants($1,$2,$3,$4,$5::jsonb)',[job.id,'teaching-worker',job.word_version,job.lease_token,JSON.stringify(variants)])).rows[0];
  assert.equal(pub.published,2);
  const cache=(await db.query("select * from question_cache where word_id=$1 and cache_state='active'",[WORD_ID])).rows[0];
  assert.deepEqual(cache.teaching_analysis,variants[0].teaching_analysis);
  const snapshot={challengeSize:2,meaning_id:WORD_ID,cache_question_id:cache.id,stem:cache.question_text,context:cache.question_text,question_fingerprint:cache.question_fingerprint,type:1,options:cache.options,answer:cache.answer,optionMeanings:cache.option_meanings,contextCN:cache.context_zh,correctMeaning:'苹果',teachingAnalysis:cache.teaching_analysis};
  await db.query("update words set entered_at='2026-08-20T00:00:00Z' where id=$1",[WORD_ID]);
  const legacySnapshot={...formalQuestionSnapshot(1),challengeSize:2};
  await assert.rejects(db.query('select create_formal_quiz_challenge($1,$2,$3,$4::jsonb,$5::timestamptz)',[USER_ID,'real-missing-teaching','middle',JSON.stringify([{...snapshot,teachingAnalysis:null},legacySnapshot]),FORMAL_NOW]),/FORMAL_TEACHING_SNAPSHOT_REQUIRED/);
  await db.query('select create_formal_quiz_challenge($1,$2,$3,$4::jsonb,$5::timestamptz)',[USER_ID,'real-teaching','middle',JSON.stringify([snapshot,legacySnapshot]),FORMAL_NOW]);
  await db.query('insert into assessments(user_id,question_text,options,correct_answer,teaching_analysis) values($1,$2,$3::jsonb,$4,$5::jsonb)',[USER_ID,cache.question_text,JSON.stringify(cache.options),'A',JSON.stringify(cache.teaching_analysis)]);
  const before=(await db.query("select (select jsonb_agg(teaching_analysis) from question_cache where word_id=$1) cache,(select jsonb_agg(question_snapshot) from quiz_challenge_questions) challenges,(select jsonb_agg(teaching_analysis) from assessments) assessments",[WORD_ID])).rows[0];
  console.log('teaching persistence: snapshots saved, closing disk database');
  await db.close();console.log('teaching persistence: reopening disk database');db=new PGlite(directory);
  const after=(await db.query("select (select jsonb_agg(teaching_analysis) from question_cache where word_id=$1) cache,(select jsonb_agg(question_snapshot) from quiz_challenge_questions) challenges,(select jsonb_agg(teaching_analysis) from assessments) assessments",[WORD_ID])).rows[0];
  assert.deepEqual(after,before);
  console.log('teaching persistence: disk reopen snapshot equality passed');
  const verified=(await db.query(VERIFICATION_SQL)).rows[0];
  for(const key of ['teaching_analysis_cache_column','teaching_analysis_assessment_column','teaching_analysis_publish_contract','teaching_analysis_challenge_trigger']) assert.equal(verified[key],true,key);
  const permission=(await db.query("select has_function_privilege('anon','public.is_valid_teaching_analysis(jsonb,text,jsonb,text)','execute') anon,has_function_privilege('authenticated','public.is_valid_teaching_analysis(jsonb,text,jsonb,text)','execute') authenticated,has_function_privilege('service_role','public.is_valid_teaching_analysis(jsonb,text,jsonb,text)','execute') service,(select prosecdef from pg_proc where oid='public.is_valid_teaching_analysis(jsonb,text,jsonb,text)'::regprocedure) definer")).rows[0];
  assert.deepEqual(permission,{anon:false,authenticated:false,service:true,definer:false});
  if(process.env.WORDBOT_FIX_EVIDENCE_DIR) await fs.writeFile(path.join(process.env.WORDBOT_FIX_EVIDENCE_DIR,'persistent-teaching.json'),JSON.stringify({passed:true,scope:'synthetic disk PGlite, real migration/RPC/constraints; no production export',checks:['idempotent-no-legacy-rewrite','atomic-publisher-persists-analysis','challenge-rejects-missing-snapshot','disk-close-reopen-equal','schema-verifier','service-only-invoker-permissions'],permission,snapshot:after},null,2));
 } finally {await db.close();await fs.rm(directory,{recursive:true,force:true});}
});

function formalWordId(index) {
    return `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`;
}

function formalCacheId(prefix, index) {
    return `44444444-4444-4444-8444-${prefix}${String(index).padStart(8, '0')}`;
}

function formalQuestionSnapshot(index, cacheQuestionId = formalCacheId('0000', index)) {
    return {
        meaning_id: formalWordId(index),
        cache_question_id: cacheQuestionId,
        stem: `Formal sentence ${index} with ___.`,
        question_fingerprint: `formal-fingerprint-${index}-${cacheQuestionId}`,
        type: 1,
        source: 'question_cache',
        context: `Formal sentence ${index} with ___.`,
        contextCN: `这是第${index}个完整的中文句子。`,
        options: ['A. apple', 'B. pear', 'C. plum', 'D. peach'],
        answer: 'A',
        optionMeanings: ['苹果', '梨子', '李子', '桃子'],
        correctMeaning: '苹果',
    };
}

async function insertFormalWords(db, count = 10) {
    for (let index = 1; index <= count; index += 1) {
        await db.query(`
            insert into public.words (id, user_id, word, meaning_en, meaning_zh, context_en, level, entered_at)
            values ($1::uuid, $2::uuid, $3, 'a fruit', '苹果', $4, 'middle', '2026-08-20T00:00:00.000Z')
        `, [formalWordId(index), USER_ID, `apple${index}`, `Formal sentence ${index} with apple.`]);
    }
}

async function insertFormalCacheRow(db, { index, cacheQuestionId, aiAuditStatus = 'approved', cacheState = 'active' } = {}) {
    await db.query(`
        insert into public.question_cache (
            id, user_id, word_id, source_word_record_id, level, question_type, round_type, quality_status,
            question_text, context_zh, options, answer, option_meanings, correct_meaning,
            ai_audit_status, variant_slot, cache_state, question_fingerprint
        ) values (
            $1::uuid, $2::uuid, $3::uuid, $4, 'middle', '1', 'primary', 'ready',
            $5, $6, '["A. apple","B. pear","C. plum","D. peach"]'::jsonb, 'A',
            '["苹果","梨子","李子","桃子"]'::jsonb, '苹果',
            $7, 1, $8, $9
        )
    `, [
        cacheQuestionId,
        USER_ID,
        formalWordId(index),
        `formal-word-${index}`,
        `Formal sentence ${index} with ___.`,
        `这是第${index}个完整的中文句子。`,
        aiAuditStatus,
        cacheState,
        `formal-fingerprint-${index}-${cacheQuestionId}`,
    ]);
}

async function insertFormalCacheRows(db, aiAuditStatus = 'approved') {
    for (let index = 1; index <= 10; index += 1) {
        await insertFormalCacheRow(db, {
            index,
            cacheQuestionId: formalCacheId('0000', index),
            aiAuditStatus,
        });
    }
}

function formalChallengeQuestions(cacheIdForIndex = index => formalCacheId('0000', index)) {
    return Array.from({ length: 10 }, (_, offset) => {
        const index = offset + 1;
        return formalQuestionSnapshot(index, cacheIdForIndex(index));
    });
}

async function createApprovedFormalChallenge(db) {
    await insertFormalWords(db);
    await insertFormalCacheRows(db, 'approved');
    await db.query(
        'select public.create_formal_quiz_challenge($1::uuid, $2, $3, $4::jsonb, $5::timestamptz)',
        [USER_ID, 'real-approved-formal', 'middle', JSON.stringify(formalChallengeQuestions()), FORMAL_NOW]
    );
    const question = await db.query(`
        select id, meaning_id, cache_question_id, stem, question_snapshot
        from public.quiz_challenge_questions
        order by ordinal
        limit 1
    `);
    await db.query(
        'select public.invalidate_formal_quiz_question($1::uuid, $2, $3::uuid, $4, $5::timestamptz)',
        [USER_ID, 'real-approved-formal', question.rows[0].id, 'bad question', FORMAL_NOW]
    );
    return question.rows[0];
}

test('each formal display durably requests replenishment in the same transaction', async () => {
    const db=await createDatabase();
    try {
        await insertFormalWords(db);
        await insertFormalCacheRows(db);
        await db.exec("update question_generation_jobs set status='ready'");
        await db.query('select public.create_formal_quiz_challenge($1::uuid,$2,$3,$4::jsonb,$5::timestamptz)',
            [USER_ID,'real-replenish','middle',JSON.stringify(formalChallengeQuestions()),FORMAL_NOW]);
        const jobs=await db.query("select status from question_generation_jobs where word_id <> $1",[WORD_ID]);
        assert.equal(jobs.rows.length,10);
        assert.ok(jobs.rows.every(job=>job.status==='pending'));
        assert.equal((await db.query(VERIFICATION_SQL)).rows[0].display_replenishment_trigger,true);
    } finally {await db.close();}
});

test('migration verification SQL executes against the real versioned PGlite schema', async () => {
    const db = await createDatabase();
    try {
        const result = await db.query(VERIFICATION_SQL);
        assert.equal(result.rows[0].quiz_session_state_column, true);
        assert.equal(result.rows[0].quiz_session_updated_at_column, true);
        assert.equal(result.rows[0].quiz_session_updated_at_trigger, true);
        assert.equal(result.rows[0].assessment_context_zh_column, true);
        assert.equal(result.rows[0].job_lease_token_column, true);
        assert.equal(result.rows[0].rpc_reconcile_word_mastery_status_signature, true);
        assert.equal(result.rows[0].rpc_reconcile_word_mastery_status_security_definer, true);
        assert.equal(result.rows[0].rpc_reconcile_word_mastery_status_safe_search_path, true);
        assert.equal(result.rows[0].rpc_reconcile_word_mastery_status_public_execute, false);
        assert.equal(result.rows[0].rpc_reconcile_word_mastery_status_anon_execute, false);
        assert.equal(result.rows[0].rpc_reconcile_word_mastery_status_authenticated_execute, false);
        assert.equal(result.rows[0].rpc_reconcile_word_mastery_status_service_role_execute, true);
        assert.equal(result.rows[0].rpc_publish_question_generation_variants_ai_audit_contract, true);
    } finally {
        await db.close();
    }
});

test('atomic mastery reconciliation rejects stale state without touching generation lifecycle', async () => {
    const db = await createDatabase();
    try {
        await db.query(`
            insert into public.question_cache (
                user_id, word_id, level, question_type, round_type, quality_status,
                question_text, options, answer, option_meanings, correct_meaning,
                variant_slot, cache_state, question_fingerprint
            ) values (
                $1::uuid, $2::uuid, 'middle', '1', 'primary', 'ready',
                'The child ate an ___.', '["A. apple","B. pear","C. plum","D. peach"]'::jsonb,
                'A', '["apple","pear","plum","peach"]'::jsonb,
                'a fruit', 1, 'active', 'reconcile-stale-state'
            )
        `, [USER_ID, WORD_ID]);
        await db.query(
            "select public.enqueue_question_generation_job_if_needed($1::uuid, $2::uuid, 'cache_backfill')",
            [USER_ID, WORD_ID]
        );
        const before = await db.query(`
            select word.mastery_status, word.remembered_at, word.question_generation_version,
                   (select count(*)::integer from public.question_cache where word_id = word.id) as cache_count,
                   (select count(*)::integer from public.question_generation_jobs where word_id = word.id) as job_count
            from public.words as word where word.id = $1::uuid
        `, [WORD_ID]);

        const result = await db.query(
            "select public.reconcile_word_mastery_status($1::uuid, $2::uuid, 'recognized', null, 'mastered', now()) as applied",
            [USER_ID, WORD_ID]
        );
        const after = await db.query(`
            select word.mastery_status, word.remembered_at, word.question_generation_version,
                   (select count(*)::integer from public.question_cache where word_id = word.id) as cache_count,
                   (select count(*)::integer from public.question_generation_jobs where word_id = word.id) as job_count
            from public.words as word where word.id = $1::uuid
        `, [WORD_ID]);

        assert.deepEqual(result.rows, [{ applied: false }]);
        assert.deepEqual(after.rows, before.rows);
    } finally {
        await db.close();
    }
});

test('atomic mastery reconciliation preserves generation outside mastered transitions', async () => {
    const db = await createDatabase();
    try {
        await db.query(`
            insert into public.question_cache (
                user_id, word_id, level, question_type, round_type, quality_status,
                question_text, options, answer, option_meanings, correct_meaning,
                variant_slot, cache_state, question_fingerprint
            ) values (
                $1::uuid, $2::uuid, 'middle', '1', 'primary', 'ready',
                'The child ate an ___.', '["A. apple","B. pear","C. plum","D. peach"]'::jsonb,
                'A', '["apple","pear","plum","peach"]'::jsonb,
                'a fruit', 1, 'active', 'reconcile-nonmastered'
            )
        `, [USER_ID, WORD_ID]);
        await db.query(
            "select public.enqueue_question_generation_job_if_needed($1::uuid, $2::uuid, 'cache_backfill')",
            [USER_ID, WORD_ID]
        );
        const before = await db.query(
            'select question_generation_version from public.words where id = $1::uuid',
            [WORD_ID]
        );

        const result = await db.query(
            "select public.reconcile_word_mastery_status($1::uuid, $2::uuid, 'pending', null, 'recognized', null) as applied",
            [USER_ID, WORD_ID]
        );
        const after = await db.query(`
            select word.mastery_status, word.question_generation_version,
                   (select count(*)::integer from public.question_cache where word_id = word.id) as cache_count,
                   (select count(*)::integer from public.question_generation_jobs where word_id = word.id) as job_count
            from public.words as word where word.id = $1::uuid
        `, [WORD_ID]);

        assert.deepEqual(result.rows, [{ applied: true }]);
        assert.equal(after.rows[0].mastery_status, 'recognized');
        assert.equal(after.rows[0].question_generation_version, before.rows[0].question_generation_version);
        assert.equal(after.rows[0].cache_count, 1);
        assert.equal(after.rows[0].job_count, 1);
    } finally {
        await db.close();
    }
});

test('atomic mastery reconciliation invalidates generation only when entering mastered', async () => {
    const db = await createDatabase();
    try {
        await db.query(`
            insert into public.question_cache (
                user_id, word_id, level, question_type, round_type, quality_status,
                question_text, options, answer, option_meanings, correct_meaning,
                variant_slot, cache_state, question_fingerprint
            ) values (
                $1::uuid, $2::uuid, 'middle', '1', 'primary', 'ready',
                'The child ate an ___.', '["A. apple","B. pear","C. plum","D. peach"]'::jsonb,
                'A', '["apple","pear","plum","peach"]'::jsonb,
                'a fruit', 1, 'active', 'reconcile-mastered'
            )
        `, [USER_ID, WORD_ID]);
        await db.query(
            "select public.enqueue_question_generation_job_if_needed($1::uuid, $2::uuid, 'cache_backfill')",
            [USER_ID, WORD_ID]
        );
        const before = await db.query(
            'select question_generation_version from public.words where id = $1::uuid',
            [WORD_ID]
        );

        const result = await db.query(
            "select public.reconcile_word_mastery_status($1::uuid, $2::uuid, 'pending', null, 'mastered', '2026-08-02T00:00:00Z') as applied",
            [USER_ID, WORD_ID]
        );
        const after = await db.query(`
            select word.mastery_status, word.remembered_at, word.question_generation_version,
                   (select count(*)::integer from public.question_cache where word_id = word.id) as cache_count,
                   (select count(*)::integer from public.question_generation_jobs where word_id = word.id) as job_count
            from public.words as word where word.id = $1::uuid
        `, [WORD_ID]);

        assert.deepEqual(result.rows, [{ applied: true }]);
        assert.equal(after.rows[0].mastery_status, 'mastered');
        assert.equal(after.rows[0].question_generation_version, before.rows[0].question_generation_version + 1);
        assert.equal(after.rows[0].cache_count, 0);
        assert.equal(after.rows[0].job_count, 0);
    } finally {
        await db.close();
    }
});

test('atomic mastery reconciliation requeues generation when leaving mastered', async () => {
    const db = await createDatabase();
    try {
        await db.query(`
            update public.words
            set mastery_status = 'mastered', remembered_at = '2026-08-02T00:00:00Z'
            where id = $1::uuid
        `, [WORD_ID]);
        const before = await db.query(
            'select question_generation_version from public.words where id = $1::uuid',
            [WORD_ID]
        );

        const result = await db.query(
            "select public.reconcile_word_mastery_status($1::uuid, $2::uuid, 'mastered', '2026-08-02T00:00:00Z', 'recognized', null) as applied",
            [USER_ID, WORD_ID]
        );
        const after = await db.query(`
            select word.mastery_status, word.remembered_at, word.question_generation_version,
                   job.status as job_status, job.reason as job_reason,
                   job.word_version as job_word_version
            from public.words as word
            left join public.question_generation_jobs as job on job.word_id = word.id
            where word.id = $1::uuid
        `, [WORD_ID]);

        assert.deepEqual(result.rows, [{ applied: true }]);
        assert.equal(after.rows[0].mastery_status, 'recognized');
        assert.equal(after.rows[0].remembered_at, null);
        assert.equal(after.rows[0].question_generation_version, before.rows[0].question_generation_version + 1);
        assert.equal(after.rows[0].job_status, 'pending');
        assert.equal(after.rows[0].job_reason, 'word_edit');
        assert.equal(after.rows[0].job_word_version, after.rows[0].question_generation_version);
    } finally {
        await db.close();
    }
});
test('a no-job word edit fence prevents a later backfill claim and stale publication', async () => {
    const db = await createDatabase();
    try {
        const before = await db.query(
            'select count(*)::integer as count from public.question_generation_jobs where word_id = $1::uuid',
            [WORD_ID]
        );
        assert.equal(before.rows[0].count, 0);

        await fenceWord(db);
        await db.query(
            "select public.enqueue_question_generation_job_if_needed($1::uuid, $2::uuid, 'cache_backfill')",
            [USER_ID, WORD_ID]
        );
        const claim = await db.query(
            "select * from public.claim_question_generation_jobs('old-worker', 1, 60000)"
        );

        if (claim.rows.length > 0) {
            await db.query(
                'update public.words set meaning_en = $1, updated_at = clock_timestamp() where id = $2::uuid',
                ['an edible fruit', WORD_ID]
            );
            await db.query(
                'delete from public.question_cache where user_id = $1::uuid and word_id = $2::uuid',
                [USER_ID, WORD_ID]
            );
            await db.query(
                'select * from public.publish_question_generation_variants($1::uuid, $2, $3::bigint, $4::uuid, $5::jsonb)',
                [
                    claim.rows[0].id,
                    'old-worker',
                    claim.rows[0].word_version,
                    claim.rows[0].lease_token,
                    variantsJson(),
                ]
            );
        }

        const cache = await db.query(
            'select count(*)::integer as count from public.question_cache where word_id = $1::uuid',
            [WORD_ID]
        );
        assert.equal(cache.rows[0].count, 0, 'an obsolete worker must not republish cache after invalidation');
        assert.equal(claim.rows.length, 0, 'a job created after the fence must not be claimable');
    } finally {
        await db.close();
    }
});

test('a fenced cache referenced by a formal challenge is retired instead of deleted', async () => {
    const db = await createDatabase();
    try {
        const cache = await db.query(`
            insert into public.question_cache (
                user_id, word_id, level, question_type, round_type, quality_status,
                question_text, options, answer, option_meanings, correct_meaning,
                variant_slot, cache_state, question_fingerprint
            ) values (
                $1::uuid, $2::uuid, 'middle', '1', 'primary', 'ready',
                'The child ate an ___.', '[]'::jsonb, 'A', '[]'::jsonb,
                'a fruit', 1, 'active', 'fk-protected-cache'
            ) returning id
        `, [USER_ID, WORD_ID]);
        const challenge = await db.query(`
            insert into public.quiz_challenges (test_id, user_id, level, expires_at)
            values ('fk-protection-test', $1::uuid, 'middle', now() + interval '1 hour')
            returning id
        `, [USER_ID]);
        await db.query(`
            insert into public.quiz_challenge_questions (
                challenge_id, ordinal, meaning_id, cache_question_id, stem,
                question_fingerprint, question_snapshot, history_expires_at
            ) values (
                $1::uuid, 1, $2::uuid, $3::uuid, 'The child ate an ___.',
                'fk-protected-cache',
                '{"answer":"A","contextCN":"这个孩子吃了一个苹果。","optionMeanings":["苹果","面包","米饭","汤"]}'::jsonb,
                now() + interval '30 days'
            )
        `, [challenge.rows[0].id, WORD_ID, cache.rows[0].id]);

        await fenceWord(db);

        const preserved = await db.query(
            'select cache_state from public.question_cache where id = $1::uuid',
            [cache.rows[0].id]
        );
        assert.deepEqual(preserved.rows, [{ cache_state: 'retired' }]);
    } finally {
        await db.close();
    }
});

for (const aiAuditStatus of [null, 'skipped', 'rejected']) {
    test(`formal challenge creation rejects type-1 cache rows with ai_audit_status=${aiAuditStatus}`, async () => {
        const db = await createDatabase();
        try {
            await insertFormalWords(db);
            await insertFormalCacheRows(db, aiAuditStatus);

            await assert.rejects(
                db.query(
                    'select public.create_formal_quiz_challenge($1::uuid, $2, $3, $4::jsonb, $5::timestamptz)',
                    [USER_ID, `real-formal-${aiAuditStatus || 'null'}`, 'middle', JSON.stringify(formalChallengeQuestions()), FORMAL_NOW]
                ),
                /FORMAL_CHALLENGE_CACHE_AI_AUDIT_REQUIRED/
            );

            const challengeCount = await db.query('select count(*)::integer as count from public.quiz_challenges');
            assert.equal(challengeCount.rows[0].count, 0);
        } finally {
            await db.close();
        }
    });
}

test('formal challenge creation accepts approved type-1 cache rows', async () => {
    const db = await createDatabase();
    try {
        await insertFormalWords(db);
        await insertFormalCacheRows(db, 'approved');

        const created = await db.query(
            'select public.create_formal_quiz_challenge($1::uuid, $2, $3, $4::jsonb, $5::timestamptz) as result',
            [USER_ID, 'real-formal-approved', 'middle', JSON.stringify(formalChallengeQuestions()), FORMAL_NOW]
        );

        assert.equal(created.rows[0].result.question_count, 10);
        const challengeCount = await db.query('select count(*)::integer as count from public.quiz_challenges');
        assert.equal(challengeCount.rows[0].count, 1);
    } finally {
        await db.close();
    }
});

for (const aiAuditStatus of [null, 'skipped', 'rejected']) {
    test(`formal question replacement rejects type-1 cache rows with ai_audit_status=${aiAuditStatus}`, async () => {
        const db = await createDatabase();
        try {
            const oldQuestion = await createApprovedFormalChallenge(db);
            const replacementCacheId = formalCacheId('9999', 1);
            await insertFormalCacheRow(db, { index: 1, cacheQuestionId: replacementCacheId, aiAuditStatus });

            await assert.rejects(
                db.query(
                    'select public.replace_formal_quiz_question($1::uuid, $2, $3::uuid, $4::uuid, $5, $6, $7::jsonb, $8::timestamptz)',
                    [
                        USER_ID,
                        'real-approved-formal',
                        oldQuestion.id,
                        replacementCacheId,
                        'Formal sentence 1 with ___.',
                        `formal-fingerprint-1-${replacementCacheId}`,
                        JSON.stringify(formalQuestionSnapshot(1, replacementCacheId)),
                        FORMAL_NOW,
                    ]
                ),
                /FORMAL_REPLACEMENT_CACHE_AI_AUDIT_REQUIRED/
            );
        } finally {
            await db.close();
        }
    });
}

test('formal question replacement accepts approved type-1 cache rows', async () => {
    const db = await createDatabase();
    try {
        const oldQuestion = await createApprovedFormalChallenge(db);
        const replacementCacheId = formalCacheId('9999', 1);
        await insertFormalCacheRow(db, { index: 1, cacheQuestionId: replacementCacheId, aiAuditStatus: 'approved' });

        const replaced = await db.query(
            'select public.replace_formal_quiz_question($1::uuid, $2, $3::uuid, $4::uuid, $5, $6, $7::jsonb, $8::timestamptz) as result',
            [
                USER_ID,
                'real-approved-formal',
                oldQuestion.id,
                replacementCacheId,
                'Formal sentence 1 with ___.',
                `formal-fingerprint-1-${replacementCacheId}`,
                JSON.stringify(formalQuestionSnapshot(1, replacementCacheId)),
                FORMAL_NOW,
            ]
        );

        assert.equal(replaced.rows[0].result.replaced, true);
        assert.equal(replaced.rows[0].result.cache_question_id, replacementCacheId);
    } finally {
        await db.close();
    }
});

test('publish rejects an obsolete job version even if stale lease fields remain', async () => {
    const db = await createDatabase();
    try {
        await db.query(
            "select public.enqueue_question_generation_job_if_needed($1::uuid, $2::uuid, 'cache_backfill')",
            [USER_ID, WORD_ID]
        );
        const claim = await db.query(
            "select * from public.claim_question_generation_jobs('old-worker', 1, 60000)"
        );
        assert.equal(claim.rows.length, 1);

        const oldVersion = claim.rows[0].word_version;
        const oldLeaseToken = claim.rows[0].lease_token;
        await db.query(
            'select * from public.fence_word_question_generation($1::uuid, $2::uuid)',
            [USER_ID, WORD_ID]
        );
        await db.query(`
            update public.question_generation_jobs
            set word_version = $1,
                status = 'generating',
                lease_owner = 'old-worker',
                lease_expires_at = clock_timestamp() + interval '1 hour',
                lease_token = $2::uuid
            where id = $3::uuid
        `, [oldVersion, oldLeaseToken, claim.rows[0].id]);

        const publish = await db.query(
            'select * from public.publish_question_generation_variants($1::uuid, $2, $3::bigint, $4::uuid, $5::jsonb)',
            [
                claim.rows[0].id,
                'old-worker',
                oldVersion,
                oldLeaseToken,
                variantsJson(),
            ]
        );
        const cache = await db.query(
            'select count(*)::integer as count from public.question_cache where word_id = $1::uuid',
            [WORD_ID]
        );
        assert.equal(publish.rows.length, 0);
        assert.equal(cache.rows[0].count, 0);
    } finally {
        await db.close();
    }
});

for (const aiAuditStatus of ['skipped', 'rejected']) {
    test(`publish rejects type-1 variants with ai_audit_status=${aiAuditStatus} before writing cache`, async () => {
        const db = await createDatabase();
        try {
            await db.query(
                "select public.enqueue_question_generation_job_if_needed($1::uuid, $2::uuid, 'cache_backfill')",
                [USER_ID, WORD_ID]
            );
            const claim = await db.query(
                "select * from public.claim_question_generation_jobs('audit-worker', 1, 60000)"
            );
            assert.equal(claim.rows.length, 1);

            await assert.rejects(
                db.query(
                    'select * from public.publish_question_generation_variants($1::uuid, $2, $3::bigint, $4::uuid, $5::jsonb)',
                    [
                        claim.rows[0].id,
                        'audit-worker',
                        claim.rows[0].word_version,
                        claim.rows[0].lease_token,
                        variantsJson({ aiAuditStatus }),
                    ]
                ),
                /INVALID_VARIANT_STRUCTURE/
            );

            const cache = await db.query(
                'select count(*)::integer as count from public.question_cache where word_id = $1::uuid',
                [WORD_ID]
            );
            assert.equal(cache.rows[0].count, 0);
        } finally {
            await db.close();
        }
    });
}

test('publish accepts approved type-1 variants and preserves service-role-only RPC security', async () => {
    const db = await createDatabase();
    try {
        await db.query(
            "select public.enqueue_question_generation_job_if_needed($1::uuid, $2::uuid, 'cache_backfill')",
            [USER_ID, WORD_ID]
        );
        const claim = await db.query(
            "select * from public.claim_question_generation_jobs('approved-worker', 1, 60000)"
        );
        assert.equal(claim.rows.length, 1);

        const publish = await db.query(
            'select * from public.publish_question_generation_variants($1::uuid, $2, $3::bigint, $4::uuid, $5::jsonb)',
            [
                claim.rows[0].id,
                'approved-worker',
                claim.rows[0].word_version,
                claim.rows[0].lease_token,
                variantsJson({ aiAuditStatus: 'approved' }),
            ]
        );
        assert.equal(publish.rows[0].published, 2);

        const cache = await db.query(
            'select count(*)::integer as count, array_agg(distinct ai_audit_status) as statuses from public.question_cache where word_id = $1::uuid',
            [WORD_ID]
        );
        assert.deepEqual(cache.rows[0], { count: 2, statuses: ['approved'] });

        const security = await db.query(`
            select
                proc.prosecdef as security_definer,
                proc.proconfig @> array['search_path=public'] as safe_search_path,
                has_function_privilege('service_role', proc.oid, 'EXECUTE') as service_role_execute,
                has_function_privilege('public', proc.oid, 'EXECUTE') as public_execute,
                has_function_privilege('anon', proc.oid, 'EXECUTE') as anon_execute,
                has_function_privilege('authenticated', proc.oid, 'EXECUTE') as authenticated_execute
            from pg_catalog.pg_proc as proc
            join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
            where namespace.nspname = 'public'
              and proc.oid = to_regprocedure('public.publish_question_generation_variants(uuid,text,bigint,uuid,jsonb)')
        `);
        assert.deepEqual(security.rows, [{
            security_definer: true,
            safe_search_path: true,
            service_role_execute: true,
            public_execute: false,
            anon_execute: false,
            authenticated_execute: false,
        }]);
    } finally {
        await db.close();
    }
});

for (const editCase of [
    {
        name: 'mastered',
        updateSql: "update public.words set mastery_status = 'mastered' where id = $1::uuid",
    },
    {
        name: 'invalid',
        updateSql: "update public.words set word = 'genaine' where id = $1::uuid",
    },
]) {
    test(`${editCase.name} edit finalization removes cache and its fenced job`, async () => {
        const db = await createDatabase();
        try {
            await db.query(`
                insert into public.question_cache (
                    user_id, word_id, level, question_type, round_type, quality_status,
                    question_text, options, answer, option_meanings, correct_meaning,
                    variant_slot, cache_state, question_fingerprint
                ) values (
                    $1::uuid, $2::uuid, 'middle', '1', 'primary', 'ready',
                    'The child ate an ___.', '["A. apple", "B. pear", "C. plum", "D. peach"]'::jsonb,
                    'A', '["apple meaning", "pear meaning", "plum meaning", "peach meaning"]'::jsonb,
                    'a fruit', 1, 'active', 'existing-cache'
                )
            `, [USER_ID, WORD_ID]);
            await db.query(
                'select * from public.fence_word_question_generation($1::uuid, $2::uuid)',
                [USER_ID, WORD_ID]
            );
            await db.query(editCase.updateSql, [WORD_ID]);
            await db.query(
                'select public.finalize_word_question_generation_edit($1::uuid, $2::uuid)',
                [USER_ID, WORD_ID]
            );

            const state = await db.query(`
                select
                    (select count(*)::integer from public.question_cache where word_id = $1::uuid) as cache_count,
                    (select count(*)::integer from public.question_generation_jobs where word_id = $1::uuid) as job_count
            `, [WORD_ID]);
            assert.deepEqual(state.rows[0], { cache_count: 0, job_count: 0 });
        } finally {
            await db.close();
        }
    });
}

test('fencing one meaning does not block a same-spelling different word_id', async () => {
    const db = await createDatabase();
    const otherWordId = '33333333-3333-4333-8333-333333333333';
    try {
        await db.query(`
            insert into public.words (id, user_id, word, meaning_en, context_en, level)
            values ($1::uuid, $2::uuid, 'apple', 'a technology company', 'Apple announced a product.', 'middle')
        `, [otherWordId, USER_ID]);
        await db.query(
            'select * from public.fence_word_question_generation($1::uuid, $2::uuid)',
            [USER_ID, WORD_ID]
        );

        const claim = await db.query(
            "select * from public.claim_question_generation_jobs('worker-2', 10, 60000)"
        );
        assert.deepEqual(claim.rows.map(row => row.word_id), [otherWordId]);
    } finally {
        await db.close();
    }
});

test('question generation migrations remain idempotent with the version protocol', async () => {
    const db = await createDatabase();
    try {
        for (const migrationPath of MIGRATION_PATHS) {
            await db.exec(await fs.readFile(migrationPath, 'utf8'));
        }
        const jobs = await db.query(
            'select count(*)::integer as count from public.question_generation_jobs'
        );
        assert.equal(jobs.rows[0].count, 0);
    } finally {
        await db.close();
    }
});

test('an old claim cannot publish through a newer lease that reuses the same worker id', async () => {
    const db = await createDatabase();
    try {
        await db.query(
            "select public.enqueue_question_generation_job_if_needed($1::uuid, $2::uuid, 'cache_backfill')",
            [USER_ID, WORD_ID]
        );
        const firstClaim = await db.query(
            "select * from public.claim_question_generation_jobs('shared-worker', 1, 60000)"
        );
        assert.equal(firstClaim.rows.length, 1);

        await db.query(
            'select * from public.fence_word_question_generation($1::uuid, $2::uuid)',
            [USER_ID, WORD_ID]
        );
        await db.query(
            'update public.words set meaning_en = $1 where id = $2::uuid',
            ['an edible fruit', WORD_ID]
        );
        await db.query(
            'select public.finalize_word_question_generation_edit($1::uuid, $2::uuid)',
            [USER_ID, WORD_ID]
        );
        const secondClaim = await db.query(
            "select * from public.claim_question_generation_jobs('shared-worker', 1, 60000)"
        );
        assert.equal(secondClaim.rows.length, 1);
        assert.equal(secondClaim.rows[0].id, firstClaim.rows[0].id);
        assert.notEqual(secondClaim.rows[0].word_version, firstClaim.rows[0].word_version);

        const oldPublish = await db.query(
            'select * from public.publish_question_generation_variants($1::uuid, $2, $3::bigint, $4::uuid, $5::jsonb)',
            [
                firstClaim.rows[0].id,
                'shared-worker',
                firstClaim.rows[0].word_version,
                firstClaim.rows[0].lease_token,
                variantsJson(),
            ]
        );
        const cache = await db.query(
            'select count(*)::integer as count from public.question_cache where word_id = $1::uuid',
            [WORD_ID]
        );
        assert.equal(cache.rows[0].count, 0);
        assert.equal(oldPublish.rows.length, 0, 'the old claim must not borrow the newer same-worker lease');
    } finally {
        await db.close();
    }
});


test('generation claim rotates users instead of draining an older bulk queue first', async () => {
    const db = await createDatabase();
    try {
        const secondUser = '99999999-9999-4999-8999-999999999999';
        await db.query('insert into public.users (id, username) values ($1, $2)', [secondUser, 'second-user']);
        for (let index = 1; index <= 4; index++) {
            const owner = index <= 2 ? USER_ID : secondUser;
            await db.query(
                'insert into public.words (id, user_id, word, meaning_en, level) values ($1, $2, $3, $4, $5)',
                [formalWordId(index), owner, ['apple', 'banana', 'cherry', 'peach'][index - 1], 'fruit', 'middle']
            );
        }
        await db.query('delete from public.question_generation_jobs where word_id = $1', [WORD_ID]);
        await db.exec(`update public.question_generation_jobs
            set next_attempt_at = case when user_id = '11111111-1111-4111-8111-111111111111' then now() - interval '8 days' else now() - interval '3 days' end`);
        const first = (await db.query("select * from public.claim_question_generation_jobs('worker-a', 1, 60000)")).rows[0];
        assert.equal(first.user_id, USER_ID);
        const second = (await db.query("select * from public.claim_question_generation_jobs('worker-b', 1, 60000)")).rows[0];
        assert.equal(second.user_id, secondUser, 'a second user must not wait for the first user entire backlog');
        assert.notEqual(first.id, second.id);
        assert.notEqual(first.lease_token, second.lease_token);
    } finally { await db.close(); }
});

test('generation claim spreads a batch across users while preserving due and version guards', async () => {
    const db = await createDatabase();
    try {
        const secondUser = '99999999-9999-4999-8999-999999999999';
        await db.query('insert into public.users (id, username) values ($1, $2)', [secondUser, 'second-user']);
        for (let index = 1; index <= 4; index++) {
            await db.query(
                'insert into public.words (id, user_id, word, meaning_en, level) values ($1, $2, $3, $4, $5)',
                [formalWordId(index), index <= 2 ? USER_ID : secondUser, ['apple', 'banana', 'cherry', 'peach'][index - 1], 'fruit', 'middle']
            );
        }
        await db.query('delete from public.question_generation_jobs where word_id = $1', [WORD_ID]);
        await db.exec(`update public.question_generation_jobs
            set next_attempt_at = case when user_id = '11111111-1111-4111-8111-111111111111' then now() - interval '8 days' else now() - interval '3 days' end`);
        const claimed = (await db.query("select * from public.claim_question_generation_jobs('worker-a', 2, 60000)")).rows;
        assert.equal(claimed.length, 2);
        assert.equal(new Set(claimed.map(row => row.user_id)).size, 2);
        await db.exec("update public.question_generation_jobs set next_attempt_at = now() + interval '1 day' where status = 'pending'");
        assert.equal((await db.query("select * from public.claim_question_generation_jobs('worker-b', 10, 60000)")).rows.length, 0);
    } finally { await db.close(); }
});

test('challenge demand advances long backoff once, preserves checkpoints, and wins within-user priority',async()=>{
 const db=await createDatabase();try{
  await db.query("select public.enqueue_question_generation_job_if_needed($1,$2,'cache_backfill')",[USER_ID,WORD_ID]);
  await db.query("update public.question_generation_jobs set status='retry_wait',attempt_count=22,next_attempt_at=now()+interval '1 hour',generation_checkpoint='{\"variants\":[{\"slot\":1,\"context\":\"saved context\"}]}'::jsonb where word_id=$1",[WORD_ID]);
  const second='33333333-3333-4333-8333-333333333333';await db.query("insert into public.words(id,user_id,word,meaning_en,level)values($1,$2,'pear','fruit','middle')",[second,USER_ID]);
  await db.query("update public.question_generation_jobs set next_attempt_at=now()-interval '1 day' where word_id=$1",[second]);
  const result=await db.query('select * from public.request_challenge_question_supply($1,$2::uuid[])',[USER_ID,[WORD_ID]]);
  assert.equal(result.rows[0].attempt_count,22);assert.equal(result.rows[0].generation_checkpoint.variants[0].context,'saved context');assert.ok(new Date(result.rows[0].next_attempt_at).getTime()<=Date.now());
  await db.query("update public.question_generation_jobs set next_attempt_at=now()+interval '30 minutes' where word_id=$1",[WORD_ID]);
  const repeated=await db.query('select * from public.request_challenge_question_supply($1,$2::uuid[])',[USER_ID,[WORD_ID]]);
  assert.ok(new Date(repeated.rows[0].next_attempt_at).getTime()>Date.now()+20*60000);
  await db.query("update public.question_generation_jobs set next_attempt_at=now() where word_id=$1",[WORD_ID]);
  const claimed=await db.query("select * from public.claim_question_generation_jobs('urgent-worker',1,60000)");assert.equal(claimed.rows[0].word_id,WORD_ID);
  const token=claimed.rows[0].lease_token;await db.query('select * from public.request_challenge_question_supply($1,$2::uuid[])',[USER_ID,[WORD_ID]]);
  const leased=await db.query('select * from public.question_generation_jobs where word_id=$1',[WORD_ID]);assert.equal(leased.rows[0].lease_token,token);assert.equal(leased.rows[0].status,'generating');
 }finally{await db.close();}
});
test('challenge demand rejects foreign or oversized requests and keeps RPC service-role only',async()=>{
 const db=await createDatabase();try{
  await assert.rejects(db.query('select * from public.request_challenge_question_supply($1,$2::uuid[])',[USER_ID,['99999999-9999-4999-8999-999999999999']]),/CHALLENGE_SELECTION_INVALID/);
  await assert.rejects(db.query('select * from public.request_challenge_question_supply($1,$2::uuid[])',[USER_ID,Array(11).fill(WORD_ID)]),/CHALLENGE_SELECTION_INVALID/);
  for(const role of ['anon','authenticated']){const r=await db.query("select has_function_privilege($1,'public.request_challenge_question_supply(uuid,uuid[])','EXECUTE') as allowed",[role]);assert.equal(r.rows[0].allowed,false);}
  await db.query("update public.words set mastery_status='mastered' where id=$1",[WORD_ID]);const r=await db.query('select * from public.request_challenge_question_supply($1,$2::uuid[])',[USER_ID,[WORD_ID]]);assert.equal(r.rows.length,0);
 }finally{await db.close();}
});

test('challenge demand preserves the edit fence and cross-user turn after urgent work',async()=>{
 const db=await createDatabase();try{
  await fenceWord(db);
  assert.equal((await db.query('select * from public.request_challenge_question_supply($1,$2::uuid[])',[USER_ID,[WORD_ID]])).rows.length,0);
  const fenced=(await db.query('select * from public.question_generation_jobs where word_id=$1',[WORD_ID])).rows[0];
  assert.equal(new Date(fenced.next_attempt_at).getUTCFullYear(),9999);
  await db.query('select * from public.finalize_word_question_generation_edit($1,$2)',[USER_ID,WORD_ID]);
  const otherUser='88888888-8888-4888-8888-888888888888';
  await db.query("insert into public.users(id,username)values($1,'other')",[otherUser]);
  await db.query("insert into public.words(id,user_id,word,meaning_en,level)values($1,$2,'pear','fruit','middle')",[formalWordId(91),otherUser]);
  await db.query('select * from public.request_challenge_question_supply($1,$2::uuid[])',[USER_ID,[WORD_ID]]);
  const first=(await db.query("select * from public.claim_question_generation_jobs('one',1,60000)")).rows[0];
  const second=(await db.query("select * from public.claim_question_generation_jobs('two',1,60000)")).rows[0];
  assert.equal(new Set([first.user_id,second.user_id]).size,2);
 }finally{await db.close();}
});


test('archive upgrade handles 52 mixed legacy and UUID IDs without relaxing ownership', async () => {
    const db = await createDatabase();
    try {
        await db.exec('alter table words add column if not exists feishu_record_id text');
        await db.query('update words set feishu_record_id=$1 where id=$2', ['rec-legacy-base', WORD_ID]);
        await db.query(`insert into words(id,user_id,word,meaning_en,level,feishu_record_id)
            select gen_random_uuid(),$1,'sample-'||n,'sample meaning','middle',
                case when n % 2 = 0 then 'rec-legacy-'||n else null end
            from generate_series(1,51) n`, [USER_ID]);
        const requested = (await db.query('select coalesce(feishu_record_id,id::text) as id from words where user_id=$1 order by id',[USER_ID])).rows.map(row=>row.id);
        assert.equal(requested.length,52);
        const oldMigration = MIGRATION_PATHS.find(file=>file.endsWith('20261012_parent_word_archive.sql'));
        const fixMigration = MIGRATION_PATHS.find(file=>file.endsWith('20261012_parent_word_archive_legacy_ids.sql'));
        await db.exec(await fs.readFile(oldMigration,'utf8'));
        assert.equal((await db.query(VERIFICATION_SQL)).rows[0].archive_words_legacy_id_lookup,false);
        await assert.rejects(db.query('select archive_words($1,$2::text[])',[USER_ID,requested]), /WORD_NOT_FOUND/);
        assert.equal((await db.query('select count(*)::int n from words where deleted_at is not null')).rows[0].n,0);
        await db.exec(await fs.readFile(fixMigration,'utf8'));
        assert.equal((await db.query(VERIFICATION_SQL)).rows[0].archive_words_legacy_id_lookup,true);
        const otherUser='99999999-1111-4111-8111-111111111111';
        await db.query('insert into users(id,username) values($1,$2)',[otherUser,'other-child']);
        await db.query("insert into words(id,user_id,word,meaning_en,level,feishu_record_id) values(gen_random_uuid(),$1,'outside','another child','middle','rec-foreign')",[otherUser]);
        await assert.rejects(db.query('select archive_words($1,$2::text[])',[USER_ID,[requested[0],'rec-foreign']]), /WORD_NOT_FOUND/);
        assert.equal((await db.query('select count(*)::int n from words where deleted_at is not null')).rows[0].n,0);
        assert.equal((await db.query('select archive_words($1,$2::text[]) result',[USER_ID,requested])).rows[0].result.deleted,52);
        await db.exec(await fs.readFile(fixMigration,'utf8'));
        assert.equal((await db.query('select archive_words($1,$2::text[]) result',[USER_ID,requested])).rows[0].result.deleted,0);
        assert.equal((await db.query('select count(*)::int n from active_words where user_id=$1',[USER_ID])).rows[0].n,0);
        assert.equal((await db.query('select count(*)::int n from active_words where user_id=$1',[otherUser])).rows[0].n,1);
    } finally { await db.close(); }
});

test('parent archive is atomic, repeatable, preserves formal history and excludes new supply', async () => {
    const db = await createDatabase();
    try {
        await db.exec('alter table words add column if not exists feishu_record_id text');
        await insertFormalWords(db);
        await db.query('update words set feishu_record_id=$1 where id=$2', ['rec-legacy-history', formalWordId(1)]);
        await insertFormalCacheRows(db);
        await db.query('select create_formal_quiz_challenge($1,$2,$3,$4::jsonb,$5)',
            [USER_ID, 'parent-archive-history', 'middle', JSON.stringify(formalChallengeQuestions()), FORMAL_NOW]);
        await insertFormalCacheRow(db,{index:1,cacheQuestionId:formalCacheId('0001',1),cacheState:'retired'});
        const before = await db.query('select question_snapshot from quiz_challenge_questions order by ordinal');
        await assert.rejects(db.query('select archive_words($1,$2::text[])', [USER_ID, [formalWordId(1), 'missing']]), /WORD_NOT_FOUND/);
        assert.equal((await db.query('select deleted_at from words where id=$1',[formalWordId(1)])).rows[0].deleted_at, null);
        const result = await db.query('select archive_words($1,$2::text[]) as result', [USER_ID, ['rec-legacy-history', formalWordId(2)]]);
        assert.equal(result.rows[0].result.deleted, 2);
        const again = await db.query('select archive_words($1,$2::text[]) as result', [USER_ID, [formalWordId(1), formalWordId(2)]]);
        assert.equal(again.rows[0].result.deleted, 0);
        assert.equal((await db.query('select count(*)::int as n from active_words where id=any($1::uuid[])',[[formalWordId(1),formalWordId(2)]])).rows[0].n, 0);
        assert.deepEqual((await db.query('select question_snapshot from quiz_challenge_questions order by ordinal')).rows, before.rows);
        assert.equal((await db.query('select cache_state from question_cache where id=$1',[formalCacheId('0000',1)])).rows[0].cache_state, 'retired');
        assert.equal((await db.query('select cache_state from question_cache where id=$1',[formalCacheId('0001',1)])).rows[0].cache_state, 'retired');
        assert.equal((await db.query('select count(*)::int as n from question_generation_jobs where word_id=any($1::uuid[])',[[formalWordId(1),formalWordId(2)]])).rows[0].n,0);
        assert.equal((await db.query('select enqueue_question_generation_job_if_needed($1,$2,$3) as ok',[USER_ID,formalWordId(1),'coverage_reconcile'])).rows[0].ok,false);
        await assert.rejects(db.query('select create_formal_quiz_challenge($1,$2,$3,$4::jsonb,$5)',
            [USER_ID, 'parent-archive-forbidden', 'middle', JSON.stringify(formalChallengeQuestions()), '2026-08-26T00:00:00Z']), /MEANING/);
        // Re-running the migration cannot restore a deleted word or reset its history.
        await db.exec(await fs.readFile(MIGRATION_PATHS[MIGRATION_PATHS.length - 1], 'utf8'));
        assert.equal((await db.query('select count(*)::int as n from active_words where id=$1',[formalWordId(1)])).rows[0].n,0);
        await db.exec('set role anon');
        await assert.rejects(db.query('select archive_words($1,$2::text[])',[USER_ID,[WORD_ID]]), /permission denied/);
        await assert.rejects(db.query('select * from active_words'), /permission denied/);
    } finally { await db.close(); }
});

test('archive rejects foreign IDs, fences an in-flight worker and permits fresh re-entry', async () => {
    const db = await createDatabase();
    try {
        const otherUser = '99999999-1111-4111-8111-111111111111';
        const otherWord = '99999999-2222-4222-8222-222222222222';
        await db.query('insert into users(id,username) values($1,$2)',[otherUser,'other-child']);
        await db.query("insert into words(id,user_id,word,meaning_en,level) values($1,$2,'apple','a fruit','middle')",[otherWord,otherUser]);
        await assert.rejects(db.query('select archive_words($1,$2::text[])',[USER_ID,[WORD_ID,otherWord]]),/WORD_NOT_FOUND/);
        assert.equal((await db.query('select deleted_at from words where id=$1',[WORD_ID])).rows[0].deleted_at,null);
        await fenceWord(db);
        await db.query('select finalize_word_question_generation_edit($1,$2)',[USER_ID,WORD_ID]);
        const claim = await db.query("select * from claim_question_generation_jobs('archive-worker',10,60000)");
        const job=claim.rows.find(row=>row.word_id===WORD_ID);
        assert.ok(job);
        await db.query('select archive_words($1,$2::text[])',[USER_ID,[WORD_ID]]);
        const stale=await db.query('select * from publish_question_generation_variants($1,$2,$3,$4,$5::jsonb)',[job.id,'archive-worker',job.word_version,job.lease_token,variantsJson()]);
        assert.equal(stale.rows.length,0);
        assert.equal((await db.query('select count(*)::int n from question_cache where word_id=$1',[WORD_ID])).rows[0].n,0);
        assert.equal((await db.query('select count(*)::int n from question_generation_jobs where word_id=$1',[WORD_ID])).rows[0].n,0);
        await db.query("insert into words(id,user_id,word,meaning_en,level) values($1,$2,'apple','a fruit','middle')",[formalWordId(99),USER_ID]);
        const active=await db.query("select id from active_words where user_id=$1 and word='apple'",[USER_ID]);
        assert.deepEqual(active.rows,[{id:formalWordId(99)}]);
        assert.equal((await db.query('select deleted_at from words where id=$1',[otherWord])).rows[0].deleted_at,null);
        const verified=(await db.query(VERIFICATION_SQL)).rows[0];
        for(const key of ['archive_words_column','archive_words_active_view','archive_words_challenge_guard','archive_words_claim_guard','archive_words_safe_search_path','rpc_archive_words_signature','rpc_archive_words_service_role_execute']) assert.equal(verified[key],true,key);
        for(const key of ['rpc_archive_words_public_execute','rpc_archive_words_anon_execute','rpc_archive_words_authenticated_execute']) assert.equal(verified[key],false,key);
    } finally {await db.close();}
});

test('practice single publication is fenced, additive and leaves the two-question publisher intact',async()=>{
 const db=await createDatabase();
 try{
  assert.ok((await db.query("select to_regprocedure('public.publish_question_generation_practice_variant(uuid,text,bigint,uuid,jsonb)') as rpc")).rows[0].rpc);
  const migration=MIGRATION_PATHS.find(p=>p.endsWith('20261025_practice_single_publication.sql'));
  await db.exec(await fs.readFile(migration,'utf8'));
  await db.query("select enqueue_question_generation_job_if_needed($1,$2,'cache_backfill')",[USER_ID,WORD_ID]);
  const job=(await db.query("select * from claim_question_generation_jobs('practice-worker',1,60000)")).rows[0];
  const options=['A. apple','B. pear','C. chair','D. book'],meanings=['苹果','梨','椅子','书'];
  const first={...JSON.parse(variantsJson())[0],question_text:'The farmer baked a pie with this sweet, red _____.',context_zh:'这个派所用的苹果来自那棵苹果树。',options,option_meanings:meanings,correct_meaning:'苹果',source_version:'supabase-contextual-variant-v3|unique-answer-v2|teaching-analysis-v1',
   teaching_analysis:{schemaVersion:1,clue:'sweet, red',clueReason:'甜的红色水果是句中给出的明确线索。',correctWord:'apple',correctReason:'苹果对应句中描述的甜的红色水果。',options:options.map((opt,i)=>({word:opt.slice(3),fits:i===0,meaning:meanings[i],reason:i===0?'苹果对应句中明确的苹果树来源。':'这个选项不是句中苹果树所结的果实。'}))}};
  const args=[job.id,'practice-worker',job.word_version,job.lease_token];
  const publish=(variants,overrides=[])=>db.query('select * from publish_question_generation_practice_variant($1,$2,$3,$4,$5::jsonb)',[...args.map((v,i)=>overrides[i]??v),JSON.stringify(variants)]);
  assert.equal((await publish([first],[undefined,'wrong-worker'])).rows.length,0);
  assert.equal((await publish([first],[undefined,undefined,job.word_version+1])).rows.length,0);
  await assert.rejects(publish([{...first,ai_audit_status:'pending'}]),/INVALID_VARIANT_STRUCTURE/);
  await assert.rejects(publish([{...first,teaching_analysis:null}]),/INVALID_VARIANT_STRUCTURE|question_cache_teaching_analysis_valid/);
  await assert.rejects(publish([first,first]),/EXACTLY_ONE_PRACTICE_VARIANT_REQUIRED/);
  const published=(await publish([first])).rows[0];assert.equal(published.published,1);assert.equal(published.retired,0);
  const rows=(await db.query('select * from question_cache where word_id=$1',[WORD_ID])).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].cache_state,'active');assert.deepEqual(rows[0].teaching_analysis,first.teaching_analysis);
  assert.equal((await db.query('select status from question_generation_jobs where id=$1',[job.id])).rows[0].status,'generating');
  const second={...first,question_fingerprint:'practice-different',question_text:'For lunch she packed the sweet, red _____ from the orchard.'};
  const before=(await db.query('select to_jsonb(c) as value from question_cache c where word_id=$1',[WORD_ID])).rows;
  assert.equal((await publish([second])).rows[0].published,0);
  assert.deepEqual((await db.query('select to_jsonb(c) as value from question_cache c where word_id=$1',[WORD_ID])).rows,before);
  await assert.rejects(db.query('select * from publish_question_generation_variants($1,$2,$3,$4,$5::jsonb)',[...args,JSON.stringify([first])]),/EXACTLY_TWO_VARIANTS_REQUIRED/);
  const {selectCachedQuestionsForWordQueue}=require('../quiz-word-queue');
  const mapped=rows.map(r=>({...r,user:'child',word:'apple',word_record_id:WORD_ID,context_cn:r.context_zh,level:'中学'}));
  assert.deepEqual(require('../question-cache').getCacheQuestionReadinessIssues(mapped[0]),[]);
  const selection={cacheRows:mapped,queue:[WORD_ID],userId:'child',level:'中学',limit:1};
  assert.equal(selectCachedQuestionsForWordQueue({...selection,requireReadyPair:false}).length,1);
  assert.equal(selectCachedQuestionsForWordQueue({...selection,requireReadyPair:true}).length,0);
  assert.equal((await db.query('select * from publish_question_generation_variants($1,$2,$3,$4,$5::jsonb)',[...args,JSON.stringify([first,second])])).rows[0].published,2);
  assert.equal((await db.query("select count(*)::int n from question_cache where word_id=$1 and cache_state in ('active','reserved_next_day')",[WORD_ID])).rows[0].n,2);
  const acl=(await db.query("select has_function_privilege('anon','public.publish_question_generation_practice_variant(uuid,text,bigint,uuid,jsonb)','execute') anon,has_function_privilege('authenticated','public.publish_question_generation_practice_variant(uuid,text,bigint,uuid,jsonb)','execute') authenticated,has_function_privilege('service_role','public.publish_question_generation_practice_variant(uuid,text,bigint,uuid,jsonb)','execute') service")).rows[0];
  assert.deepEqual(acl,{anon:false,authenticated:false,service:true});
  await db.query('update words set deleted_at=now() where id=$1',[WORD_ID]);
  assert.equal((await publish([first])).rows.length,0);
 }finally{await db.close();}
});
