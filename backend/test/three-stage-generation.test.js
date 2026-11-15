'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildCacheQuestionRowsForWord}=require('../supabase-data');
const audits=require('../question-semantic-audit');
const {attestRow}=require('./current-policy-fixture');
const {hasCurrentQuestionPolicy,QUESTION_POLICY}=require('../question-policy');
const reason='审核根据当前输入逐项记录了具体判断依据。';
test('formal assembly follows three-stage order and translation repair reuses only valid upstream proofs',async()=>{
 const calls=[],checkpoint={variants:[]};let rejectTranslation=true,repairReceived;
 const word={id:'w',word:'apple',meaning_zh:'苹果',context_en:'She picked an apple from the apple tree.'};
 // Avoid target repetition: the clue still supplies a concrete fruit context in this pipeline fixture.
 word.context_en='She picked an apple with red skin and white flesh.';
 const semanticAudit=async q=>audits.auditUniqueAnswer(q,{callModel:async()=>{
  calls.push('translation_review');
  const c=attestRow(q).teaching_analysis.contentReview;
  return JSON.stringify({contentReview:{...c,translation:{...c.translation,accurate:!rejectTranslation,reason:rejectTranslation?'译文把红色外皮错误地译成绿色外皮。':reason},optionMeanings:c.optionMeanings.map(({word,...item})=>({...item,letter:'ABCD'[q.options.findIndex(o=>o.slice(3)===word)]}))}});
 }});
 Object.assign(semanticAudit,{...audits.auditUniqueAnswer,
  auditStem:async q=>{calls.push('stem_review');return audits.parseStemReview(q,{certain:true,checks:Object.fromEntries(['grammar','naturalness','sense','form','level','clue','burden'].map(k=>[k,{pass:true,evidence:'red skin and white flesh',reason}]))});},
  auditOptions:async q=>{calls.push('options_review');return audits.auditOptions(q,{callModel:async()=>JSON.stringify({certain:true,semanticDiscrimination:true,optionJudgments:q.options.map((o,i)=>({letter:'ABCD'[i],word:o.slice(3),fits:'ABCD'[i]===q.answer,grammatical:true,wordValid:true,levelSuitable:true,exclusion:'ABCD'[i]===q.answer?'none':'contradiction',addedPremises:[],clueIndex:1,meaning:o.slice(3)==='apple'?'苹果':'候选词',reason}))})});}
 });
 const args={user:{id:'u'},word,level:'中学',requiredCount:1,generationCheckpoint:checkpoint,semanticAudit,requireSemanticAudit:true,
  generateContext:async()=>{assert.fail('valid saved stem must be reused');},
  generateDistractors:async()=>{calls.push('distractors');return ['pear','book','chair'];},
  translateWords:async(words,options)=>{calls.push('glosses');assert.equal(options.context,'She picked an _____ with red skin and white flesh.');assert.equal(options.correctMeaning,'苹果');return {pear:'梨',book:'书',chair:'椅子'};},
  translateContext:async(s,repair)=>{calls.push('translation');repairReceived=repair;return rejectTranslation?'她摘了一个有绿色外皮和白色果肉的苹果。':'她摘了一个有红色外皮和白色果肉的苹果。';},
 };
 assert.deepEqual(await buildCacheQuestionRowsForWord(args),[]);
 assert.deepEqual(calls,['stem_review','distractors','options_review','glosses','translation','translation_review']);
 assert.equal(checkpoint.policyVersion,QUESTION_POLICY);assert.ok(checkpoint.variants[0].stemReview.approved);assert.ok(checkpoint.variants[0].optionReview.approved);
 rejectTranslation=false;calls.length=0;
 const rows=await buildCacheQuestionRowsForWord(args);
 assert.deepEqual(calls,['translation','translation_review']);assert.equal(rows.length,1);
 assert.match(repairReceived.previousTranslation,/绿色/);assert.match(repairReceived.repairFeedback[0].reason,/绿色/);
 assert.equal(hasCurrentQuestionPolicy({...rows[0],word:'apple'}),true);
 assert.equal(hasCurrentQuestionPolicy({...rows[0],word:'apple',context_zh:'另一句译文'}),false);
 assert.equal(hasCurrentQuestionPolicy({...rows[0],word:'apple',source_version:'unique-answer-v2'}),false);
 const fixed=({question_text,options,answer})=>({question_text,options,answer});
 // An unversioned glossary from the previous generator must be regenerated,
 // but the approved English stages and sentence translation remain reusable.
 delete checkpoint.variants[0].optionMeaningsPolicy;
 checkpoint.variants[0].audit.teachingAnalysis.contentReview.policy='question-content-v2';
 calls.length=0;
 const refreshed=await buildCacheQuestionRowsForWord(args);
 assert.deepEqual(calls,['glosses','translation_review']);
 assert.deepEqual(fixed(refreshed[0]),fixed(rows[0]));
 assert.equal(refreshed[0].teaching_analysis.contentReview.policy,'question-content-v3');
});
