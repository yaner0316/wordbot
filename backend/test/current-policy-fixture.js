'use strict';
// Synthetic attestations for supply/transport tests ONLY. Not a language-quality oracle.
const {QUESTION_POLICY,stemFingerprint}=require('../question-policy');
const {SEMANTIC_AUDIT_METHOD,semanticAuditInputFingerprint,semanticSenseFingerprint}=require('../teaching-analysis');
const {CONTENT_REVIEW_POLICY,contentFingerprint}=require('../question-content-review');
const parse=v=>{try{const a=typeof v==='string'?JSON.parse(v):v;return Array.isArray(a)?a:[];}catch{return [];}};
function attestRow(row,word) {
 const options=parse(row.options || []),meanings=parse(row.option_meanings || row.optionMeanings || []),answer=row.answer;
 const words=options.map(v=>v.replace(/^[A-D]\.\s*/,'')),index='ABCD'.indexOf(answer);
 const q={word:word || row.word || words[index],level:row.level || '中学',context:row.question_text || row.context || '',
  targetMeaning:row.correct_meaning || row.correctMeaning || row.targetMeaning || meanings[index],contextCN:row.context_zh || row.context_cn || row.contextCN,
  options,answer,optionMeanings:meanings};
 const clue=q.context.split(/_{3,}/).map(s=>s.trim()).find(s=>s.length>=3) || q.context;
 const reason='测试夹具中的有效审核证据，用于验证供应流程。';
 const analysis={schemaVersion:1,policy:QUESTION_POLICY,canonicalWord:q.word,auditMethod:SEMANTIC_AUDIT_METHOD,
  inputFingerprint:semanticAuditInputFingerprint(q),senseVerified:true,senseFingerprint:semanticSenseFingerprint(q),
  clue,clueReason:reason,correctWord:words[index]?.toLowerCase(),correctReason:reason,
  options:words.map((word,i)=>({word:word.toLowerCase(),fits:i===index,meaning:meanings[i],reason})),
  stemReview:{approved:true,status:'approved',policy:QUESTION_POLICY,inputFingerprint:stemFingerprint(q),checks:Object.fromEntries(['grammar','naturalness','sense','form','level','clue','burden'].map(k=>[k,{pass:true,evidence:clue,reason}]))},
  contentReview:{policy:CONTENT_REVIEW_POLICY,inputFingerprint:contentFingerprint(q),targetMeaning:q.targetMeaning,
   targetSense:{providedPartsOfSpeech:['noun'],contextualPartOfSpeech:'noun',matches:true,contextualSense:q.targetMeaning,reason},
   translation:{text:q.contextCN,accurate:true,reason},optionMeanings:words.map((word,i)=>({word,meaning:meanings[i],accurate:true,reason}))}};
 return {...row,ai_audit_status:'approved',source_version:`test-fixture|unique-answer-v3|${QUESTION_POLICY}|${SEMANTIC_AUDIT_METHOD}|teaching-analysis-v1|${CONTENT_REVIEW_POLICY}`,teaching_analysis:analysis};
}
function approveAudit(q){const analysis=attestRow(q).teaching_analysis;return {approved:true,status:'approved',validLetters:[q.answer],auditMethod:SEMANTIC_AUDIT_METHOD,inputFingerprint:analysis.inputFingerprint,senseFingerprint:analysis.senseFingerprint,senseVerified:true,targetFormVerified:true,teachingAnalysis:analysis};}
module.exports={attestRow,approveAudit};
