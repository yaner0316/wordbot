'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildOptionMeanings,createSupabaseDataAdapter}=require('../supabase-data');
const {translateSupabaseWords}=require('../supabase-translations');
const {contentReviewPrompt,hasCurrentContentReview,CONTENT_REVIEW_POLICY}=require('../question-content-review');
const {attestRow}=require('./current-policy-fixture');
const {normalizeGenerationCheckpoint}=require('../question-generation-checkpoint');
const {QUESTION_POLICY}=require('../question-policy');
const q={level:'中学',context:'We decided to _____ a coin.',contextCN:'我们决定抛一枚硬币。',options:['A. spend','B. collect','C. slap','D. toss'],answer:'D',optionMeanings:['花费','收集','拍打','抛硬币'],targetMeaning:'抛硬币'};
test('formal option glossary generation receives the exact stem and selected sense through the data adapter',async()=>{
 let prompt;
 const adapter=createSupabaseDataAdapter({from:()=>{throw Error('no database');}},{translateWords:(words,options)=>translateSupabaseWords(words,{...options,request:async p=>{prompt=p;return JSON.stringify({spend:'花费',collect:'收集',slap:'拍打'});}})});
 const values=await buildOptionMeanings({optionWords:['spend','collect','slap','toss'],correctWord:'toss',correctMeaning:q.targetMeaning,context:q.context,translateWords:adapter.translateWords});
 assert.deepEqual(values,q.optionMeanings);
 assert.ok(prompt.includes(q.context),'translation must see the exact blanked context');
 assert.ok(prompt.includes(q.targetMeaning),'selected sense must be supplied');
 for(const p of [prompt,contentReviewPrompt(q)]){
  for(const example of ['had protected them','slap a coin','success','受保护的','扇耳光','成功（名词）'])assert.ok(p.includes(example),example);
 }
});
test('v2 translation evidence cannot approve, even when the input fingerprint still matches',()=>{
 const e=attestRow(q).teaching_analysis.contentReview;
 assert.equal(CONTENT_REVIEW_POLICY,'question-content-v3');
 assert.equal(hasCurrentContentReview(q,e),true);
 assert.equal(hasCurrentContentReview(q,{...e,policy:'question-content-v2'}),false);
});
test('retiring translation artifacts preserves fixed English and upstream proofs',()=>{
 const variant={context:q.context,options:q.options,optionWords:['spend','collect','slap','toss'],answer:q.answer,stemReview:{approved:true},optionReview:{approved:true},contextTranslation:q.contextCN,optionMeanings:['花费','收集','扇耳光','抛硬币'],optionMeaningsPolicy:'question-content-v2',audit:{approved:true},row:{}};
 const input={word:'toss',meaning:'抛硬币',level:'中学',wordVersion:1};
 const cp=normalizeGenerationCheckpoint({...input,policyVersion:QUESTION_POLICY,variants:[variant]},input);
 for(const field of ['context','options','optionWords','answer','stemReview','optionReview','contextTranslation'])assert.deepEqual(cp.variants[0][field],variant[field]);
 for(const field of ['optionMeanings','audit','row'])assert.equal(cp.variants[0][field],undefined,field);
});
