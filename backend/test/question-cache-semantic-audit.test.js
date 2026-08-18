const test = require('node:test');
const assert = require('node:assert/strict');
const { auditQuestionCacheRows } = require('../question-cache-semantic-audit');

test('dry-run reports cache ids and per-user counts without changing rows', () => {
    const rows = [
        { id: 'cache-cushion', user_id: 'u1', word: 'cushion', quality_status: 'ready', cache_state: 'active', question_type: 1, question_text: 'Use a soft _____.', options: ['A. cushion','B. pillow','C. bolster','D. pad'], answer: 'A', option_meanings: ['垫子,软垫','枕头','长枕','垫子'], ai_audit_status: 'approved' },
        { id: 'cache-conference', user_id: 'u1', word: 'conference', quality_status: 'ready', cache_state: 'reserved_next_day', question_type: 1, question_text: 'Attend the _____.', options: ['A. seminar','B. conference','C. forum','D. symposium'], answer: 'B', option_meanings: ['研讨会','会议,研讨会','论坛','专题讨论会'], ai_audit_status: 'approved' },
        { id: 'cache-safe', user_id: 'u2', word: 'apple', quality_status: 'ready', cache_state: 'active', question_type: 1, question_text: 'Eat an _____.', options: ['A. apple','B. desk','C. chair','D. road'], answer: 'A', option_meanings: ['苹果','桌子','椅子','道路'], ai_audit_status: 'approved' },
    ];
    const before = JSON.stringify(rows);
    const report = auditQuestionCacheRows(rows, [{ id: 'u1', username: 'yusi' }, { id: 'u2', username: 'qiuqiu' }]);

    assert.equal(report.affectedCount, 2);
    assert.deepEqual(report.byUser, { yusi: 2 });
    assert.deepEqual(report.affected.map(item => item.cacheId), ['cache-cushion', 'cache-conference']);
    assert.equal(JSON.stringify(rows), before);
});

test('classifies skipped and missing semantic evidence instead of implying zero affected rows', () => {
    const rows = [
        {
            id: 'cache-skipped', user_id: 'u1', word: 'apple', quality_status: 'ready', cache_state: 'active',
            question_type: 1, question_text: 'She ate an _____ after lunch.',
            options: ['A. apple', 'B. desk', 'C. chair', 'D. road'], answer: 'A',
            option_meanings: ['\u82f9\u679c', '\u684c\u5b50', '\u6905\u5b50', '\u9053\u8def'], correct_meaning: '\u82f9\u679c',
            ai_audit_status: 'skipped',
        },
        {
            id: 'cache-missing-meanings', user_id: 'u1', word: 'pear', quality_status: 'ready', cache_state: 'reserved_next_day',
            question_type: 1, question_text: 'She bought a ripe _____ at the market.',
            options: ['A. pear', 'B. desk', 'C. chair', 'D. road'], answer: 'A',
            option_meanings: null, correct_meaning: '\u68a8', ai_audit_status: 'approved',
        },
    ];

    const report = auditQuestionCacheRows(rows, [{ id: 'u1', username: 'yusi' }]);

    assert.equal(report.affectedCount, 2);
    assert.equal(report.allEligibleAudited, false);
    assert.deepEqual(report.byReason, {
        missing_option_meanings: 1,
        not_ai_approved: 1,
        unauditable: 1,
    });
    assert.deepEqual(report.affected.map(item => item.reasons), [
        ['not_ai_approved'],
        ['missing_option_meanings', 'unauditable'],
    ]);
});

test('reports multi-answer readiness issues beyond overlapping Chinese meanings', () => {
    const report = auditQuestionCacheRows([{
        id: 'cache-ambiguous', user_id: 'u1', word: 'attic', quality_status: 'ready', cache_state: 'active',
        question_type: 1,
        question_text: 'The old chest hidden in the _____ was finally discovered after years of searching.',
        options: ['A. cave', 'B. tunnel', 'C. attic', 'D. basement'], answer: 'C',
        option_meanings: ['\u6d1e\u7a74', '\u96a7\u9053', '\u9601\u697c', '\u5730\u4e0b\u5ba4'], correct_meaning: '\u9601\u697c',
        ai_audit_status: 'approved',
    }], [{ id: 'u1', username: 'yusi' }]);

    assert.equal(report.affectedCount, 1);
    assert.deepEqual(report.affected[0].reasons, ['ambiguous_fill_in_context']);
    assert.deepEqual(report.multiAnswerReadinessIssues, { ambiguous_fill_in_context: 1 });
});

test('reports ambiguous racket-sport cache questions as multi-answer readiness issues', () => {
    const report = auditQuestionCacheRows([{
        id: 'cache-badminton', user_id: 'u1', word: 'badminton', quality_status: 'ready', cache_state: 'active',
        question_type: 1,
        question_text: 'After setting up the net in the backyard, they grabbed their rackets and started a lively game of _____.',
        options: ['A. badminton', 'B. volleyball', 'C. squash', 'D. tennis'], answer: 'A',
        option_meanings: [String.fromCharCode(0x7fbd, 0x6bdb, 0x7403), String.fromCharCode(0x6392, 0x7403), String.fromCharCode(0x58c1, 0x7403), String.fromCharCode(0x7f51, 0x7403)],
        correct_meaning: String.fromCharCode(0x7fbd, 0x6bdb, 0x7403), ai_audit_status: 'approved',
    }], [{ id: 'u1', username: 'qiuqiu' }]);

    assert.equal(report.affectedCount, 1);
    assert.deepEqual(report.affected[0].reasons, ['ambiguous_fill_in_context']);
    assert.deepEqual(report.multiAnswerReadinessIssues, { ambiguous_fill_in_context: 1 });
});

test('treats English-only option meanings as unauditable semantic evidence', () => {
    const report = auditQuestionCacheRows([{
        id: 'cache-english-meanings', user_id: 'u1', word: 'apple', quality_status: 'ready', cache_state: 'active',
        question_type: 1, question_text: 'She ate an _____ after lunch.',
        options: ['A. apple', 'B. desk', 'C. chair', 'D. road'], answer: 'A',
        option_meanings: ['fruit', 'furniture', 'seat', 'street'], correct_meaning: '\u82f9\u679c',
        ai_audit_status: 'approved',
    }]);

    assert.deepEqual(report.affected[0].reasons, ['missing_option_meanings', 'unauditable']);
    assert.equal(report.allEligibleAudited, false);
});
