const test=require('node:test'),assert=require('node:assert/strict');
const {selectContextualDistractors}=require('../generate-distractors');
const {buildCacheQuestionRowsForWord}=require('../supabase-data');
test('distractor generation preserves proper-noun spelling while deduplicating case-insensitively',async()=>{
 const args={word:'Cambodia',context:'They travelled to Cambodia.',callLLM:async()=>JSON.stringify({distractors:['Laos','Tanzania','Indonesia']})};
 assert.deepEqual(await selectContextualDistractors(args),['Laos','Tanzania','Indonesia']);
 assert.equal(await selectContextualDistractors({...args,callLLM:async()=>JSON.stringify({distractors:['Laos','LAOS','Indonesia']})}),null);
});
async function build(context,word,distractors,checkpoint={variants:[]}){
 const meanings={cambodia:'柬埔寨',laos:'老挝',tanzania:'坦桑尼亚',indonesia:'印度尼西亚',although:'虽然',because:'因为',unless:'除非',until:'直到'};
 return buildCacheQuestionRowsForWord({user:{id:'u'},word:{id:'w',word,meaning_zh:meanings[word.toLowerCase()],context_en:context},level:'高中',requiredCount:1,reportRejection:issue=>console.log('surface-rejection',issue),generationCheckpoint:checkpoint,saveGenerationCheckpoint:async()=>{},
 generateContext:async()=>'',generateDistractors:async()=>distractors,translateWords:async words=>Object.fromEntries(words.map(w=>[w.toLowerCase(),meanings[w.toLowerCase()]])),translateContext:async()=> '他们在假期期间前往了这个国家。',
 semanticAudit:async q=>({approved:true,status:'approved',validLetters:[q.answer]}),requireSemanticAudit:true});
}
test('production cache assembly keeps target spelling from context and proper-noun options',async()=>{
 const rows=await build('They travelled to Cambodia during their holiday.','cambodia',['Laos','Tanzania','Indonesia']);
 assert.equal(rows.length,1); assert.equal(rows[0].options.find(o=>o.startsWith(rows[0].answer+'.'))?.slice(3),'Cambodia');
 assert.deepEqual(rows[0].options.map(o=>o.slice(3)).sort(),['Cambodia','Indonesia','Laos','Tanzania']);
});
test('production sentence-initial blank capitalizes all alternatives before audit and storage',async()=>{
 const rows=await build('Although it was raining, they went outside.','although',['because','unless','until']);
 assert.equal(rows.length,1);assert.ok(rows[0].options.every(o=>/^[A-D]\. [A-Z]/.test(o)));
});

const {parseSurfaceEvidence,surfaceFingerprint,hasCurrentSurfaceEvidence}=require('../question-surface');
const surfaceQuestion={context:'They can _____ at the park.',options:['A. recreation','B. rest','C. relax','D. play'],answer:'A',optionMeanings:['娱乐','休息','放松','玩耍']};
const surfaceEvidence=()=>({options:surfaceQuestion.options.map((o,i)=>({letter:'ABCD'[i],word:o.slice(3),grammatical:true,reason:'词形与句中语法位置一致，拼写和大小写正确。'}))});
test('surface review rejects a nominal target after a modal and malformed distractors separately',()=>{
 const evidence=surfaceEvidence();evidence.options[0].grammatical=false;evidence.options[0].reason='情态动词后需要动词原形，recreation是名词。';
 assert.equal(parseSurfaceEvidence(surfaceQuestion,evidence).code,'surface_context');
 evidence.options[0].grammatical=true;evidence.options[1].grammatical=false;
 assert.equal(parseSurfaceEvidence(surfaceQuestion,evidence).code,'surface_distractors');
 assert.equal(parseSurfaceEvidence(surfaceQuestion,undefined).code,'semantic_audit_surface_missing');
});
test('surface evidence binds exact spelling and meanings but survives letter shuffles',()=>{
 const result=parseSurfaceEvidence(surfaceQuestion,surfaceEvidence());assert.equal(result.approved,true);
 assert.ok(hasCurrentSurfaceEvidence(surfaceQuestion,result.surface));
 assert.notEqual(surfaceFingerprint(surfaceQuestion),surfaceFingerprint({...surfaceQuestion,options:['A. Recreation',...surfaceQuestion.options.slice(1)]}));
 const shuffled={...surfaceQuestion,options:['A. rest','B. recreation','C. relax','D. play'],answer:'B',optionMeanings:['休息','娱乐','放松','玩耍']};
 assert.equal(surfaceFingerprint(shuffled),surfaceFingerprint(surfaceQuestion));
 assert.ok(!hasCurrentSurfaceEvidence({...surfaceQuestion,optionMeanings:['消遣活动','休息','放松','玩耍']},result.surface));
});

test('new generation rejects old checkpoint approval while retaining context and translation',async()=>{
 const {createQuestionGenerationService}=require('../question-generation-service');
 const old={question_text:surfaceQuestion.context,options:surfaceQuestion.options,answer:'A',option_meanings:surfaceQuestion.optionMeanings,question_fingerprint:'old'};
 let generated=0,published=0;
 const service=createQuestionGenerationService({requiredSurfacePolicy:'english-surface-v1',maxAttempts:1,loadWord:async()=>({id:'w',word:'recreation',level:'高中',meaning_zh:'娱乐'}),validateCandidate:()=>[],
 loadCheckpoint:async()=>({word:'recreation',level:'高中',meaning:'["","娱乐"]',variants:[{slot:1,context:'They can recreation at the park.',contextTranslation:'他们可以在公园娱乐。',row:old,audit:{approved:true}}]}),
 generateCandidates:async request=>{generated++;const v=request.generationCheckpoint.variants[0];assert.ok(!v.row&&!v.audit);assert.equal(v.contextTranslation,'他们可以在公园娱乐。');return [old];},publishReadyVariants:async()=>{published++;}});
 await assert.rejects(service.process({word_id:'w',user_id:'u'}),error=>error.code==='INSUFFICIENT_DISTINCT_READY_VARIANTS'&&error.rejectionReasons.semantic_audit_surface_missing>0);assert.equal(generated,1);assert.equal(published,0);
});
test('production assembly does not reuse an old approval lacking exact-surface evidence',async()=>{
 let calls=0;const checkpoint={variants:[]};
 const audit=async q=>{calls++;return {approved:true,status:'approved',validLetters:[q.answer],teachingAnalysis:{surface:parseSurfaceEvidence(q,{options:q.options.map((o,i)=>({letter:'ABCD'[i],word:o.slice(3),grammatical:true,reason:'所选词形符合这里的语法位置和大小写要求。'}))}).surface}};};audit.surfacePolicy='english-surface-v1';
 const args={user:{id:'u'},word:{id:'w',word:'although',meaning_zh:'虽然',context_en:'Although it was raining, they went outside.'},level:'高中',requiredCount:1,generationCheckpoint:checkpoint,saveGenerationCheckpoint:async()=>{},generateContext:async()=>'',generateDistractors:async()=>['because','unless','until'],translateWords:async words=>Object.fromEntries(words.map(w=>[w,{because:'因为',unless:'除非',until:'直到'}[w.toLowerCase()]])),translateContext:async()=> '虽然下雨，他们仍然出去了。',semanticAudit:audit,requireSemanticAudit:true};
 await buildCacheQuestionRowsForWord(args);assert.equal(calls,1);
 const v=checkpoint.variants[0];delete v.row;v.audit={approved:true,status:'approved',validLetters:[v.answer]};
 await buildCacheQuestionRowsForWord(args);assert.equal(calls,2);
});
