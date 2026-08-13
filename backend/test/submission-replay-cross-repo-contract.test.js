const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { rebuildSubmittedResult } = require('../submission-coordinator');

test('backend replay DTO normalizes into the frontend canonical answer-analysis contract', () => {
    const replay = rebuildSubmittedResult([{ fields: {
        test_id: 'real-contract', meaning_id: 'meaning-1', record_id: 'rec-1', word: 'bank',
        question_type: '1', context: 'Use the _____.',
        options: '["A. bank","B. river","C. desk","D. road"]', correct_answer: 'A',
        context_cn: '使用银行。', option_meanings: '["银行","河流","桌子","道路"]',
        your_answer: 'B|sure', is_correct: 'wrong',
    }}], value => value === 'correct').results[0];
    const webLogicPath = process.env.WORDBOT_WEB_CONTRACT_PATH
        || path.resolve(__dirname, '..', '..', '..', 'qiuqiu-parent-repair-web-20260811', 'src', 'quiz-logic.js');
    const webLogic = fs.readFileSync(webLogicPath, 'utf8');
    const context = {};
    vm.createContext(context);
    vm.runInContext(webLogic, context);
    const normalized = context.WordBotQuizLogic.normalizeApiPayload({ results: [replay] }).results[0];

    assert.equal(normalized.meaningId, 'meaning-1');
    assert.equal(normalized.question, 'Use the _____.');
    assert.equal(normalized.options.length, 4);
    assert.equal(normalized.optionMeanings.length, 4);
    assert.equal(normalized.translation, '使用银行。');
    assert.equal(normalized.your, 'B');
    assert.equal(normalized.answer, 'A');
});
