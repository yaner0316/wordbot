const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const sql = name => fs.readFileSync(path.join(__dirname, '../migrations', name), 'utf8');
test('custom challenge transaction persists a complete short quiz and enforces display cooldown, ownership and audit', async () => {
  const db = new PGlite();
  const user = '00000000-0000-0000-0000-000000000001';
  const word = '00000000-0000-0000-0000-000000000002';
  const cache = '00000000-0000-0000-0000-000000000003';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table users(id uuid primary key);
      create table words(id uuid primary key,user_id uuid,entered_at timestamptz,mastery_status text);
      create table question_cache(id uuid primary key,user_id uuid,word_id uuid,quality_status text,cache_state text,available_from timestamptz,question_type text,ai_audit_status text,level text);
      insert into users values('${user}');
      insert into words values('${word}','${user}','2026-10-05T11:59:00Z','pending');
      insert into question_cache values('${cache}','${user}','${word}','ready','active',null,'1','approved','中学');`);
    await db.exec(sql('20260807_formal_quiz_challenges.sql'));
    await db.exec(sql('20261005_custom_challenges.sql'));
    await db.exec(sql('20261005_custom_challenges.sql'));
    const question = {meaning_id:word,cache_question_id:cache,stem:'A fresh _____ here.',challengeSize:1};
    const create = (id, q=question, now='2026-10-05T12:00:00Z') => db.query('select create_formal_quiz_challenge($1,$2,$3,$4::jsonb,$5) as result',[user,id,'中学',JSON.stringify([q]),now]);
    await assert.rejects(create('real-truncated',{...question,challengeSize:3}),/COUNT_INVALID/);
    await assert.rejects(create('real-first-too-soon'), /MEANING_COOLDOWN/);
    await db.exec("update words set entered_at='2026-10-04T18:00:00Z'");
    const created = await create('real-short');
    assert.equal(created.rows[0].result.question_count,1);
    assert.equal((await db.query('select count(*)::int as n from quiz_display_events')).rows[0].n,1);
    await assert.rejects(create('real-too-soon'),/DISPLAY_COOLDOWN/);
    await assert.rejects(create('real-reused', question,'2026-10-06T06:00:00Z'),/STEM_REUSED/);
    await db.exec("update question_cache set ai_audit_status='pending'");
    await assert.rejects(create('real-unapproved',{...question,stem:'Different _____ here.'},'2026-10-06T06:00:00Z'),/AI_AUDIT_REQUIRED/);
    assert.equal((await db.query('select count(*)::int as n from quiz_challenges')).rows[0].n,1);
  } finally { await db.close(); }
});
