'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeLevel,isPrimaryLevel}=require('../learning-level');
const {selectContextualDistractors}=require('../generate-distractors');
const {getQuestionQualityIssues}=require('../question-quality');
const {normalizeGenerationCheckpoint}=require('../question-generation-checkpoint');

test('primary bands retain the existing upper-primary storage value',()=>{
 assert.equal(normalizeLevel('小学高年级'),'小学');
 assert.equal(normalizeLevel('小学低年级'),'小学低年级');
 assert.equal(isPrimaryLevel('小学低年级'),true);
});
test('phrases, cross-POS and synonymous wrong options are permitted candidates',async()=>{
 let prompt; const result=await selectContextualDistractors({word:'confess',meaning:'坦白',level:'中学',context:'I must _____ that I broke the glass.',candidates:['success'],callLLM:async p=>{prompt=p;return JSON.stringify({distractors:['success','keep quiet','stay silent']});}});
 assert.deepEqual(result,['success','keep quiet','stay silent']);
 assert.doesNotMatch(prompt,/same part of speech\.|never a phrase|meaning must not repeat/i);
 const issues=getQuestionQualityIssues({type:1,level:'中学',word:'confess',context:'I must _____ that I broke the glass.',answer:'A',options:['A. confess','B. success','C. keep quiet','D. stay silent'],optionMeanings:['坦白','成功','保持沉默','保持沉默']});
 assert.ok(!issues.includes('bad_distractor_shape')); assert.ok(!issues.includes('overlapping_option_meanings'));
});
test('old checkpoints cannot restore rejected-policy proofs or lexical bans',()=>{
 const input={word:'confess',meaning:'坦白',level:'中学',wordVersion:1};
 const result=normalizeGenerationCheckpoint({...input,variants:[{context:'old',audit:{approved:true}}],hardExcludedDistractors:['success']},input);
 assert.deepEqual(result.variants,[]);assert.equal(result.hardExcludedDistractors,undefined);assert.ok(result.policyVersion);
});

test('environment downgrade cannot admit an old ready cache or a stale proof',()=>{
 const {attestRow}=require('./current-policy-fixture');const {hasCurrentQuestionPolicy}=require('../question-policy');
 const {getCacheQuestionReadinessIssues}=require('../question-cache');const old=process.env.WORDBOT_REQUIRE_AI_AUDIT;
 try{process.env.WORDBOT_REQUIRE_AI_AUDIT='0';assert.ok(getCacheQuestionReadinessIssues({question_type:1,quality_status:'ready',ai_audit_status:'approved',source_version:'unique-answer-v2'}).includes('question_policy_retired'));}finally{if(old===undefined)delete process.env.WORDBOT_REQUIRE_AI_AUDIT;else process.env.WORDBOT_REQUIRE_AI_AUDIT=old;}
 const row=attestRow({word:'apple',level:'中学',question_text:'She picked an _____ from the tree.',context_zh:'她从树上摘了一个苹果。',options:['A. apple','B. desk','C. chair','D. road'],answer:'A',option_meanings:['苹果','书桌','椅子','道路'],correct_meaning:'苹果'});
 assert.equal(hasCurrentQuestionPolicy(row),true);assert.equal(hasCurrentQuestionPolicy({...row,word:'Apple'}),true);
 assert.equal(hasCurrentQuestionPolicy({...row,source_version:'unique-answer-v2'}),false);
 assert.equal(hasCurrentQuestionPolicy({...row,question_text:'A changed _____ sentence.'}),false);
 const bad=structuredClone(row);bad.teaching_analysis.stemReview.checks.grammar.pass=false;assert.equal(hasCurrentQuestionPolicy(bad),false);
});
