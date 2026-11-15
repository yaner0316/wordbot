'use strict';
// Change this when an approved rule set changes. Historical snapshots keep their version.
const QUESTION_POLICY = 'context-learning-v3';
const {createHash}=require('node:crypto');
const clean=value=>String(value || '').trim();
const printed=value=>clean(value).replace(/^[A-D]\.\s*/i,'');
function stemInput(question) {
 const words=(question.options || []).map(printed);
 return {policy:QUESTION_POLICY,word:clean(question.word || question.canonicalWord).toLowerCase(),level:clean(question.level),
  context:clean(question.context || question.question_text),targetForm:clean(question.targetForm || words['ABCD'.indexOf(question.answer)]),
  targetMeaning:clean(question.targetMeaning || question.correctMeaning || question.correct_meaning)};
}
function stemFingerprint(question) {return createHash('sha256').update(JSON.stringify(stemInput(question))).digest('hex');}
function optionFingerprint(question) {return createHash('sha256').update(JSON.stringify({policy:QUESTION_POLICY,level:question.level,
 context:clean(question.context || question.question_text),options:(question.options || []).map(printed),answer:question.answer})).digest('hex');}
function hasCurrentStemReview(question,evidence) {
 const input=stemInput(question),sentence=input.context.replace(/_{3,}/g,input.targetForm);
 return evidence?.approved===true && evidence.policy===QUESTION_POLICY && evidence.inputFingerprint===stemFingerprint(question)
  && ['grammar','naturalness','sense','form','level','clue','burden'].every(key=>evidence.checks?.[key]?.pass===true
   && typeof evidence.checks[key].evidence==='string' && evidence.checks[key].evidence.length>=2 && sentence.includes(evidence.checks[key].evidence));
}
function hasCurrentQuestionPolicy(question,analysis=question.teachingAnalysis || question.teaching_analysis) {
 const source=question.sourceVersion || question.source_version;
 return clean(source).split('|').includes(QUESTION_POLICY) && analysis?.policy===QUESTION_POLICY
  && hasCurrentStemReview({...question,word:question.word || analysis.canonicalWord},analysis.stemReview)
  && analysis.auditMethod===require('./teaching-analysis').SEMANTIC_AUDIT_METHOD
  && analysis.inputFingerprint===require('./teaching-analysis').semanticAuditInputFingerprint(question)
  && analysis.senseVerified===true && analysis.senseFingerprint===require('./teaching-analysis').semanticSenseFingerprint(question)
  && require('./question-content-review').hasCurrentContentReview(question,analysis.contentReview)
  && require('./teaching-analysis').getTeachingAnalysisIssues(question,analysis).length===0;
}
module.exports={QUESTION_POLICY,stemInput,stemFingerprint,optionFingerprint,hasCurrentStemReview,hasCurrentQuestionPolicy};
