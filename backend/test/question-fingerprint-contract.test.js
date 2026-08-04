const test = require('node:test');
const assert = require('node:assert/strict');

const { fingerprintQuestion } = require('../question-generation-service');
const { hasRequiredReadyVariants } = require('../question-generation-job');

test('reordered options do not make an identical question stem a distinct variant', () => {
    const first = fingerprintQuestion({
        question_text: 'She deposited money at the bank.',
        question_type: '1',
        correct_meaning: '银行',
        options: ['bank', 'shore', 'desk', 'road'],
        answer: 'A',
    }, 'word-bank');
    const reordered = fingerprintQuestion({
        question_text: '  SHE deposited money at the bank. ',
        question_type: '1',
        correct_meaning: '银行',
        options: ['road', 'desk', 'shore', 'bank'],
        answer: 'D',
    }, 'word-bank');
    assert.equal(reordered, first);
});

test('ready variant check cannot be weakened below two or satisfied without stems', () => {
    const rows = [
        { word_id: 'word-bank', round_type: 'primary', quality_status: 'ready', question_fingerprint: 'a' },
        { word_id: 'word-bank', round_type: 'primary', quality_status: 'ready', question_fingerprint: 'b' },
    ];
    assert.equal(hasRequiredReadyVariants(rows, 'word-bank', 1), false);
});

test('ready variant check accepts two distinct fingerprints with genuine stems', () => {
    const rows = [
        { word_id: 'word-bank', round_type: 'primary', quality_status: 'ready', question_text: 'She deposited money at the bank.', question_fingerprint: 'a' },
        { word_id: 'word-bank', round_type: 'primary', quality_status: 'ready', question_text: 'The bank approved the loan.', question_fingerprint: 'b' },
    ];
    assert.equal(hasRequiredReadyVariants(rows, 'word-bank', 1), true);
});
