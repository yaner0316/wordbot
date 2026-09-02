'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    SELECTED_SENSE_FLOW_FLAG,
    buildMeaningChoiceOptions,
    getSelectedSenseContextStage,
    hasCompletedSelectedSenseReview,
} = require('../selected-sense-flow');

test('selected sense contexts progress from initial to evidence only after review', () => {
    const word = { quality_flags: [SELECTED_SENSE_FLOW_FLAG] };
    assert.equal(getSelectedSenseContextStage(word, []), 'initial_context');
    assert.equal(getSelectedSenseContextStage(word, [{ assessment_kind: 'initial_context' }]), null);
    assert.equal(getSelectedSenseContextStage(word, [
        { assessment_kind: 'initial_context' },
        { assessment_kind: 'review', review_status: 'complete', is_correct: 'correct' },
    ]), 'context_evidence');
    assert.equal(getSelectedSenseContextStage({ quality_flags: [] }, []), null);
});

test('a submitted selected-sense review unlocks later context even when the review answer was wrong', () => {
    assert.equal(hasCompletedSelectedSenseReview([
        { assessment_kind: 'review', review_status: 'complete', is_correct: 'wrong' },
    ]), true);
    assert.equal(hasCompletedSelectedSenseReview([
        { assessment_kind: 'review', review_status: 'active', is_correct: null },
    ]), false);
});

test('staged-flow helpers accept the quiz queue field shape', () => {
    const word = { fields: { Quality_Flags: SELECTED_SENSE_FLOW_FLAG } };
    assert.equal(getSelectedSenseContextStage(word, [{ fields: { assessment_kind: 'initial_context' } }]), null);
    assert.equal(getSelectedSenseContextStage(word, [
        { fields: { assessment_kind: 'initial_context' } },
        { fields: { assessment_kind: 'review', review_status: 'complete' } },
    ]), 'context_evidence');
});

test('meaning review options include the target and three distinct Chinese senses in randomized order', () => {
    const swaps = [0.3, 0.9, 0.1];
    const question = buildMeaningChoiceOptions({
        correctMeaning: '河岸',
        candidateMeanings: ['银行', '精神', '机会', '河岸', '银行'],
        random: () => swaps.shift() ?? 0.9,
    });
    assert.deepEqual(question.options, ['机会', '河岸', '精神', '银行']);
    assert.equal(question.answer, 'B');
});

test('meaning review is unavailable instead of guessing when three distinct distractor senses do not exist', () => {
    assert.equal(buildMeaningChoiceOptions({
        correctMeaning: '河岸',
        candidateMeanings: ['银行', '河岸'],
    }), null);
});
