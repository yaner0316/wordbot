const test = require('node:test');
const assert = require('node:assert/strict');
const { auditUniqueAnswer } = require('../question-semantic-audit');

const question = {level:'高中', context:'Although the old books were damaged, the _____ copied every page by hand so that future readers could still read the stories.', options:['A. scribe','B. farmer','C. driver','D. dancer'], answer:'A', optionMeanings:['抄写员','农民','司机','舞者']};
const fit = {status:'suitable', clue:'copied every page by hand', vocabularyReason:'核心线索由抄写、页面和手工等常用词组成。', syntaxReason:'让步和目的从句关系清楚，不需要额外语法知识。', reasoningReason:'通过手工抄写书页的动作判断职业，线索明确。', optionsReason:'其余职业词常见，不需要先学习另一组陌生职业。', barriers:[], repairStage:'none'};
function model(levelFit, prompts=[]) {
 return async prompt => {
  prompts.push(prompt);
  if (prompt.startsWith('WORD SENSE CHECK')) return JSON.stringify({providedSense:'抄写员', contextualSense:'抄写员',reason:'句中用手抄写书页的人属于给定的抄写员词义。',matches:true,...(levelFit ? {levelFit} : {})});
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
test('non-high-school audits keep their existing evidence contract', async()=>{
 const result=await auditUniqueAnswer({...question,level:'中学'},{callModel:model(null)});
 assert.equal(result.approved,true);
 assert.equal(result.teachingAnalysis.levelFit,undefined);
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
