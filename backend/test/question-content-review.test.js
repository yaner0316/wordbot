'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseContentReview, hasCurrentContentReview } = require('../question-content-review');
const q = { level:'高中', context:'She opened the _____ to find the book title.',
    options:['A. catalogue','B. passport','C. diary','D. receipt'], answer:'A',
    optionMeanings:['目录册','护照','日记','收据'], targetMeaning:'目录册',
    contextCN:'她打开目录册查找书名。' };
function evidence() {
    return { targetSense:{providedPartsOfSpeech:['noun'], contextualPartOfSpeech:'noun'},
        translation:{text:q.contextCN, accurate:true, reason:'译文保留了打开目录册和查找书名的动作。'},
        optionMeanings:q.options.map((word,i)=>({letter:'ABCD'[i],meaning:q.optionMeanings[i],accurate:true,
            reason:'所给中文释义属于这个英文选项的真实词义。'})) };
}
test('the supplied noun sense cannot approve a verb merely because the words are related', () => {
    const e=evidence();e.targetSense.contextualPartOfSpeech='verb';
    assert.equal(parseContentReview(q,e).code,'semantic_expected_sense_mismatch');
});
test('a mistranslation and an incorrect option gloss route to their respective repairs', () => {
    const e=evidence();e.translation.accurate=false;
    assert.equal(parseContentReview(q,e).code,'content_translation');
    const e2=evidence();e2.optionMeanings[1].accurate=false;
    assert.equal(parseContentReview(q,e2).code,'content_option_meanings');
});
test('a missing review or a review of another translation cannot approve', () => {
    assert.equal(parseContentReview(q,null).approved,false);
    const e=evidence();e.translation.text='她关闭了目录册。';
    assert.equal(parseContentReview(q,e).approved,false);
});
test('content review covers the printed question, teaching translation, target sense and every option gloss', () => {
    const result=parseContentReview(q,evidence());assert.equal(result.approved,true);
    assert.equal(hasCurrentContentReview(q,result.contentReview),true);
    for(const change of [{contextCN:'她关闭了目录册。'}, {targetMeaning:'编制目录'},
        {optionMeanings:['目录册','通行证','日记','收据']}, {level:'小学'}]) {
        assert.equal(hasCurrentContentReview({...q,...change},result.contentReview),false);
    }
    const shuffled={...q,options:['A. passport','B. catalogue','C. diary','D. receipt'],answer:'B',optionMeanings:['护照','目录册','日记','收据']};
    assert.equal(hasCurrentContentReview(shuffled,result.contentReview),true);
});
test('an unsupported or ungrounded sense classification fails closed', () => {
    for(const supplied of [[],['unknown'],['noun','unknown']]) {
        const e=evidence();e.targetSense.providedPartsOfSpeech=supplied;
        assert.equal(parseContentReview(q,e).approved,false);
    }
});

test('cache-shape canonical meanings cannot be replaced by the meaning stored in old evidence', () => {
    const approved = parseContentReview(q, evidence()).contentReview;
    const {targetMeaning, ...cacheQuestion} = q;
    for (const key of ['correctMeaning', 'correct_meaning']) {
        assert.equal(hasCurrentContentReview({...cacheQuestion, [key]:targetMeaning}, approved), true);
        assert.equal(hasCurrentContentReview({...cacheQuestion, [key]:'编制目录'}, approved), false);
    }
});

function distinctPairs() {
    return ['AB','AC','AD','BC','BD','CD'].map(pair=>({letters:[...pair],relation:'distinct',reason:'这两个选项所给含义不同，彼此不存在同义或包含关系。'}));
}

test('fresh review must explicitly compare option meanings, while legacy evidence stays compatible', () => {
    const e = evidence();
    assert.equal(parseContentReview(q,e,{requireOptionSeparation:true}).code,'content_review_missing');
    e.optionPairs=distinctPairs();
    const result=parseContentReview(q,e,{requireOptionSeparation:true});
    assert.equal(result.approved,true);
    assert.equal(hasCurrentContentReview(q,result.contentReview),true);
    const shuffled={...q,options:['A. passport','B. catalogue','C. diary','D. receipt'],answer:'B',optionMeanings:['护照','目录册','日记','收据']};
    assert.equal(hasCurrentContentReview(shuffled,result.contentReview),true);
    assert.equal(parseContentReview(q,evidence()).approved,true);
});

test('semantic overlap replaces distractors rather than relabeling correct glosses', () => {
    const {checkpointInvalidationStageForIssues,invalidateVariantFromStage}=require('../question-generation-checkpoint');
    const e=evidence();
    e.optionPairs=distinctPairs();
    e.optionPairs[0]={letters:['A','B'],relation:'includes',reason:'两个选项的真实词义存在包含关系，不能作为独立选项。'};
    const result=parseContentReview(q,e,{requireOptionSeparation:true});
    assert.equal(result.code,'content_option_overlap');
    const stage=checkpointInvalidationStageForIssues([result.code]);
    assert.equal(stage,'distractors');
    const repaired=invalidateVariantFromStage({context:q.context,contextTranslation:q.contextCN,options:q.options,optionMeanings:q.optionMeanings,audit:{}},stage);
    assert.equal(repaired.context,q.context);
    assert.equal(repaired.contextTranslation,q.contextCN);
    assert.equal(repaired.options,undefined);
});

test('malformed pair comparisons cannot approve a fresh review', () => {
    for(const pairs of [null,{},[],distinctPairs().slice(1),Array(6).fill(distinctPairs()[0]),
        distinctPairs().map((pair,i)=>i?pair:{...pair,letters:['A','Z']}),
        distinctPairs().map((pair,i)=>i?pair:{...pair,relation:'unknown'})]) {
        assert.equal(parseContentReview(q,{...evidence(),optionPairs:pairs},{requireOptionSeparation:true}).approved,false);
    }
});
