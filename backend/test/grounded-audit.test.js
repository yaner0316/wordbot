'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {admitsMeaningOverlap}=require('../audit-reason-consistency');
const {auditOptions:auditUniqueAnswer,buildSemanticAuditPrompt}=require('../question-semantic-audit');
for(const reason of [
 'crocodile所指鳄鱼不包括暴龙；暴龙也不包括鳄鱼，共有爬行动物背景不构成相互包含。',
 '两个概念并非互相包含。','两词不存在彼此包含关系。','两词没有相互包含关系。',
]) test('negated reciprocal inclusion remains distinct: '+reason,()=>assert.equal(admitsMeaningOverlap(reason),false));
test('negation in one clause must not hide a later positive admission',()=>{
 assert.equal(admitsMeaningOverlap('两者不构成相互包含，但运动鞋是普通鞋的一种。'),true);
 assert.equal(admitsMeaningOverlap('两者不存在同义关系，但属于包含关系。'),true);
 assert.equal(admitsMeaningOverlap('两者相互包含。'),true);
});
const q={context:'She can _____ the door with this key.',options:['A. unlock','B. paint','C. eat','D. drink'],answer:'A',requireContentReview:true};
function reply(){return {certain:true,semanticDiscrimination:true,optionJudgments:q.options.map((o,i)=>({letter:'ABCD'[i],word:o.slice(3),grammatical:true,wordValid:true,levelSuitable:true,fits:i===0,exclusion:i===0?'none':'contradiction',clueIndex:1,addedPremises:[],meaning:['开锁','涂漆','吃','喝'][i],reason:i===0?'钥匙能用于开锁，符合句中明确给出的工具。':'该动作与句中明确给出的工具和对象不相容。'}))};}
test('fit requiring an invented event invalidates evidence rather than silently approving uniqueness',async()=>{
 const r=reply();Object.assign(r.optionJudgments[1],{fits:true,exclusion:'none',addedPremises:['她事先把钥匙浸入油漆。']});
 const out=await auditUniqueAnswer(q,{callModel:async()=>JSON.stringify(r)});
 assert.equal(out.approved,false);assert.equal(out.code,'semantic_evidence_invalid');
});
test('unsupported-premise exclusion is grounded only with an explicit extra premise',async()=>{
 const r=reply();Object.assign(r.optionJudgments[1],{exclusion:'unstated_premise',addedPremises:['她事先把钥匙浸入油漆。'],reason:'要用钥匙涂漆，必须另加未说明的蘸漆动作。'});
 const out=await auditUniqueAnswer(q,{callModel:async()=>JSON.stringify(r)});
 assert.equal(out.approved,true);assert.equal(out.auditMethod,'blind-completion-v6');
 r.optionJudgments[1].addedPremises=[];
 assert.equal((await auditUniqueAnswer(q,{callModel:async()=>JSON.stringify(r)})).code,'semantic_evidence_invalid');
});
test('formal reviews cannot omit premise evidence or replace it with a string',async()=>{
 for(const value of [undefined,'none',[null],[' ']]){
  const r=reply();r.optionJudgments[0].addedPremises=value;
  assert.equal((await auditUniqueAnswer(q,{callModel:async()=>JSON.stringify(r)})).code,'semantic_evidence_invalid');
 }
});
test('ordinary alternatives without extra premises remain non-unique',async()=>{
 const r=reply();Object.assign(r.optionJudgments[1],{fits:true,exclusion:'none'});
 assert.equal((await auditUniqueAnswer(q,{callModel:async()=>JSON.stringify(r)})).code,'semantic_non_unique');
});
test('one blind prompt retains grounded-premise requirements',()=>{const prompt=buildSemanticAuditPrompt(q);assert.match(prompt,/Do not add unstated motives, actions, or background/);assert.match(prompt,/addedPremises/);assert.match(prompt,/unstated_premise/);});
