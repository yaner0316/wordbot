const test=require('node:test'),assert=require('node:assert/strict');
const {generateReplacementContextWithAI,buildCacheQuestionRowsForWord}=require('../supabase-data');
const {parseWordSenseEvidence,buildStemReviewPrompt}=require('../question-semantic-audit');
async function generate(word,form,pos,level){
 const old=global.fetch,key=process.env.MINIMAX_API_KEY;process.env.MINIMAX_API_KEY='test-only';let prompt,metadata;
 global.fetch=async(url,opts)=>{prompt=JSON.parse(opts.body).messages[0].content;return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({context:'Yesterday we saw __TARGET__ near the school.',targetForm:form,targetLemma:word,targetPartOfSpeech:pos})}}]})};};
 try{return {context:await generateReplacementContextWithAI(word,'指定词义',level,'',{onTargetForm:v=>metadata=v}),get metadata(){return metadata;},get prompt(){return prompt;}};}finally{global.fetch=old;if(key===undefined)delete process.env.MINIMAX_API_KEY;else process.env.MINIMAX_API_KEY=key;}
}
test('secondary and higher levels accept inflected target forms with canonical identity',async()=>{
 for(const level of ['中学','高中','CET4_6_TOEFL']){
  const result=await generate('go','went','verb',level);assert.match(result.context,/went/);assert.equal(result.metadata.targetForm,'went');assert.match(result.prompt,/inflection/i);
 }
});
test('primary accepts noun number changes but refuses changed verbs and adjectives',async()=>{
 assert.match((await generate('child','children','noun','小学')).context,/children/);
 for(const level of ['小学','小学低年级']) for(const [word,form,pos] of [['go','went','verb'],['walk','walks','verb'],['big','bigger','adjective']])assert.equal((await generate(word,form,pos,level)).context,'');
});
test('a comparative phrase may contain the canonical word once within its printed form',async()=>{
 assert.match((await generate('difficult','more difficult','adjective','中学')).context,/more difficult/);
});
function question(level='中学'){return {word:'go',level,context:'Yesterday they _____ home.',options:['A. went','B. stayed','C. waited','D. slept'],answer:'A',optionMeanings:['去','停留','等待','睡觉']};}
function evidence(extra={}){return JSON.stringify({providedSense:'去',contextualSense:'去',matches:true,reason:'句中该动词表达前往某个地点，符合给定词义。',targetInflection:{baseWord:'go',printedWord:'went',sameLexeme:true,change:'verb_inflection',reason:'went是go的过去式，仍是同一个动词。',...extra}});}
test('existing sense review verifies inflection identity and primary restrictions',()=>{
 assert.equal(parseWordSenseEvidence(question(),evidence()).approved,true);
 assert.equal(parseWordSenseEvidence(question('小学'),evidence()).approved,false);
 assert.equal(parseWordSenseEvidence(question(),evidence({sameLexeme:false})).approved,false);
 assert.equal(parseWordSenseEvidence(question(),evidence({baseWord:'come'})).approved,false);
 const missing=JSON.parse(evidence());delete missing.targetInflection;assert.equal(parseWordSenseEvidence(question(),JSON.stringify(missing)).approved,false);
 assert.match(buildStemReviewPrompt({...question(),targetMeaning:'去'}),/targetInflection/);
});
test('formal builder preserves inflected answer and checkpoint without changing learning identity',async()=>{
 const checkpoint={variants:[]};let input;
 const rows=await buildCacheQuestionRowsForWord({user:{id:'u'},word:{id:'w',word:'go',meaning_zh:'去'},level:'中学',requiredCount:1,generationCheckpoint:checkpoint,saveGenerationCheckpoint:async()=>{},
 generateContext:async(w,m,l,p,repair)=>{const context='Yesterday they went home after the rain stopped.';repair.onTargetForm?.({context,targetForm:'went'});return context;},
 generateDistractors:async q=>{assert.equal(q.word,'went');assert.match(q.context,/they _____ home/);return ['stayed','waited','slept'];},
 translateWords:async()=>({stayed:'停留',waited:'等待',slept:'睡觉'}),translateContext:async()=> '昨天雨停后他们回家去了。',
 semanticAudit:async q=>{input=q;return require('./current-policy-fixture').approveAudit(q);},requireSemanticAudit:true});
 assert.equal(rows.length,1);assert.equal(input.word,'go');assert.equal(input.options['ABCD'.indexOf(input.answer)],input.answer+'. went');assert.equal(input.optionMeanings['ABCD'.indexOf(input.answer)],'去');assert.equal(checkpoint.variants[0].targetForm,'went');
});
test('resumed changed form retains its blank and option meanings without another generation',async()=>{
 const checkpoint={variants:[{slot:1,context:'They saw two groups of children playing outside.',targetForm:'groups',distractors:['baskets','bottles','boxes'],optionWords:['groups','baskets','bottles','boxes'],options:['A. groups','B. baskets','C. bottles','D. boxes'],answer:'A',optionMeanings:['群','篮子','瓶子','箱子'],contextTranslation:'他们看见两群孩子在外面玩耍。'}]};
 let received;const rows=await buildCacheQuestionRowsForWord({user:{id:'u'},word:{id:'w',word:'group',meaning_zh:'群'},level:'小学',requiredCount:1,generationCheckpoint:checkpoint,
 generateContext:async()=>{assert.fail('must reuse context');},generateDistractors:async()=>{assert.fail('must reuse options');},translateWords:async()=>{assert.fail('must reuse meanings');},translateContext:async()=>{assert.fail('must reuse translation');},
 semanticAudit:async q=>{received=q;return require('./current-policy-fixture').approveAudit(q);},requireSemanticAudit:true});
 assert.equal(rows.length,1);assert.match(received.context,/two _____ of children/);assert.equal(received.options[0],'A. groups');
});
