'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildCacheQuestionRowsForWord}=require('../supabase-data');
const {createQuestionGenerationService}=require('../question-generation-service');
const {getCacheQuestionReadinessIssues}=require('../question-cache');
const {parseContentReview}=require('../question-content-review');
const options=['A. catalogue','B. passport','C. diary','D. receipt'];
const meanings=['目录册','护照','日记','收据'];
const context='She opened the _____ to find a book title.';
const translation='她打开目录册查找书名。';
function review(q){return parseContentReview(q,{targetSense:{providedPartsOfSpeech:['noun'],contextualPartOfSpeech:'noun'},translation:{text:q.contextCN||q.context_zh,accurate:true,reason:'译文保留了打开目录册和查找书名的动作。'},optionMeanings:(q.optionMeanings||q.option_meanings).map((meaning,i)=>({letter:'ABCD'[i],meaning,accurate:true,reason:'中文释义对应这个英文选项的真实词义。'}))}).contentReview;}
function args(audit){return {user:{id:'u'},word:{id:'w',word:'catalogue',meaning_zh:'目录册',context_en:context.replace('_____','catalogue')},level:'高中',requiredCount:1,generateContext:async()=>'',generateDistractors:async()=>['passport','diary','receipt'],translateWords:async words=>Object.fromEntries(words.map(w=>[w,meanings[options.findIndex(o=>o.slice(3)===w)]])),translateContext:async()=>translation,semanticAudit:audit,requireSemanticAudit:true};}
test('production assembly supplies the actual translation and canonical target sense to the auditor',async()=>{
    let received;
    const audit=async q=>{received=q;return {approved:false,status:'rejected',code:'content_review_missing'};};
    audit.contentPolicy='question-content-v1';
    await buildCacheQuestionRowsForWord(args(audit));
    assert.equal(received.contextCN,translation);assert.equal(received.targetMeaning,'目录册');
    assert.equal(received.requireContentReview,true);
});
test('an approval boolean cannot publish a new row without its required translation and sense evidence',async()=>{
    const audit=async q=>({approved:true,status:'approved',validLetters:[q.answer]});audit.contentPolicy='question-content-v1';
    assert.equal((await buildCacheQuestionRowsForWord(args(audit))).length,0);
});
test('an old unpublished checkpoint cannot bypass the new content review requirement',async()=>{
    let published=false;
    const row={question_text:context,options,answer:'A',option_meanings:meanings,correct_meaning:'目录册',context_zh:translation,question_fingerprint:'old'};
    const service=createQuestionGenerationService({requiredContentPolicy:'question-content-v1',maxAttempts:1,loadWord:async()=>({id:'w',word:'catalogue',level:'高中',meaning_zh:'目录册'}),validateCandidate:()=>[],loadCheckpoint:async()=>null,generateCandidates:async()=>[row,{...row,question_text:'He used the _____ to look up a title.',question_fingerprint:'other',options:['A. catalogue','B. envelope','C. bookmark','D. map']}],publishReadyVariants:async()=>{published=true;}});
    await assert.rejects(service.process({word_id:'w',user_id:'u'}),e=>e.rejectionReasons?.content_review_missing>0);
    assert.equal(published,false);
});
test('selection rejects changed translations on rows carrying the content review marker',()=>{
    const q={level:'高中',context,contextCN:translation,options,answer:'A',optionMeanings:meanings,targetMeaning:'目录册'};
    const row={question_type:1,word:'catalogue',word_record_id:'w',question_fingerprint:'f',level:'高中',question_text:context,context_cn:'她关上目录册查找书名。',options,answer:'A',option_meanings:meanings,correct_meaning:'目录册',quality_status:'ready',ai_audit_status:'approved',source_version:'unique-answer-v2|question-content-v1',teaching_analysis:{contentReview:review(q)}};
    assert.ok(getCacheQuestionReadinessIssues(row,{requireAiAudit:true}).includes('content_review_missing'));
});
test('content translation rejection resumes its context without generating unrelated variants',async()=>{
    const checkpoint={variants:[]};let generated=0;
    const audit=async()=>({approved:false,status:'rejected',code:'content_translation'});
    audit.contentPolicy='question-content-v1';
    await buildCacheQuestionRowsForWord({...args(audit),generationCheckpoint:checkpoint,generateContext:async()=>{generated++;return 'He used the catalogue to find a title.';}});
    assert.equal(generated,0);
    assert.equal(checkpoint.variants[0].contextTranslation,undefined);
    assert.equal(checkpoint.variants[0].context,context.replace('_____','catalogue'));
});

test('overlap rejection keeps context and translation and resumes only distractors',async()=>{
    const checkpoint={variants:[]};let generated=0;
    const audit=async()=>({approved:false,status:'rejected',code:'content_option_overlap'});
    audit.contentPolicy='question-content-v1';
    await buildCacheQuestionRowsForWord({...args(audit),generationCheckpoint:checkpoint,generateContext:async()=>{generated++;return 'He used the catalogue to find a title.';}});
    assert.equal(generated,0);
    assert.equal(checkpoint.variants[0].context,context.replace('_____','catalogue'));
    assert.equal(checkpoint.variants[0].contextTranslation,translation);
    assert.equal(checkpoint.variants[0].distractors,undefined);
    assert.equal(checkpoint.variants[0].levelFitRepairStage,'distractors');
});
