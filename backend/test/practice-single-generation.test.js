'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createQuestionGenerationService,fingerprintQuestion}=require('../question-generation-service');
const runtime=require('../question-generation-runtime');
const word={id:'w',user_id:'u',word:'bank',level:'中学',word_version:1};
const job={id:'job',word_id:'w',user_id:'u',word_version:1,lease_token:'lease',lease_owner:'worker'};
const row=(text='She deposited cash at the _____.')=>({question_text:text,options:['bank','shore','desk','road'],answer:'A',question_fingerprint:fingerprintQuestion({question_text:text},'w'),ai_audit_status:'approved'});
const checkpoint=variant=>({word:'bank',level:'中学',wordVersion:1,meaning:'["",""]',variants:[{slot:1,row:variant}]});

test('a saved approved first question is published before a second-question provider failure',async()=>{
 const events=[];const first=row();let saved;
 const service=createQuestionGenerationService({loadWord:async()=>word,validateCandidate:()=>[],saveCheckpoint:async({checkpoint})=>{saved=checkpoint;events.push('saved');},
  beforePublish:async()=>events.push('renew'),publishPracticeVariant:async({variants})=>{assert.equal(variants.length,1);assert.equal(variants[0].question_fingerprint,first.question_fingerprint);events.push('practice');},
  generateCandidates:async({saveGenerationCheckpoint})=>{await saveGenerationCheckpoint(checkpoint(first));throw Object.assign(Error('limited'),{code:'MINIMAX_RATE_LIMITED'});},
  publishReadyVariants:async()=>assert.fail('one question must not complete a pair'),
 });
 await assert.rejects(service.process(job),e=>e.code==='MINIMAX_RATE_LIMITED');
 assert.deepEqual(events,['saved','renew','practice']);assert.equal(saved.variants[0].row.question_fingerprint,first.question_fingerprint);
});

test('a restored single is made available and the existing job still needs its second variant',async()=>{
 let singles=0,pairs=0;
 const service=createQuestionGenerationService({loadWord:async()=>word,loadCheckpoint:async()=>checkpoint(row()),validateCandidate:()=>[],
  publishPracticeVariant:async()=>{singles++;},generateCandidates:async({requiredCount})=>{assert.equal(singles,1);assert.equal(requiredCount,1);return[];},publishReadyVariants:async()=>{pairs++;},maxAttempts:1});
 await assert.rejects(service.process(job),e=>e.code==='INSUFFICIENT_DISTINCT_READY_VARIANTS'&&e.readyCount===1);
 assert.equal(singles,1);assert.equal(pairs,0);
});

test('invalid, outdated and already displayed checkpoint rows never publish for practice',async()=>{
 for(const reason of ['quality','outdated','displayed']){
  const first=row();let singles=0;
  const service=createQuestionGenerationService({loadWord:async()=>({...word,excludedQuestionStems:reason==='displayed'?[first.question_text]:[]}),loadCheckpoint:async()=>checkpoint(first),
   validateCandidate:()=>reason==='quality'?['ai_audit_not_approved']:[],requiredAuditMethod:reason==='outdated'?'current-audit':null,
   publishPracticeVariant:async()=>{singles++;},generateCandidates:async()=>[],publishReadyVariants:async()=>assert.fail(),maxAttempts:1});
  await assert.rejects(service.process(job),e=>e.code==='INSUFFICIENT_DISTINCT_READY_VARIANTS');assert.equal(singles,0);
 }
});

test('a failed practice publication stops generation and preserves the checkpoint for retry',async()=>{
 let generated=0;
 const service=createQuestionGenerationService({loadWord:async()=>word,loadCheckpoint:async()=>checkpoint(row()),validateCandidate:()=>[],
  publishPracticeVariant:async()=>{throw Object.assign(Error('stale'),{code:'JOB_LEASE_NOT_OWNED_OR_STALE'});},generateCandidates:async()=>{generated++;return[];},publishReadyVariants:async()=>assert.fail()});
 await assert.rejects(service.process(job),e=>e.code==='JOB_LEASE_NOT_OWNED_OR_STALE');assert.equal(generated,0);
});

test('single publisher uses its own fenced RPC while the original publisher still refuses one',async()=>{
 assert.equal(typeof runtime.createSupabasePracticeVariantPublisher,'function');
 const calls=[];const client={from:()=>{},rpc:async(name,args)=>{calls.push({name,args});return{data:[{published:1,retired:0,fingerprints:[row().question_fingerprint]}],error:null};}};
 const publish=runtime.createSupabasePracticeVariantPublisher({client,workerId:'worker'});
 await publish({job,variants:[row()]});
 assert.equal(calls[0].name,'publish_question_generation_practice_variant');assert.equal(calls[0].args.p_lease_token,'lease');assert.equal(calls[0].args.p_expected_word_version,1);
 await assert.rejects(publish({job,variants:[row(),row('A second _____.')]}));
 await assert.rejects(runtime.createSupabaseReadyVariantPublisher({client,workerId:'worker'})({job,variants:[row()]}),e=>e.code==='EXACTLY_TWO_READY_VARIANTS_REQUIRED');
 assert.equal(calls.length,1);
});
