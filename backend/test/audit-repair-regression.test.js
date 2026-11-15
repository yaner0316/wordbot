'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {selectContextualDistractors}=require('../generate-distractors');
const {auditOptions:auditUniqueAnswer}=require('../question-semantic-audit');
const {parseContentReview}=require('../question-content-review');
const {parseSurfaceEvidence}=require('../question-surface');
const {normalizeGenerationCheckpoint}=require('../question-generation-checkpoint');

test('hard collision bans cannot use the one-word sibling reuse allowance, including casing',async()=>{
 const args={word:'skins',context:'They wore _____.',excludedDistractors:['wool'],hardExcludedDistractors:['hides'],callLLM:async()=>JSON.stringify({distractors:['Hides','wool','cotton']})};
 assert.equal(await selectContextualDistractors(args),null);
 assert.deepEqual(await selectContextualDistractors({...args,callLLM:async()=>JSON.stringify({distractors:['leather','wool','cotton']})}),['leather','wool','cotton']);
});
test('collision history survives retry and is reset when the learning sense changes',()=>{
 const current={word:'skins',meaning:'兽皮',level:'中学'},cp={...current,policyVersion:'context-learning-v3',hardExcludedDistractors:['hides'],repairFeedback:[{code:'surface_context',reason:'主语与动词词形不一致，需要重写句子。'}],variants:[]};
 assert.deepEqual(normalizeGenerationCheckpoint(cp,current).hardExcludedDistractors,['hides']);
 assert.equal(normalizeGenerationCheckpoint(cp,{...current,meaning:'皮肤'}).hardExcludedDistractors,undefined);
});
const q={level:'中学',context:'When insects attacked her arms, she _____ them hard with her open hand.',options:['A. slap','B. punch','C. kick','D. squeeze'],answer:'A',optionMeanings:['拍打','拳打','踢','挤压']};
function judgments(){return {certain:true,optionJudgments:q.options.map((s,i)=>({letter:'ABCD'[i],word:s.slice(3),fits:i===0,exclusion:i===0?'none':'grammar',clueIndex:1,meaning:q.optionMeanings[i],reason:i===0?'主语she与动词slap不一致；过去式应为slapped，但动作符合语境。':'主语she与动词词形不一致，必须使用过去式。'}))};}
test('an admitted correct-option grammar defect cannot be repaired as distractors',async()=>{
 const result=await auditUniqueAnswer(q,{callModel:async()=>JSON.stringify(judgments())});
 assert.equal(result.code,'surface_context');assert.equal(result.approved,false);
 assert.ok(result.reason.includes('slapped'));
});
test('correct-option grammar evidence still routes context when reviewer says uncertain/non-unique',async()=>{
 const reply=judgments();reply.certain=false;reply.optionJudgments[0].fits=false;reply.optionJudgments[0].exclusion='grammar';
 const result=await auditUniqueAnswer(q,{callModel:async()=>JSON.stringify(reply)});
 assert.equal(result.code,'surface_context');
});
test('surface boolean cannot approve a reason admitting a changed printed verb',()=>{
 const options=q.options.map((s,i)=>({letter:'ABCD'[i],word:s.slice(3),grammatical:true,reason:i===0?'原句存在语法错误，应改为slapped才能成立。':'该动词放在句子中语法正确，没有词形问题。'}));
 assert.equal(parseSurfaceEvidence(q,{options}).code,'surface_context');
});
function content(reason){return {targetSense:{providedPartsOfSpeech:['verb'],contextualPartOfSpeech:'verb',matches:true,contextualSense:'测试词义',reason:'此处目标词与录入的具体词义保持一致。'},translation:{text:'中文原句',accurate:true,reason:'译文准确表达原句所有动作及人物关系。'},optionMeanings:q.optionMeanings.map((meaning,i)=>({letter:'ABCD'[i],meaning,accurate:true,reason:'所给中文释义属于这个英文选项的真实词义。'})),optionPairs:['AB','AC','AD','BC','BD','CD'].map((p,i)=>({letters:[...p],relation:'distinct',reason:i?'两个选项各有不同含义，彼此不存在包含关系。':reason}))};}
test('old pair-relation evidence no longer vetoes translation approval',()=>{
 const reason='sports表示运动用途这一特殊类别，ordinary表示普通类别；运动鞋可以是普通鞋的一种，但普通鞋并不都是运动鞋，因此是包含关系而非同义；按题目要求标记为distinct。';
 const result=parseContentReview({...q,contextCN:'中文原句',targetMeaning:'拍打'},content(reason),{requireOptionSeparation:true});
 assert.equal(result.approved,true); // Wrong-option overlap is retired as an independent veto.
});
test('negated inclusion and grammar statements are not positive admissions',()=>{
 const e=content('两者虽属同一大类，但没有包含关系，也不是同义词。');
 assert.equal(parseContentReview({...q,contextCN:'中文原句',targetMeaning:'拍打'},e,{requireOptionSeparation:true}).approved,true);
 assert.equal(parseSurfaceEvidence(q,{options:q.options.map((s,i)=>({letter:'ABCD'[i],word:s.slice(3),grammatical:true,reason:'该选项语法正确，不存在语法错误，无需改为其他词形。'}))}).approved,true);
});
for (const reason of ['两者研究领域不同，任何一方都不是另一方的子类。','二者有交集，但均不是对方的子类。','二者不属于彼此的子类。']) {
 test('negative subtype evidence must remain distinct: '+reason,()=>{
  assert.equal(parseContentReview({...q,contextCN:'中文原句',targetMeaning:'拍打'},content(reason),{requireOptionSeparation:true}).approved,true);
 });
}
for (const reason of [
 '除abuse须与第三人称单数主语一致而应为abuses外，句意明确成立：把狗锁在黑暗棚屋并使其缺水缺食，是对狗的虐待。',
 'came down后接slapped构成不合语法的并列过去式；但按句法应理解为“came down and slapped”，句意是手掌重重拍在桌上并发出清脆响声，语义连贯。',
]) test('real baseline silent correction must replace context: '+reason.slice(0,16),async()=>{
 const reply=judgments();reply.optionJudgments[0].reason=reason;
 assert.equal((await auditUniqueAnswer(q,{callModel:async()=>JSON.stringify(reply)})).code,'surface_context');
});
const {buildCacheQuestionRowsForWord,resolveDistinctOptionDistractors}=require('../supabase-data');
const word={id:'w',word:'skins',meaning_zh:'兽皮',context_en:'They wore skins during the cold winter.'};
function buildArgs(cp){return {user:{id:'u'},word,level:'中学',requiredCount:1,generationCheckpoint:cp,saveGenerationCheckpoint:async()=>{},
 generateContext:async()=>'',generateDistractors:async()=>['wool','cotton','silk'],
 translateWords:async words=>Object.fromEntries(words.map(w=>[w,{wool:'羊毛',cotton:'棉花',silk:'丝绸',hides:'兽皮'}[w.toLowerCase()]])),
 translateContext:async context=>context===word.context_en?'在寒冷的冬天他们穿着兽皮。':'这是另一句英文对应的中文翻译。',semanticAudit:require('./current-policy-fixture').approveAudit,requireSemanticAudit:true};}
test('retired gloss-overlap repair generator is no longer exported',()=>{assert.equal(require('../supabase-data').resolveDistinctOptionDistractors,undefined);});

test('resumed builder forwards bans and rejects a banned word even with a custom generator',async()=>{
 const cp={variants:[],hardExcludedDistractors:['hides']};const args=buildArgs(cp);let calls=0;
 args.generateDistractors=async input=>{assert.deepEqual(input.hardExcludedDistractors,['hides']);return ++calls===1?['Hides','wool','cotton']:['wool','cotton','silk'];};
 const rows=await buildCacheQuestionRowsForWord(args);assert.equal(rows.length,1);assert.equal(calls,2);assert.ok(!rows[0].options.some(x=>/hides/i.test(x)));
});
test('changed context discards old translation and local validation while sending grammar feedback',async()=>{
 const cp={variants:[{slot:1,context:'They wore animal hides.',contextTranslation:'旧翻译',distractors:['hides','wool','cotton'],localValidated:true}],repairFeedback:[{code:'surface_context',reason:'正确项词形不符，应使用新句子。'}]};
 const args=buildArgs(cp);args.generateContext=async (w,m,l,old,feedback)=>{assert.ok(feedback.repairFeedback[0].reason.includes('词形'));return word.context_en;};
 const rows=await buildCacheQuestionRowsForWord(args);assert.equal(rows.length,1);assert.equal(rows[0].context_zh,'在寒冷的冬天他们穿着兽皮。');assert.ok(!rows[0].options.some(x=>/hides/i.test(x)));
});
