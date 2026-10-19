const test=require('node:test'),assert=require('node:assert/strict');
const {auditUniqueAnswer}=require('../question-semantic-audit');
const {getTeachingAnalysisIssues}=require('../teaching-analysis');
const q={context:'We observed an _____ using its trunk to drink water.',options:['A. rhinoceros','B. elephant','C. hippopotamus','D. buffalo'],answer:'B',optionMeanings:['犀牛','大象','河马','水牛']};
function reply(fits=[false,true,false,false]){return {certain:true,optionJudgments:q.options.map((o,i)=>({letter:'ABCD'[i],fits:fits[i],exclusion:fits[i]?'none':'contradiction',clue:'using its trunk',meaning:q.optionMeanings[i],reason:fits[i]?'大象具有长鼻子，能够完成句中的饮水动作。':'这种动物没有长鼻子，无法完成句中用长鼻子饮水的动作。'}))};}
test('complete-sentence judgments derive the unique answer without a suggested answer letter',async()=>{let prompt;const result=await auditUniqueAnswer(q,{callModel:async p=>{prompt=p;return JSON.stringify(reply());}});assert.equal(result.approved,true);assert.deepEqual(result.validLetters,['B']);assert.equal(result.auditMethod,'blind-completion-v2');assert.match(prompt,/We observed an elephant using its trunk/);assert.ok(!prompt.includes('expectedAnswer'));assert.deepEqual(getTeachingAnalysisIssues(q,result.teachingAnalysis),[]);});
test('all plausible completions reject a best-answer claim',async()=>{const result=await auditUniqueAnswer(q,{callModel:async()=>JSON.stringify({...reply([true,true,true,true]),validLetters:['B']})});assert.equal(result.approved,false);assert.deepEqual(result.validLetters,['A','B','C','D']);});
test('a less-likely exclusion or fabricated quote cannot establish uniqueness',async()=>{for(const change of [{exclusion:'less_likely'},{clue:'not present in this sentence'},{fits:true,exclusion:'contradiction'}]){const r=reply();Object.assign(r.optionJudgments[0],change);assert.equal((await auditUniqueAnswer(q,{callModel:async()=>JSON.stringify(r)})).approved,false);}});
test('audit evidence is bound to the actual sentence and option identity, not shuffled letters',async()=>{const result=await auditUniqueAnswer(q,{callModel:async()=>JSON.stringify(reply())});assert.equal(result.approved,true);const shuffled={...q,options:['A. elephant','B. buffalo','C. rhinoceros','D. hippopotamus'],answer:'A'};assert.deepEqual(getTeachingAnalysisIssues(shuffled,result.teachingAnalysis),[]);for(const change of [{context:'We saw an _____ in a park.'},{options:['A. giraffe',...q.options.slice(1)]},{answer:'C'}])assert.ok(getTeachingAnalysisIssues({...q,...change},result.teachingAnalysis).includes('semantic_audit_input_changed'));});
test('uncertain or mismatched independent judgments never approve',async()=>{for(const r of [{...reply(),certain:false},{...reply(),optionJudgments:reply().optionJudgments.slice(0,3)},{...reply(),validLetters:['A']}])assert.equal((await auditUniqueAnswer(q,{callModel:async()=>JSON.stringify(r)})).approved,false);});

test('fragment indexes cite the original sentence without inventing an expanded quote',async()=>{const r=reply();r.optionJudgments=r.optionJudgments.map(({clue,...j})=>({...j,clueIndex:1}));const result=await auditUniqueAnswer(q,{callModel:async()=>JSON.stringify(r)});assert.equal(result.approved,true);assert.equal(result.teachingAnalysis.clue,'using its trunk to drink water.');});

test('fitting completions need explicit evidence too; null indexes fail closed',async()=>{
 const r=reply();r.optionJudgments=r.optionJudgments.map(({clue,...j})=>({...j,clueIndex:j.fits?null:1}));
 const result=await auditUniqueAnswer(q,{callModel:async prompt=>{assert.match(prompt,/EVERY judgment, including fits=true, must provide a non-null clueIndex/);return JSON.stringify(r);}});
 assert.equal(result.approved,false);assert.equal(result.code,'semantic_evidence_invalid');
});

test('a claimed unique answer is rejected when a critical proof check finds an alternative',async()=>{
 let calls=0;const result=await auditUniqueAnswer(q,{callModel:async prompt=>{
  calls++;if(calls===1)return JSON.stringify(reply());
  assert.match(prompt,/CRITICAL EXCLUSION CHECK/);assert.ok(!prompt.includes('expectedAnswer'));
  return JSON.stringify(reply([true,true,false,false]));
 }});assert.equal(calls,2);assert.equal(result.approved,false);assert.equal(result.code,'semantic_non_unique');
});
test('failure of the critical proof check cannot reuse the first approval',async()=>{
 let calls=0;const result=await auditUniqueAnswer(q,{callModel:async()=>{if(++calls===1)return JSON.stringify(reply());throw new Error('offline');}});
 assert.equal(result.approved,false);assert.equal(result.status,'unavailable');
});
