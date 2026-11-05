const test=require('node:test'),assert=require('node:assert/strict');
const {buildCacheQuestionRowsForWord}=require('../supabase-data');
const {normalizeGenerationCheckpoint}=require('../question-generation-checkpoint');
test('semantic alternatives survive retries and are supplied to both next generation stages',async()=>{
 const checkpoint={variants:[]},contexts=[],distractorCalls=[],saved=[];let audits=0;
 const meanings={guitar:'吉他',ukulele:'尤克里里',violin:'小提琴',cello:'大提琴',flute:'长笛',drum:'鼓',trumpet:'小号'};
 const rows=await buildCacheQuestionRowsForWord({user:{id:'owner'},word:{id:'meaning',user_id:'owner',word:'guitar',meaning_zh:'吉他',context_en:'He packed his guitar before the concert.'},level:'高中',requiredCount:1,generationCheckpoint:checkpoint,saveGenerationCheckpoint:async c=>saved.push(structuredClone(c)),
 generateContext:async(_word,_meaning,_level,_prior,repair)=>{contexts.push(repair);return 'He strummed the six strings of his wooden guitar.';},
 generateDistractors:async request=>{distractorCalls.push(request);return request.rejectedAlternatives?.length?['flute','drum','trumpet']:['ukulele','violin','cello'];},
 translateWords:async words=>Object.fromEntries(words.map(w=>[w,meanings[w]])),translateContext:async()=> '他在音乐会前打包了自己的吉他。',
 semanticAudit:async q=>{audits++;return audits===1?{approved:false,status:'rejected',code:'semantic_non_unique',validLetters:['A','B','C','D']}:{approved:true,status:'approved',validLetters:[q.answer]};},requireSemanticAudit:true});
 assert.equal(rows.length,1);assert.equal(audits,2);
 assert.deepEqual([...contexts[0].rejectedAlternatives].sort(),['cello','ukulele','violin']);
 assert.deepEqual([...distractorCalls[1].rejectedAlternatives].sort(),['cello','ukulele','violin']);
 assert.ok(saved.some(c=>c.rejectedAlternatives?.includes('ukulele')),'counterexamples are durable before another model call');
 assert.deepEqual(checkpoint.rejectedAlternatives,[],'an accepted candidate releases the temporary exclusions for the next variant');
});
test('a generator cannot return an alternative already found to fit the pending candidate',async()=>{
 const {selectContextualDistractors}=require('../generate-distractors');
 const result=await selectContextualDistractors({word:'guitar',meaning:'吉他',context:'He strums six strings on a _____.',rejectedAlternatives:['banjo'],callLLM:async()=>'{"distractors":["banjo","flute","trumpet"]}'});
 assert.equal(result,null);
});
test('feedback survives a same-meaning resume and clears on a material meaning change',()=>{
 const previous={word:'guitar',meaning:'吉他',level:'高中',variants:[],rejectedAlternatives:['ukulele','violin']};
 assert.deepEqual(normalizeGenerationCheckpoint(previous,{word:'guitar',meaning:'吉他',level:'高中'}).rejectedAlternatives,previous.rejectedAlternatives);
 assert.equal(normalizeGenerationCheckpoint(previous,{word:'guitar',meaning:'另一词义',level:'高中'}).rejectedAlternatives,undefined);
});


test('high-school context barriers are durable repair feedback and rejected stems are not reused',async()=>{
 const checkpoint={variants:[]},repairs=[],saved=[];let audits=0;
 const meanings={scribe:'抄写员',farmer:'农民',driver:'司机',dancer:'舞者'};
 const rows=await buildCacheQuestionRowsForWord({user:{id:'owner'},word:{id:'meaning',user_id:'owner',word:'scribe',meaning_zh:'抄写员',context_en:'The scribe transcribed manuscripts onto vellum.'},level:'高中',requiredCount:1,generationCheckpoint:checkpoint,saveGenerationCheckpoint:async c=>saved.push(structuredClone(c)),
 generateContext:async(_w,_m,_l,_p,repair)=>{repairs.push(repair);return 'The scribe copied every page by hand.';},generateDistractors:async()=>['farmer','driver','dancer'],
 translateWords:async words=>Object.fromEntries(words.map(w=>[w,meanings[w]])),translateContext:async()=> '抄写员在纸上抄写了一本书。',
 semanticAudit:async q=>++audits===1?{approved:false,status:'rejected',code:'level_fit_context',validLetters:[q.answer],levelFit:{barriers:[{text:'vellum',location:'context',impact:'blocking',reason:'材料和动作都用陌生术语表达，妨碍理解抄写的线索。'}]}}:{approved:true,status:'approved',validLetters:[q.answer]},requireSemanticAudit:true});
 assert.equal(rows.length,1);
 assert.ok(repairs[0].levelFitFeedback.some(item=>item.text==='vellum'));
 assert.ok(saved.some(c=>c.levelFitFeedback?.some(item=>item.text==='vellum')));
 assert.ok(rows[0].question_text.includes('copied every page by hand'));
 assert.deepEqual(checkpoint.levelFitFeedback,[]);
});

test('option-only high-school rejection retains the same context for the next attempt',async()=>{
 const checkpoint={variants:[]}; let contexts=0,translations=0;
 const meanings={scribe:'抄写员',smelter:'冶炼工',dyer:'染工',burnisher:'抛光工'};
 await buildCacheQuestionRowsForWord({user:{id:'owner'},word:{id:'meaning',user_id:'owner',word:'scribe',meaning_zh:'抄写员',context_en:'The scribe copied every page by hand.'},level:'高中',requiredCount:1,generationCheckpoint:checkpoint,saveGenerationCheckpoint:async()=>{},
 generateContext:async()=>{contexts++;return 'The scribe copied another book by hand.';},generateDistractors:async()=>['smelter','dyer','burnisher'],translateWords:async words=>Object.fromEntries(words.map(w=>[w,meanings[w]])),translateContext:async()=>{translations++;return '抄写员手工抄写了每一页。';},
 semanticAudit:async q=>({approved:false,status:'rejected',code:'level_fit_distractors',validLetters:[q.answer],levelFit:{barriers:[{text:'burnisher',location:'option',impact:'blocking',reason:'干扰项引入另一组陌生职业，增加了额外的词汇门槛。'}]}}),requireSemanticAudit:true});
 assert.equal(contexts,0);
 assert.equal(translations,1);
 assert.equal(checkpoint.variants[0].context,'The scribe copied every page by hand.');
 assert.ok(checkpoint.variants[0].contextTranslation);
 assert.equal(checkpoint.variants[0].distractors,undefined);
});
