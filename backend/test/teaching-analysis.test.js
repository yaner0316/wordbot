'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {auditUniqueAnswer} = require('../question-semantic-audit');
const question = {type:1,context:'She packed a shiny red _____ in her lunchbox for school today.',options:['A. apple','B. banana','C. grape','D. orange'],answer:'A',optionMeanings:['苹果','香蕉','葡萄','橙子']};
const reply = {
  certain:true,validLetters:['A'],clue:'shiny red',clueReason:'颜色和外观是句中提供的线索。',correctReason:'这个上下文描写的是红色水果。',
  optionJudgments:[
    {letter:'A',fits:true,meaning:'苹果',reason:'红苹果是可放入午餐盒的水果。'},
    {letter:'B',fits:false,meaning:'香蕉',reason:'普通香蕉的颜色与红色描写不符。'},
    {letter:'C',fits:true,meaning:'葡萄',reason:'一颗红葡萄也可以放入午餐盒。'},
    {letter:'D',fits:false,meaning:'橙子',reason:'普通橙子的颜色与红色描写不符。'},
  ],
};
test('historical red fruit sample cannot pass by claiming A while another option is plausible', async () => {
  const result = await auditUniqueAnswer(question,{callModel:async()=>JSON.stringify(reply)});
  assert.equal(result.approved,false);
});
test('approved boolean and a lone letter without evidence never establish question quality',async()=>{
  const result=await auditUniqueAnswer(question,{callModel:async()=>JSON.stringify({approved:true,certain:true,validLetters:['A']})});
  assert.equal(result.approved,false);
});
test('grounded evidence is keyed to the option word so shuffled answers keep their reasons',async()=>{
  const q={...question,context:'She picked an _____ from the tree and baked an apple pie.',options:['A. orange','B. grape','C. apple','D. banana'],answer:'C'};
  const evidence={...reply,validLetters:['C'],clue:'baked an apple pie',correctReason:'苹果派要用苹果，后半句明确指出用途。',optionJudgments:[
    {letter:'A',fits:false,meaning:'橙子',reason:'橙子不能满足句中明确的苹果派用途。'},
    {letter:'B',fits:false,meaning:'葡萄',reason:'葡萄不能满足句中明确的苹果派用途。'},
    {letter:'C',fits:true,meaning:'苹果',reason:'苹果是句中苹果派所需要的水果。'},
    {letter:'D',fits:false,meaning:'香蕉',reason:'香蕉不能满足句中明确的苹果派用途。'},
  ]};
  const result=await auditUniqueAnswer(q,{callModel:async()=>JSON.stringify(evidence)});
  assert.equal(result.approved,true);
  assert.equal(result.teachingAnalysis.options.find(item=>item.word==='grape').reason,evidence.optionJudgments[1].reason);
  const {getTeachingAnalysisIssues}=require('../teaching-analysis');
  assert.deepEqual(getTeachingAnalysisIssues({...q,answer:'A',options:['A. apple','B. orange','C. banana','D. grape']},result.teachingAnalysis),[]);
  assert.ok(getTeachingAnalysisIssues({...q,context:'Another _____ sentence.'},result.teachingAnalysis).includes('teaching_clue_not_in_context'));
});
