const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const sql=name=>fs.readFileSync(path.join(__dirname,'../migrations',name),'utf8');
test('practice display preserves formal cooldown and new-stem rules while retaining ownership and quality gates',async()=>{
 const db=new PGlite();
 const user='00000000-0000-0000-0000-000000000001',word='00000000-0000-0000-0000-000000000002',cache='00000000-0000-0000-0000-000000000003';
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create table users(id uuid primary key);
   create table words(id uuid primary key,user_id uuid,entered_at timestamptz,mastery_status text,deleted_at timestamptz);
   create view active_words as select * from words where deleted_at is null;
   create table question_cache(id uuid primary key,user_id uuid,word_id uuid,quality_status text,cache_state text,available_from timestamptz,question_type text,ai_audit_status text,level text);
   insert into users values('${user}');
   insert into words values('${word}','${user}','2026-10-13T11:00:00Z','pending',null);
   insert into question_cache values('${cache}','${user}','${word}','ready','active',null,'1','approved','中学');`);
  await db.exec(sql('20260807_formal_quiz_challenges.sql'));
  await db.exec(sql('20261005_custom_challenges.sql'));
  const migration=path.join(__dirname,'../migrations/20261013_custom_practice.sql');
  await db.exec(fs.readFileSync(migration,'utf8'));await db.exec(fs.readFileSync(migration,'utf8'));
  const create=(id,stem='A fresh _____ here.')=>db.query('select create_formal_quiz_challenge($1,$2,$3,$4::jsonb,$5) as result',[user,id,'中学',JSON.stringify([{meaning_id:word,cache_question_id:cache,stem,challengeSize:1}]),'2026-10-13T12:00:00Z']);
  const practice=await create('practice-first');
  assert.equal(practice.rows[0].result.mode,'practice');
  assert.equal((await db.query('select counts_for_cooldown from quiz_display_events')).rows[0].counts_for_cooldown,false);
  await assert.rejects(create('real-too-soon','A different _____ here.'),/MEANING_COOLDOWN/);
  await db.exec("update words set entered_at='2026-10-11T12:00:00Z'");
  await assert.rejects(create('real-seen'),/STEM_REUSED/);
  await create('real-fresh','A different _____ here.');
  await create('practice-repeat');
  await db.exec("update question_cache set ai_audit_status='pending'");
  await assert.rejects(create('practice-unapproved'),/AI_AUDIT_REQUIRED/);
  await db.exec("update question_cache set ai_audit_status='approved';update words set deleted_at=now()");
  await assert.rejects(create('practice-archived'),/MEANING_COOLDOWN/);
 }finally{await db.close();}
});
