'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {admitsGrammarDefect}=require('../audit-reason-consistency');
const {parseStemReview}=require('../question-semantic-audit');
const {hasCurrentStemReview}=require('../question-policy');
const {selectContextualDistractors}=require('../generate-distractors');
const {buildCacheQuestionRowsForWord}=require('../supabase-data');
const {approveAudit}=require('./current-policy-fixture');
const q={word:'seal',targetForm:'seal',targetMeaning:'海豹',level:'高中',context:'A _____ rested beside the pool.'};
function stem(reason){return {certain:true,checks:Object.fromEntries(['grammar','naturalness','sense','form','level','clue','burden'].map(k=>[k,{pass:true,evidence:'rested beside the pool',reason:k==='grammar'?reason:'证据来自完整原句，所述关系明确一致。'}]))};}
for(const reason of ['主语和被动谓语结构完整，so 引导的结果从句也完整，没有句子残缺或明显语法错误。','主语a seal与谓语rested搭配正确，两个完整句结构清晰，无残句或语法错误。']){
 test('negative grammar evidence is not a positive defect: '+reason,()=>{
  assert.equal(admitsGrammarDefect(reason),false);
  const result=parseStemReview(q,stem(reason));assert.equal(result.approved,true);assert.equal(hasCurrentStemReview(q,result),true);
 });
}
for(const reason of ['无残句，但有语法错误。','没有句子残缺或明显语法错误，但动词与主语不一致。','无残句或语法错误的说法不成立，原句存在语法错误。','无残句，语法不正确。']){
 test('a later affirmative defect still rejects: '+reason,()=>{
  assert.equal(admitsGrammarDefect(reason),true);assert.equal(parseStemReview(q,stem(reason)).approved,false);
 });
}
test('missing, invented, uncertain and explicit negative stem evidence still fail closed',()=>{
 for(const mutate of [r=>delete r.checks.clue,r=>r.checks.clue.evidence='invented clue',r=>r.certain=false,r=>r.checks.grammar.pass=false]){
  const r=stem('主语和谓语相互匹配，句子结构完整。');mutate(r);assert.equal(parseStemReview(q,r).approved,false);
 }
});
test('distractor rejection supplies concrete repair feedback without relaxing hard bans',async()=>{
 const rejections=[];let calls=0;
 const args={word:'suitcase',level:'高中',context:'She closed the _____.',hardExcludedDistractors:['backpack'],callLLM:async()=>{calls++;return '{"distractors":["Backpack","coat","ticket"]}';},onRejected:r=>rejections.push(r)};
 assert.equal(await selectContextualDistractors(args),null);assert.equal(calls,1);
 assert.equal(rejections[0]?.code,'forbidden_distractor');assert.deepEqual(rejections[0]?.options,['Backpack']);
});
function args(cp={variants:[]}){return {user:{id:'u'},word:{id:'w',word:'skins',meaning_zh:'兽皮',context_en:'They wore skins during the cold winter.'},level:'中学',requiredCount:1,generationCheckpoint:cp,saveGenerationCheckpoint:async()=>{},
 generateContext:async()=>'',generateDistractors:async()=>['wool','cotton','silk'],translateWords:async words=>Object.fromEntries(words.map(w=>[w,({'wool':'羊毛','cotton':'棉花','silk':'丝绸','cotton cloth':'棉布','wool coats':'羊毛外套','silk scarves':'丝绸围巾'})[w]])),
 translateContext:async()=> '在寒冷的冬天他们穿着兽皮。',semanticAudit:approveAudit,requireSemanticAudit:true};}
test('allowed natural phrase distractors survive builder normalization and reach review',async()=>{
 const a=args();a.generateDistractors=async()=>['cotton cloth','wool coats','silk scarves'];let audited=false;
 a.semanticAudit=async q=>{audited=true;assert.ok(q.options.some(o=>o.endsWith('cotton cloth')));return approveAudit(q);};
 const rows=await buildCacheQuestionRowsForWord(a);assert.equal(audited,true);assert.equal(rows.length,1);
});
test('outer retry sends exact previous failure to the next distractor attempt',async()=>{
 const cp={variants:[],hardExcludedDistractors:['hides']},a=args(cp);let calls=0;
 a.generateDistractors=async input=>{calls++;if(calls===1){input.onRejected?.({code:'forbidden_distractor',options:['Hides']});return null;}
 assert.deepEqual(input.retryFeedback,[{code:'forbidden_distractor',options:['Hides']}]);return ['wool','cotton','silk'];};
 assert.equal((await buildCacheQuestionRowsForWord(a)).length,1);assert.equal(calls,2);
});
test('exhausted option attempts retain approved stem and sibling instead of regenerating context',async()=>{
 const context='They wore skins during the cold winter.',sq={word:'skins',targetMeaning:'兽皮',level:'中学',context:'They wore _____ during the cold winter.',targetForm:'skins'};
 const proof=parseStemReview(sq,{certain:true,checks:Object.fromEntries(['grammar','naturalness','sense','form','level','clue','burden'].map(k=>[k,{pass:true,evidence:'during the cold winter',reason:'证据来自原句，表达完整且对应给定词义。'}]))});
 const sibling={slot:1,row:{id:'existing-approved'},context:'Existing approved sibling.'};
 const cp={policyVersion:'context-learning-v3',variants:[sibling,{slot:2,context,targetForm:'skins',stemReview:proof}]};const a=args(cp);let contexts=0,options=0;
 a.semanticAudit=Object.assign(async q=>approveAudit(q),{questionPolicy:'context-learning-v3',auditStem:async()=>{throw Error('approved stem re-reviewed');}});
 a.generateContext=async()=>{contexts++;return context;};a.generateDistractors=async()=>{options++;return null;};
 assert.deepEqual(await buildCacheQuestionRowsForWord(a),[]);assert.equal(options,3);assert.equal(contexts,0);
 assert.deepEqual(cp.variants[0],sibling);assert.deepEqual(cp.variants[1].stemReview,proof);assert.equal(cp.variants[1].context,context);
});
