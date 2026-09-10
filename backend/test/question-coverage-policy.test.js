'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    hasCurrentQuestionCoverage,
    isCoverageTarget,
    planQuestionCoverage,
} = require('../question-coverage-policy');

function word(overrides = {}) {
    return {
        id: 'word-1',
        user_id: 'user-1',
        word: 'bank',
        mastery_status: 'pending',
        question_generation_version: 3,
        ...overrides,
    };
}

function cache(slot, overrides = {}) {
    return {
        id: `cache-${slot}`,
        user_id: 'user-1',
        word_id: 'word-1',
        source_word_record_id: 'word-1',
        word: 'bank',
        level: '小学',
        round_type: 'primary',
        quality_status: 'ready',
        cache_state: slot === 1 ? 'active' : 'reserved_next_day',
        variant_slot: slot,
        question_type: '1',
        question_text: slot === 1
            ? 'The _____ opens early on weekdays.'
            : 'She deposited her savings at the _____.',
        context_zh: slot === 1 ? '这家银行在工作日很早开门。' : '她把积蓄存进了银行。',
        options: slot === 1
            ? ['A. bank', 'B. river', 'C. school', 'D. garden']
            : ['A. bank', 'B. bridge', 'C. market', 'D. library'],
        option_meanings: slot === 1
            ? ['银行', '河流', '学校', '花园']
            : ['银行', '桥', '市场', '图书馆'],
        answer: 'A',
        correct_meaning: '银行',
        question_fingerprint: `fingerprint-${slot}`,
        ai_audit_status: 'approved',
        source_version: 'supabase-contextual-variant-v3|unique-answer-v2',
        ...overrides,
    };
}

test('coverage targets every existing non-mastered meaning regardless of learning stage', () => {
    for (const masteryStatus of [null, 'pending', 'unseen', 'recognized', 'consolidating']) {
        assert.equal(isCoverageTarget(word({ mastery_status: masteryStatus })), true);
    }
    assert.equal(isCoverageTarget(word({ mastery_status: 'mastered' })), false);
    assert.equal(isCoverageTarget(word({ mastery_status: 'deleted' })), false);
    assert.equal(isCoverageTarget(word({ deleted_at: '2026-09-10T00:00:00.000Z' })), false);
});

test('current coverage uses the user current level rather than the meaning historical level', () => {
    const target = word({ level: '初中' });
    const user = { id: 'user-1', learning_level: '小学' };

    assert.equal(hasCurrentQuestionCoverage({ word: target, user, cacheRows: [cache(1), cache(2)] }), true);
    assert.equal(hasCurrentQuestionCoverage({
        word: target,
        user,
        cacheRows: [cache(1, { level: '初中' }), cache(2, { level: '初中' })],
    }), false);
});

test('current coverage rejects stale audit policy, duplicate stems, and overlapping distractors', () => {
    const target = word();
    const user = { id: 'user-1', learning_level: '小学' };

    assert.equal(hasCurrentQuestionCoverage({
        word: target,
        user,
        cacheRows: [cache(1), cache(2, { source_version: 'supabase-contextual-variant-v3|unique-answer-v1' })],
    }), false);
    assert.equal(hasCurrentQuestionCoverage({
        word: target,
        user,
        cacheRows: [cache(1), cache(2, { question_text: 'The _____ opens early on weekdays.' })],
    }), false);
    assert.equal(hasCurrentQuestionCoverage({
        word: target,
        user,
        cacheRows: [cache(1), cache(2, {
            options: ['A. bank', 'B. river', 'C. school', 'D. library'],
            option_meanings: ['银行', '河流', '学校', '图书馆'],
        })],
    }), false);
});

test('coverage plan skips ready and executable targets but revives legacy terminal work', () => {
    const users = [{ id: 'user-1', learning_level: '小学' }];
    const words = [word({ id: 'ready' }), word({ id: 'pending' }), word({ id: 'legacy' }), word({ id: 'missing' })];
    const cacheRows = [
        cache(1, { word_id: 'ready', source_word_record_id: 'ready' }),
        cache(2, { word_id: 'ready', source_word_record_id: 'ready' }),
    ];
    const jobs = [
        { word_id: 'pending', user_id: 'user-1', word_version: 3, status: 'retry_wait' },
        { word_id: 'legacy', user_id: 'user-1', word_version: 3, status: 'needs_manual_review' },
    ];

    const plan = planQuestionCoverage({ users, words, cacheRows, jobs });

    assert.deepEqual(plan.targets.map(target => target.wordId), ['legacy', 'missing']);
    assert.deepEqual(plan.summary, {
        scanned: 4,
        targets: 4,
        ready: 1,
        executable: 1,
        planned: 2,
    });
});
