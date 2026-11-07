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
