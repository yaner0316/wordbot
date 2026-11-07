const test = require('node:test');
const assert = require('node:assert/strict');
const { auditUniqueAnswer } = require('../question-semantic-audit');

const question = {level:'高中', context:'Although the old books were damaged, the _____ copied every page by hand so that future readers could still read the stories.', options:['A. scribe','B. farmer','C. driver','D. dancer'], answer:'A', optionMeanings:['抄写员','农民','司机','舞者']};
const fit = {status:'suitable', clue:'copied every page by hand', vocabularyReason:'核心线索由抄写、页面和手工等常用词组成。', syntaxReason:'让步和目的从句关系清楚，不需要额外语法知识。', reasoningReason:'通过手工抄写书页的动作判断职业，线索明确。', optionsReason:'其余职业词常见，不需要先学习另一组陌生职业。', barriers:[], repairStage:'none'};

test('indexed level clue resolves only to a provided original fragment without the blank',()=>{
 const {parseLevelFitEvidence,hasCurrentLevelFit,levelFitPrompt}=require('../high-school-fit');
 const {clue,...rest}=fit;
 const result=parseLevelFitEvidence(question,{...rest,clueIndex:1});
 assert.equal(result.approved,true);
 assert.equal(result.levelFit.clue,'copied every page by hand so that future readers could still read the stories.');
 assert.equal(hasCurrentLevelFit(question,result.levelFit),true);
 assert.match(levelFitPrompt(question),/clueIndex/);
 assert.match(levelFitPrompt(question),/originalFragments/);
});

test('indexed level clues reject invalid indices and conflicting literal evidence',()=>{
 const {parseLevelFitEvidence}=require('../high-school-fit');
 const {clue,...rest}=fit;
 for(const clueIndex of [-1,2,1.5,'1',null]) assert.equal(parseLevelFitEvidence(question,{...rest,clueIndex}).approved,false);
 assert.equal(parseLevelFitEvidence(question,{...fit,clueIndex:1}).approved,false,'do not silently overwrite a different literal clue');
 assert.equal(parseLevelFitEvidence({...question,context:'_____ copied every page by hand.'},{...rest,clueIndex:0}).approved,false,'empty fragment is not evidence');
 assert.equal(parseLevelFitEvidence(question,{...rest,clue:question.context}).approved,false,'legacy blank-containing text remains invalid');
});
function model(levelFit, prompts=[]) {
 return async prompt => {
  prompts.push(prompt);
  if (prompt.startsWith('WORD SENSE CHECK')) return JSON.stringify({surface:{options:question.options.map((o,i)=>({letter:'ABCD'[i],word:o.slice(3),grammatical:true,reason:'词形和语法位置一致，拼写及大小写正确。'}))},providedSense:'抄写员', contextualSense:'抄写员',reason:'句中用手抄写书页的人属于给定的抄写员词义。',matches:true,...(levelFit ? {levelFit} : {})});
  return JSON.stringify({certain:true, optionJudgments:question.options.map((option,i)=>({letter:'ABCD'[i], fits:i===0, exclusion:i===0?'none':'contradiction',clueIndex:1,meaning:question.optionMeanings[i],reason:i===0?'句中抄写书页的工作对应抄写员的词义。':'此处要求的职业是抄写书页，与该职业的工作性质不符。'}))});
 };
}
test('high-school approval requires grounded level evidence even when meaning and uniqueness pass', async()=>{
 const result=await auditUniqueAnswer(question,{callModel:model(null)});
 assert.equal(result.approved,false);
 assert.equal(result.code,'level_fit_evidence_invalid');
});
test('a long high-school sentence passes with grounded evidence without another model request', async()=>{
 const prompts=[];
 const result=await auditUniqueAnswer(question,{callModel:model(fit,prompts)});
 assert.equal(result.approved,true);
 assert.equal(prompts.length,3);
 assert.equal(result.teachingAnalysis.levelFit.status,'suitable');
 assert.equal(result.teachingAnalysis.levelFit.policyVersion,'high-school-fit-v1');
});
test('a blocking background requirement rejects an otherwise unique question', async()=>{
 const evidence={...fit,status:'unsuitable',barriers:[{text:'copied every page by hand',location:'context',impact:'blocking',reason:'此测试模拟审核发现该线索的具体用法形成理解障碍。'}],repairStage:'context'};
 const result=await auditUniqueAnswer(question,{callModel:model(evidence)});
 assert.equal(result.approved,false);
 assert.equal(result.code,'level_fit_context');
});
test('unsupported explicit learner levels cannot approve', async()=>{
 const result=await auditUniqueAnswer({...question,level:'unknown'},{callModel:model(null)});
 assert.equal(result.approved,false);
 assert.equal(result.code,'level_fit_unsupported');
});

test('fit evidence cannot be reused after level, sense, option or context changes',()=>{
 const {parseLevelFitEvidence,hasCurrentLevelFit}=require('../high-school-fit');
 const evidence=parseLevelFitEvidence(question,fit).levelFit;
 assert.equal(hasCurrentLevelFit(question,evidence),true);
 for (const changed of [{...question,context:question.context+' Later.'},{...question,options:['A. scribe','B. teacher','C. driver','D. dancer']},{...question,optionMeanings:['书记员','农民','司机','舞者']}]) assert.equal(hasCurrentLevelFit(changed,evidence),false);
 assert.equal(hasCurrentLevelFit(question,{...evidence,policyVersion:'old'}),false);
});
test('incidental unlisted vocabulary is not automatically rejected',()=>{
 const {parseLevelFitEvidence,vocabularyHints}=require('../high-school-fit');
 const q={...question,context:'At the monastery, the _____ copied every page by hand.'};
 assert.ok(vocabularyHints(q).context.unlisted.includes('monastery'));
 const evidence={...fit,barriers:[{text:'monastery',location:'context',impact:'incidental',reason:'这个地点词只交代场所，不影响理解手工抄写的线索。'}]};
 assert.equal(parseLevelFitEvidence(q,evidence).approved,true);
});
test('fabricated evidence, contradictory approvals and unresolved concerns fail closed',()=>{
 const {parseLevelFitEvidence}=require('../high-school-fit');
 for(const evidence of [{...fit,clue:'not in the sentence'},{...fit,optionsReason:''},{...fit,barriers:[{text:'copied',location:'context',impact:'blocking',reason:'测试中明确认定该处存在不能解决的理解障碍。'}]}]) assert.equal(parseLevelFitEvidence(question,evidence).approved,false);
 const uncertain={...fit,status:'borderline',repairStage:'context',barriers:[{text:'copied',location:'context',impact:'incidental',reason:'测试中该处具体用法的理解难度尚无法得到确认。'}]};
 assert.equal(parseLevelFitEvidence(question,uncertain).approved,false);
});

for (const level of ['小学','中学','CET4_6_TOEFL']) {
 test(level+' cannot approve without its own level-fit evidence',async()=>{
  const result=await auditUniqueAnswer({...question,level},{callModel:model(null)});
  assert.equal(result.approved,false);
  assert.equal(result.code,'level_fit_evidence_invalid');
 });
 test(level+' approves valid evidence under a distinct level policy',async()=>{
  const result=await auditUniqueAnswer({...question,level},{callModel:model(fit)});
  assert.equal(result.approved,true);
  assert.ok(result.teachingAnalysis.levelFit);
  assert.notEqual(result.teachingAnalysis.levelFit.policyVersion,'high-school-fit-v1');
 });
}

test('level evidence and vocabulary hints remain separate across school bands',()=>{
 const {hasCurrentLevelFit,parseLevelFitEvidence,vocabularyHints,levelGuidance}=require('../high-school-fit');
 const evidence=parseLevelFitEvidence(question,fit).levelFit;
 for(const level of ['小学','中学','CET4_6_TOEFL']) assert.equal(hasCurrentLevelFit({...question,level},evidence),false);
 assert.equal(vocabularyHints({...question,level:'小学'}).available,false);
 assert.equal(vocabularyHints({...question,level:'CET4_6_TOEFL'}).available,false);
 const q={...question,context:'We abandon the damaged plan.'};
 assert.equal(vocabularyHints(q).context.unlisted.includes('abandon'),false);
 assert.equal(vocabularyHints({...q,level:'中学'}).context.unlisted.includes('abandon'),true);
 assert.match(levelGuidance('小学'),/grades 5–6/);
 assert.match(levelGuidance('中学'),/grades 7–9/);
 assert.match(levelGuidance('CET4_6_TOEFL'),/NOT|mixed band/);
 assert.equal(hasCurrentLevelFit({...question,level:''},evidence),false);
});

test('the same sense request rejects grammar errors and missing surface evidence',async()=>{
 for(const bad of ['A','B',null]) {
  const base=model(fit);const result=await auditUniqueAnswer(question,{callModel:async prompt=>{
   const reply=JSON.parse(await base(prompt));if(prompt.startsWith('WORD SENSE CHECK')){if(bad===null) delete reply.surface;else reply.surface.options.find(o=>o.letter===bad).grammatical=false;}return JSON.stringify(reply);
  }});
  assert.equal(result.approved,false);assert.equal(result.code,bad==='A'?'surface_context':bad==='B'?'surface_distractors':'semantic_audit_surface_missing');
 }
});
