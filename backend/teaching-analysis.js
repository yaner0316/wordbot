'use strict';
const TEACHING_ANALYSIS_POLICY = 'teaching-analysis-v1';
const clean = value => String(value || '').trim();
const optionWord = value => clean(value).replace(/^[A-D]\.\s*/, '').toLowerCase();
const chineseReason = value => /[\u3400-\u9fff]/.test(clean(value)) && clean(value).length >= 8 && clean(value).length <= 500;

function getTeachingAnalysisIssues(question, analysis) {
    if (!analysis || analysis.schemaVersion !== 1) return ['teaching_analysis_missing'];
    const issues = [];
    const context = clean(question.context || question.question_text || question.question);
    const words = (question.options || []).map(optionWord);
    const answer = clean(question.answer || question.correctAnswer).toUpperCase();
    const expected = words['ABCD'.indexOf(answer)];
    const clue = clean(analysis.clue);
    if (clue.length < 3 || /_{3,}/.test(clue) || !context.toLowerCase().includes(clue.toLowerCase())) issues.push('teaching_clue_not_in_context');
    if (!chineseReason(analysis.clueReason) || !chineseReason(analysis.correctReason)) issues.push('teaching_reason_missing');
    const options = Array.isArray(analysis.options) ? analysis.options : [];
    if (words.length !== 4 || options.length !== 4 || new Set(options.map(item=>optionWord(item.word))).size !== 4
        || !options.every(item => words.includes(optionWord(item.word)) && typeof item.fits === 'boolean'
            && /[\u3400-\u9fff]/.test(clean(item.meaning)) && clean(item.meaning).length <= 80 && chineseReason(item.reason))) issues.push('teaching_options_incomplete');
    const fitting = options.filter(item => item.fits === true);
    if (!expected || fitting.length !== 1 || optionWord(fitting[0]?.word) !== expected || optionWord(analysis.correctWord) !== expected) issues.push('teaching_non_unique_answer');
    return issues;
}
function teachingAnalysisFromAudit(question, audit) {
    const judgments = Array.isArray(audit?.optionJudgments) ? audit.optionJudgments : [];
    // Letters are used only at the audit boundary. Persist by word identity so
    // rearranging option letters cannot attach a distractor's reason to another word.
    const words = (question.options || []).map(optionWord);
    if (judgments.length !== 4 || new Set(judgments.map(item=>item.letter)).size !== 4
        || !judgments.every(item=>/^[A-D]$/.test(item.letter))) return null;
    const analysis = {schemaVersion:1,clue:clean(audit.clue),clueReason:clean(audit.clueReason),correctWord:words['ABCD'.indexOf(question.answer)],correctReason:clean(audit.correctReason),
        options:judgments.map(item=>({word:words['ABCD'.indexOf(item.letter)],fits:item.fits,meaning:clean(item.meaning),reason:clean(item.reason)}))};
    return getTeachingAnalysisIssues(question,analysis).length ? null : analysis;
}
module.exports = {TEACHING_ANALYSIS_POLICY,getTeachingAnalysisIssues,teachingAnalysisFromAudit};
