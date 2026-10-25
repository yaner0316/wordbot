'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { MIGRATION_PATHS } = require('../scripts/apply-question-generation-migrations');

test('challenge demand survives waiting and is served before background replenishment', async t => {
  const db = new PGlite();
  const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const add = async (n, user, { demand = null, priority = null, updated = '2026-01-01', next = '2026-01-01', status = 'pending', lease = null, deleted = null, mastery = 'pending', version = 1 } = {}) => {
    await db.query('insert into words values ($1,$2,1,$3,$4,$5)', [id(n), id(user), `word`, mastery, deleted]);
    await db.query(`insert into question_generation_jobs(id,word_id,user_id,word_version,status,next_attempt_at,created_at,updated_at,demand_requested_at,demand_priority_until,lease_expires_at)
      values($1,$1,$2,$3,$4,$5,'2026-01-01',$6,$7,$8,$9)`, [id(n),id(user),version,status,next,updated,demand,priority,lease]);
  };
  const claim = async (limit = 1) => (await db.query("select * from claim_question_generation_jobs('test-worker',$1,60000)",[limit])).rows;
  const reset = () => db.exec('truncate question_generation_jobs, words');
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table words(id uuid primary key,user_id uuid,question_generation_version bigint,word text,mastery_status text,deleted_at timestamptz);
      create view active_words as select * from words where deleted_at is null;
      create table question_generation_jobs(id uuid primary key,word_id uuid,user_id uuid,word_version bigint,status text,attempt_count int default 0,
        next_attempt_at timestamptz,created_at timestamptz,updated_at timestamptz,demand_requested_at timestamptz,demand_priority_until timestamptz,
        lease_owner text,lease_expires_at timestamptz,lease_token uuid);`);
    let claimSql;
    for (const file of MIGRATION_PATHS) {
      const matches = fs.readFileSync(file,'utf8').match(/create or replace function public\.claim_question_generation_jobs\([\s\S]*?\n\$\$;/gi);
      if (matches) claimSql = matches.at(-1);
    }
    await db.exec(claimSql);
    await t.test('unclaimed request retains priority after the old two-minute window', async () => {
      await reset();
      await add(1,100);
      await add(2,100,{demand:'2026-02-01',priority:'2026-02-01T00:02:00Z',next:'2026-02-01'});
      assert.equal((await claim())[0].id,id(2));
    });
    await t.test('another accounts background job cannot precede an interactive demand', async () => {
      await reset();
      await add(1,100);
      await add(2,200,{demand:new Date().toISOString(),priority:new Date(Date.now()+60000).toISOString(),next:'2026-02-01'});
      assert.equal((await claim())[0].id,id(2));
    });
    await t.test('claimed demand is consumed and failed work follows normal retry timing', async () => {
      await reset();
      await add(1,100,{demand:'2026-02-01',priority:'2026-02-01T00:02:00Z',next:'2026-02-01'});
      await claim();
      await db.exec("update question_generation_jobs set status='retry_wait',next_attempt_at='2026-02-01',lease_owner=null,lease_expires_at=null");
      await add(2,100);
      assert.equal((await claim())[0].id,id(2));
      await db.exec("update question_generation_jobs set status='retry_wait',next_attempt_at=clock_timestamp()+interval '1 hour'");
      assert.deepEqual(await claim(),[]);
    });
    await t.test('demand does not bypass archive, mastery, version or live lease fences', async () => {
      await reset();
      const demand={demand:'2026-02-01',priority:'2026-02-01T00:02:00Z'};
      await add(1,100,{...demand,deleted:'2026-02-02'});
      await add(2,100,{...demand,mastery:'mastered'});
      await add(3,100,{...demand,version:2});
      await add(4,100,{...demand,status:'generating',lease:new Date(Date.now()+60000).toISOString()});
      assert.deepEqual(await claim(10),[]);
    });
    await t.test('all seven pending meanings are claimed once before an older background job', async () => {
      await reset();
      await add(1,100);
      for (let n=2;n<=8;n++) await add(n,100,{demand:'2026-02-01',priority:'2026-02-01T00:02:00Z',next:'2026-02-01'});
      const claimed=[];
      for(let n=0;n<7;n++) claimed.push((await claim())[0].id);
      assert.deepEqual(new Set(claimed),new Set(Array.from({length:7},(_,n)=>id(n+2))));
      assert.equal((await claim())[0].id,id(1));
    });
    await t.test('interactive users still alternate rather than draining one account first', async () => {
      await reset();
      const demand={demand:'2026-02-01',priority:'2026-02-01T00:02:00Z'};
      await add(1,100,demand);
      await add(2,100,demand);
      await add(3,200,demand);
      assert.equal((await claim())[0].id,id(1));
      assert.equal((await claim())[0].id,id(3));
      assert.equal((await claim())[0].id,id(2));
    });
  } finally { await db.close(); }
});
