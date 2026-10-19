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
