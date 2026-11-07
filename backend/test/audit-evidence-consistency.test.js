'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { auditUniqueAnswer, buildCriticalExclusionPrompt } = require('../question-semantic-audit');

const question = {
    level: '高中', context: 'The teacher will _____ the essays using the marking guide.',
    options: ['A. assess', 'B. evaluated', 'C. measured', 'D. graded'], answer: 'A',
    optionMeanings: ['评估', '评价', '测量', '评分'],
};
function judgments(grammar) {
    return { certain: true, optionJudgments: question.options.map((option, index) => ({
        letter: 'ABCD'[index], word: option.slice(3), fits: index === 0,
        exclusion: index === 0 ? 'none' : grammar ? 'grammar' : 'contradiction',
        clueIndex: 0, meaning: question.optionMeanings[index],
        reason: index === 0 ? '教师按照评分指南评估作文，句子可以成立。'
            : grammar ? 'will后应接动词原形，该选项是过去式。' : '此测试响应声明语境排除了该干扰项。',
    })) };
}
function contradictorySenseResponse() {
    return { matches: true, providedSense: '评估', contextualSense: '评估', reason: '句中评估作文符合给定的目标词义。',
        surface: { options: question.options.map((option, index) => ({
            letter: 'ABCD'[index], word: option.slice(3), grammatical: true,
            reason: '此后续模型响应错误地把所有词形判断为正确。',
        })) },
        levelFit: { status: 'suitable', clue: 'using the marking guide',
            vocabularyReason: '评分指南和作文是可理解的课堂词汇。', syntaxReason: '主谓宾和方式状语的结构关系清晰。',
            reasoningReason: '按照评分指南处理作文不需专业背景。', optionsReason: '此测试响应错误地宣称各选项均可用。',
            barriers: [], repairStage: 'none' },
    };
}
for (const grammarOn of [1, 2]) {
    test(`grammar used to establish uniqueness in review ${grammarOn} cannot be overridden by a later approval`, async () => {
        let calls = 0;
        const result = await auditUniqueAnswer(question, { callModel: async prompt => {
            calls++;
            return JSON.stringify(prompt.startsWith('WORD SENSE CHECK')
                ? contradictorySenseResponse() : judgments(calls === grammarOn));
        } });
        assert.equal(result.approved, false);
        assert.equal(result.code, 'surface_distractors');
        assert.equal(result.teachingAnalysis, undefined);
        assert.equal(calls, grammarOn);
    });
}
test('the second uniqueness review receives no first-review answer cues or reasons', () => {
    const prompt = buildCriticalExclusionPrompt(question, [{ letter: 'A', reason: 'UNTRUSTED_FIRST_REVIEW_HINT' }]);
    assert.ok(!prompt.includes('UNTRUSTED_FIRST_REVIEW_HINT'));
    assert.ok(!prompt.includes('untrustedClaims'));
    assert.match(prompt, /CRITICAL EXCLUSION CHECK/);
    assert.ok(!prompt.includes('expectedAnswer'));
});
test('production content review cannot be omitted even when earlier model judgments approve',async()=>{
    const result=await auditUniqueAnswer({...question,requireContentReview:true,contextCN:'教师用评分指南评估作文。',targetMeaning:'评估'},
        {callModel:async prompt=>JSON.stringify(prompt.startsWith('WORD SENSE CHECK')?contradictorySenseResponse():judgments(false))});
    assert.equal(result.approved,false);assert.equal(result.code,'content_review_missing');
});
test('production review rejects a judgment copied from a different printed option',async()=>{
    const reply=judgments(false);
    reply.optionJudgments=reply.optionJudgments.map((j,i)=>({...j,word:question.options[i].slice(3)}));
    reply.optionJudgments[3].word='assess';
    const result=await auditUniqueAnswer({...question,requireContentReview:true}, {callModel:async prompt=>JSON.stringify(prompt.startsWith('WORD SENSE CHECK')?contradictorySenseResponse():reply)});
    assert.equal(result.approved,false);
    assert.equal(result.code,'semantic_evidence_invalid');
});

test('fresh production review requires pair evidence and propagates overlap rejection',async()=>{
    const q={...question,requireContentReview:true,contextCN:'教师用评分指南评估作文。',targetMeaning:'评估'};
    const distinct=['AB','AC','AD','BC','BD','CD'].map(pair=>({letters:[...pair],relation:'distinct',reason:'测试响应声明两个词的所给含义不同，彼此不包含。'}));
    const overlap=distinct.map((pair,i)=>i?pair:{...pair,relation:'synonymous',reason:'测试响应声明这两个选项在所给含义上同义。'});
    for (const [pairs,code] of [[undefined,'content_review_missing'],
        [overlap,'content_option_overlap'],[distinct,undefined]]) {
        let calls=0;
        const result=await auditUniqueAnswer(q,{callModel:async prompt=>{
            calls++;
            if (!prompt.startsWith('WORD SENSE CHECK')) return JSON.stringify(judgments(false));
            const response=contradictorySenseResponse();
            response.contentReview={targetSense:{providedPartsOfSpeech:['verb'],contextualPartOfSpeech:'verb'},
                translation:{text:q.contextCN,accurate:true,reason:'测试响应保留教师评分作文这一动作。'},
                optionMeanings:q.optionMeanings.map((meaning,i)=>({letter:'ABCD'[i],meaning,accurate:true,reason:'测试响应声明所给释义属于该词的真实含义。'})),
                ...(pairs===undefined?{}:{optionPairs:pairs})};
            return JSON.stringify(response);
        }});
        assert.equal(calls,3);
        assert.equal(result.approved,code===undefined);
        if(code) assert.equal(result.code,code);
    }
});
