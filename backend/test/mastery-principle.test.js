const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateMeaningMastery, evaluateWordMastery } = require('../mastery-evidence');
const { toFeishuAssessmentRecord } = require('../quiz-adapter');
const hour = 3600000;
const record = (index, correct, context, kind='context_evidence') => ({record_id:'assessment-'+index, fields:{record_id:'meaning-1',test_id:'real-session-'+index,test_time:Date.UTC(2026,8,1)+index*24*hour,is_correct:correct,context,assessment_kind:kind}});
const evaluate = records => evaluateMeaningMastery(records, value => value === true);
for (const kind of ['', 'context_evidence']) {
 test(`${kind || 'legacy'}: wrong resets evidence and next distinct pair masters`, () => {
  const rows=[record(1,true,'First ____ context',kind),record(2,false,'Second ____ context',kind),record(3,true,'Third ____ context',kind)];
  assert.equal(evaluate(rows).mastered,false);
  assert.equal(evaluate(rows).evidenceCount,1);
  assert.equal(evaluate([...rows,record(4,true,'Fourth ____ context',kind)]).mastered,true);
 });
 test(`${kind || 'legacy'}: same stem with cosmetic changes cannot master`, () => {
  assert.equal(evaluate([record(1,true,'The ____ works.',kind),record(2,true,'  THE _____  works. ',kind)]).mastered,false);
 });
 test(`${kind || 'legacy'}: missing question content cannot prove distinctness`, () => {
  assert.equal(evaluate([record(1,true,'',kind),record(2,true,'',kind)]).mastered,false);
 });
 test(`${kind || 'legacy'}: two different stems master`, () => {
  assert.equal(evaluate([record(1,true,'First ____ context',kind),record(2,true,'Second ____ context',kind)]).mastered,true);
 });
 test(`${kind || 'legacy'}: duplicate assessment cannot become a second success`, () => {
  const first=record(1,true,'First ____ context',kind);const repeated=record(2,true,'Second ____ context',kind);
  repeated.record_id=first.record_id; repeated.fields.test_id=first.fields.test_id;
  assert.equal(evaluate([first,repeated]).mastered,false);
 });
}
test('mixed assessment kinds cannot hide an intervening wrong answer',()=>{
 assert.equal(evaluate([record(1,true,'First'),record(2,false,'Second',''),record(3,true,'Third')]).mastered,false);
});
test('adapter preserves boolean false as a submitted wrong answer',()=>{
 const rows=[record(1,true,'First'),toFeishuAssessmentRecord({id:'wrong',source_word_record_id:'meaning-1',test_id:'real-wrong',assessed_at:new Date(Date.UTC(2026,8,3)).toISOString(),is_correct:false,question_text:'Second'},{username:'synthetic'}),record(3,true,'Third')];
 assert.equal(evaluate(rows).mastered,false);
});
test('partially mastered multi-meaning word never reports mastered stage',()=>{
 const rows=[record(1,true,'First'),record(2,true,'Second')];
 const result=evaluateWordMastery(['meaning-1','meaning-2'],rows,value=>value===true);
 assert.equal(result.mastered,false);assert.notEqual(result.stage,'mastered');
});
test('adapter keeps assessment identity distinct from meaning identity',()=>{
 const rows=[1,2].map(i=>toFeishuAssessmentRecord({id:`assessment-${i}`,source_word_record_id:'meaning-1',test_id:`real-session-${i}`,assessed_at:new Date(Date.UTC(2026,8,i)).toISOString(),is_correct:true,question_text:`Context ${i}`},{username:'synthetic'}));
 assert.equal(evaluate(rows).mastered,true);
});
const {submitQuizWithDataSource}=require('../quiz-adapter');
const {buildQuizWordQueue}=require('../quiz-word-queue');
const {toFeishuWordRecord}=require('../quiz-adapter');
for(const selected of [false,true]) test(`full formal submissions and queue follow the same mastery rule (selected=${selected})`,async()=>{
 const words=Array.from({length:10},(_,i)=>({id:`word-${i}`,feishu_record_id:`meaning-${i}`,word:'apple',username:'synthetic',entered_at:'2026-07-01T00:00:00Z',quality_flags:selected?['selected_sense_flow_v1']:[]}));
 const rows=selected?words.flatMap(w=>[{id:`initial-${w.id}`,source_word_record_id:w.feishu_record_id,assessment_kind:'initial_context',test_id:'real-initial',is_correct:'correct',assessed_at:'2026-07-01T00:00:00Z',question_text:'Initial context'},{id:`review-${w.id}`,source_word_record_id:w.feishu_record_id,assessment_kind:'review',review_status:'complete',test_id:'real-review-done',is_correct:'correct',assessed_at:'2026-07-02T00:00:00Z'}]):[];
 const statuses=new Map();
 const dataSource={getWordsForUser:async()=>words,getMasteryAssessmentsForWords:async()=>rows.slice(),submitAssessments:async inputs=>{const inserted=inputs.map(x=>({id:x.testId+'-'+x.sourceWordRecordId,source_word_record_id:x.sourceWordRecordId,test_id:x.testId,assessment_kind:x.assessmentKind,is_correct:x.correctness,assessed_at:new Date(x.recordTime).toISOString(),question_text:x.questionText,submitted_answer:x.yourAnswer}));rows.push(...inserted);return inserted;},updateWordMastery:async(user,word,status,options)=>statuses.set(options.sourceWordRecordId,status)};
 for(const [round,answer] of [0,1,0,0].entries()){
  await submitQuizWithDataSource({username:'synthetic',testId:`real-round-${round}`,answers:Array.from({length:10},()=>({option:answer})),questions:words.map(w=>({record_id:w.feishu_record_id,word:w.word,type:1,source:'question_cache',cacheRecordId:`cache-${round}-${w.id}`,context:`Round ${round} fresh ____ sentence.`,options:['A. apple','B. desk','C. road','D. school'],answer:'A',correctAnswer:'A'})),dataSource,now:()=>Date.UTC(2026,8,round+1)});
  assert.ok([...statuses.values()].every(s=>s===['consolidating','recognized','consolidating','mastered'][round]));
 }
 const queue=buildQuizWordQueue({wordRecords:words.map(w=>toFeishuWordRecord(w,{username:'synthetic'})),assessmentRecords:rows.map(r=>toFeishuAssessmentRecord(r,{username:'synthetic'})),userId:'synthetic',now:Date.UTC(2026,8,10)});
 assert.equal(queue.length,0);
});
for(const kind of ['', 'context_evidence']) test(`interval boundary policy is uniform: ${kind}`,()=>{
 for(const [gap,expected] of [[18*hour-1,false],[18*hour,true],[720*hour,true],[720*hour+1,false]]){
  const a=record(1,true,'First',kind),b=record(2,true,'Second',kind);b.fields.test_time=a.fields.test_time+gap;
  assert.equal(evaluate([a,b]).mastered,expected);
 }
});
