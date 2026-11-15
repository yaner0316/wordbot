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

test('level evidence and vocabulary hints remain separate across school bands',()=>{
 const {hasCurrentLevelFit,parseLevelFitEvidence,vocabularyHints,levelGuidance}=require('../high-school-fit');
 const evidence=parseLevelFitEvidence(question,fit).levelFit;
 for(const level of ['小学','中学','CET4_6_TOEFL']) assert.equal(hasCurrentLevelFit({...question,level},evidence),false);
 assert.equal(vocabularyHints({...question,level:'小学'}).available,false);
 assert.equal(vocabularyHints({...question,level:'CET4_6_TOEFL'}).available,false);
 const q={...question,context:'We abandon the damaged plan.'};
 assert.equal(vocabularyHints(q).context.unlisted.includes('abandon'),false);
 assert.equal(vocabularyHints({...q,level:'中学'}).context.unlisted.includes('abandon'),true);
 assert.match(levelGuidance('小学'),/grades 4–6/);
 assert.match(levelGuidance('中学'),/grades 7–9/);
 assert.match(levelGuidance('CET4_6_TOEFL'),/NOT|mixed band/);
 assert.equal(hasCurrentLevelFit({...question,level:''},evidence),false);
});

const {auditStem}=require('../question-semantic-audit');
const stemQuestion={...question,word:'scribe',targetMeaning:'抄写员'};
function stemEvidence(){return {certain:true,checks:Object.fromEntries(['grammar','naturalness','sense','form','level','clue','burden'].map(k=>[k,{pass:true,evidence:'copied every page by hand',reason:'这一明确的手工抄写线索使用常用语言，关系清楚。'}]))};}
for(const level of ['小学低年级','小学','中学','高中','CET4_6_TOEFL']) test(level+' requires its own stem-level and burden evidence',async()=>{
 const missing=stemEvidence();delete missing.checks.level;
 assert.equal((await auditStem({...stemQuestion,level},{callModel:async()=>JSON.stringify(missing)})).approved,false);
 const good=await auditStem({...stemQuestion,level},{callModel:async()=>JSON.stringify(stemEvidence())});assert.equal(good.approved,true);
 const bad=stemEvidence();bad.checks.level.pass=false;bad.checks.level.reason='当前背景知识要求超出了学习者理解线索的能力。';
 assert.equal((await auditStem({...stemQuestion,level},{callModel:async()=>JSON.stringify(bad)})).code,'level_fit_context');
});
test('no word-count ceiling replaces an actual burden judgment',async()=>{const context=stemQuestion.context+' '+Array(110).fill('word').join(' ');let calls=0;const good=await auditStem({...stemQuestion,context},{callModel:async p=>{calls++;assert.match(p,/NO word-count/);return JSON.stringify(stemEvidence());}});assert.equal(good.approved,true);assert.equal(calls,1);});
test('unsupported learner levels cannot approve',async()=>{assert.equal((await auditStem({...stemQuestion,level:'unknown'},{callModel:async()=>JSON.stringify(stemEvidence())})).code,'level_fit_unsupported');});
