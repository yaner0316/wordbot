'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const audit=require('../question-semantic-audit');
const question={word:'confess',level:'中学',targetMeaning:'坦白',context:'I must _____ that I broke the glass.',options:['A. confess','B. success','C. deny','D. refuse'],answer:'A',optionMeanings:['坦白','成功','否认','拒绝'],contextCN:'我必须坦白是我打碎了玻璃杯。',requireContentReview:true};
const reason='句中明确指出承认自己打碎杯子的事实。';
function stem(){return {certain:true,checks:Object.fromEntries(['grammar','naturalness','sense','form','level','clue','burden'].map(key=>[key,{pass:true,evidence:'I broke the glass',reason}]))};}
function options(){return {certain:true,semanticDiscrimination:true,optionJudgments:['confess','success','deny','refuse'].map((word,i)=>({letter:'ABCD'[i],word,fits:i===0,grammatical:i!==1,wordValid:true,levelSuitable:true,exclusion:i===0?'none':i===1?'grammar':'contradiction',addedPremises:[],clueIndex:1,meaning:question.optionMeanings[i],reason:i===1?'success是正确的名词，但此处需要动词。':reason}))};}
function translation(){return {contentReview:{targetSense:{providedPartsOfSpeech:['verb'],contextualPartOfSpeech:'verb',matches:true,contextualSense:'坦白',reason},translation:{text:question.contextCN,accurate:true,reason},optionMeanings:question.optionMeanings.map((meaning,i)=>({letter:'ABCD'[i],meaning,accurate:true,reason}))}};}
test('three audits have distinct inputs and exactly one blind uniqueness call',async()=>{
 const prompts=[],responses=[stem(),options(),translation()];
 const result=await audit.auditUniqueAnswer(question,{callModel:async p=>{prompts.push(p);return JSON.stringify(responses.shift());}});
 assert.equal(result.approved,true);assert.equal(prompts.length,3);
 assert.match(prompts[0],/STEM REVIEW/);assert.match(prompts[1],/No intended answer/);assert.doesNotMatch(prompts[1],/"answer"|"targetMeaning"|"contextCN"/);
 assert.match(prompts[2],/TRANSLATION REVIEW/);assert.doesNotMatch(prompts.join('\n'),/CRITICAL EXCLUSION CHECK|ALL SIX option pairs|All four options must be grammatically usable/);
});
test('bad stem stops before options; uncertain/inconsistent evidence cannot pass',async()=>{
 let calls=0;const bad=stem();bad.checks.grammar.pass=false;
 const result=await audit.auditUniqueAnswer(question,{callModel:async()=>{calls++;return JSON.stringify(bad);}});
 assert.equal(result.approved,false);assert.equal(result.code,'surface_context');assert.equal(calls,1);
});
test('cross-POS is allowed but fabricated words and grammar-only puzzles are rejected',async()=>{
 for(const change of [e=>e.optionJudgments[1].wordValid=false,e=>e.semanticDiscrimination=false]){
  const e=options();change(e);const result=await audit.auditOptions(question,{callModel:async()=>JSON.stringify(e)});assert.equal(result.approved,false);
 }
});
test('translation rejection preserves exact evidence for repair',async()=>{
 const e=translation();e.contentReview.translation.accurate=false;e.contentReview.translation.reason='译文添加了英文没有说明的动作和因果关系。';
 const result=await audit.auditTranslation(question,{callModel:async()=>JSON.stringify(e)});
 assert.equal(result.code,'content_translation');assert.match(result.reason,/添加/);assert.ok(result.repairEvidence.length);
});
module.exports={question,stem,options,translation};

test('translation approval cannot contradict an explicit defect admission',async()=>{
 const e=translation();e.contentReview.translation.reason='译文添加了英文没有说明的动作和因果关系。';
 assert.equal((await audit.auditTranslation(question,{callModel:async()=>JSON.stringify(e)})).approved,false);
 e.contentReview.translation.reason='译文没有误译，准确保留英文的人物与动作。';
 assert.equal((await audit.auditTranslation(question,{callModel:async()=>JSON.stringify(e)})).approved,true);
});
