'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    hasCurrentQuestionCoverage,
    hasUsableCurrentLevel,
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
test('coverage treats a displayed stem as consumed even while its cache row remains ready', () => {
    const user={id:'user-1',learning_level:'小学'};
    const snapshot={users:[user],words:[word()],cacheRows:[cache(1),cache(2)],
      displayEvents:[{user_id:'user-1',meaning_id:'word-1',stem:'  THE   _____ opens early on weekdays. ',history_expires_at:'2099-01-01'}]};
    assert.equal(planQuestionCoverage(snapshot).summary.ready,0);
    assert.equal(planQuestionCoverage(snapshot).targets.length,1);
    snapshot.displayEvents[0].user_id='other';
    assert.equal(planQuestionCoverage(snapshot).summary.ready,1);
});

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
        skippedMissingLevel: 0,
        blockedInvalidWord: 0,
    });
});

test('coverage plan withholds meanings whose user has no usable current learning level', () => {
    // The generator derives every formal question from the user's current learning
    // level and refuses to work without one, so planning these meanings only produces
    // un-actionable work. They stay counted in the plan as blocked instead.
    const users = [
        { id: 'user-1', learning_level: '小学' },
        { id: 'user-2', learning_level: null },
        { id: 'user-3', learning_level: '' },
        { id: 'user-4', learning_level: 'not-a-level' },
    ];
    const words = [
        word({ id: 'actionable' }),
        word({ id: 'blocked-null', user_id: 'user-2' }),
        word({ id: 'blocked-empty', user_id: 'user-3' }),
        word({ id: 'blocked-invalid', user_id: 'user-4' }),
    ];

    const plan = planQuestionCoverage({ users, words, cacheRows: [], jobs: [] });

    assert.deepEqual(plan.targets.map(target => target.wordId), ['actionable']);
    assert.equal(plan.summary.skippedMissingLevel, 3);
    assert.equal(plan.summary.planned, 1);
});

test('a usable current level must be present and normalizable', () => {
    assert.equal(hasUsableCurrentLevel({ learning_level: '小学' }), true);
    assert.equal(hasUsableCurrentLevel({ learning_level: 'elementary' }), true);
    assert.equal(hasUsableCurrentLevel({ learning_level: null }), false);
    assert.equal(hasUsableCurrentLevel({ learning_level: undefined }), false);
    assert.equal(hasUsableCurrentLevel({ learning_level: '   ' }), false);
    assert.equal(hasUsableCurrentLevel({ learning_level: 'not-a-level' }), false);
});

test('invalid historical spellings stay visible as blocked coverage without being planned or executable', () => {
    const users = [{ id: 'user-1', learning_level: '小学' }];
    const invalid = ['bad_word', 'genaine', 'bank\n', '\tbank\t', '词义'];
    const words = invalid.map((spelling, i) => word({ id: `invalid-${i}`, word: spelling }));
    words.push(word({ id: 'valid-retry', word: "mother-in-law" }), word({ id: 'valid-new', word: "can't" }));
    const jobs = words.slice(0, -1).map(w => ({ user_id: w.user_id, word_id: w.id, word_version: 3, status: 'pending' }));
    const plan = planQuestionCoverage({ users, words, jobs });
    assert.equal(plan.summary.targets, 7, 'blocked data must not disappear from coverage');
    assert.equal(plan.summary.blockedInvalidWord, 5);
    assert.equal(plan.summary.executable, 1);
    assert.equal(plan.summary.ready, 0);
    assert.deepEqual(plan.targets.map(t => t.wordId), ['valid-new']);
    assert.equal(words.length, 7);
    assert.equal(jobs.length, 6, 'classifying does not delete historical jobs');
});
