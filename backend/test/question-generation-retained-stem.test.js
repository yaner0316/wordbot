'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCacheQuestionRowsForWord } = require('../supabase-data');
const { createQuestionGenerationService, fingerprintQuestion } = require('../question-generation-service');

const originalContext = 'She felt lucky before the game.';
const freshContext = 'I was lucky to receive help before the deadline.';
const nextContext = 'They were lucky to find the lost book.';

async function fixture() {
    const word = { id: 'synthetic-lucky', user_id: 'synthetic-user', word: 'lucky', level: '中学',
        meaning_zh: '幸运的', context_en: originalContext };
    const calls = { contexts: 0, audits: [], translations: [] };
    const options = {
        user: { id: word.user_id }, word, level: word.level, requiredCount: 1,
        generateContext: async () => { calls.contexts++; return freshContext; },
        generateDistractors: async ({ excludedDistractors = [] }) => excludedDistractors.includes('alpha')
            ? ['delta', 'echo', 'foxtrot'] : ['alpha', 'bravo', 'charlie'],
        translateWords: async words => Object.fromEntries(words.map(w => [w, {
            alpha: '甲项', bravo: '乙项', charlie: '丙项', delta: '丁项', echo: '戊项', foxtrot: '己项', lucky: '幸运的',
        }[w]])),
        translateContext: async context => { calls.translations.push(context); return '她在比赛前觉得自己很幸运。'; },
        semanticAudit: async q => { calls.audits.push(q); return { approved: true, status: 'approved', validLetters: [q.answer] }; },
        requireSemanticAudit: true,
    };
    const initial = await buildCacheQuestionRowsForWord(options);
    assert.equal(initial.length, 1);
    const sibling = { ...initial[0], question_fingerprint: fingerprintQuestion(initial[0], word.id) };
    word.cachedVariants = [sibling];
    calls.contexts = 0;
    calls.audits.length = 0;
    calls.translations.length = 0;
    let checkpoint = null;
    const published = [];
    const service = createQuestionGenerationService({
        loadWord: async () => word,
        loadCheckpoint: async () => checkpoint,
        saveCheckpoint: async value => { checkpoint = structuredClone(value.checkpoint); },
        validateCandidate: () => [],
        generateCandidates: request => buildCacheQuestionRowsForWord({ ...options, ...request, allowPartialCandidates: true }),
        publishReadyVariants: async ({ variants }) => published.push(variants),
    });
    const job = { word_id: word.id, user_id: word.user_id };
    return { word, options, sibling, calls, service, job, published, checkpoint: () => checkpoint };
}

test('replenishment skips the retained entry stem and publishes a distinct pair across two task runs', async () => {
    const f = await fixture();
    await f.service.process(f.job);
    await f.service.process(f.job);
    assert.equal(f.published.length, 2);
    assert.equal(new Set(f.published[1].map(row => row.question_text)).size, 2);
    assert.equal(f.published[1][0].question_fingerprint, f.sibling.question_fingerprint);
    assert.equal(f.calls.contexts, 1);
    assert.equal(f.calls.audits.length, 1, 'retained stem must never be audited again');
});

test('resume skips a normalized duplicate partial while preserving valid partial translation and sibling', async () => {
    const f = await fixture();
    const checkpoint = { variants: [
        { slot: 1, row: f.sibling },
        { slot: 2, context: '  SHE   FELT lucky BEFORE THE GAME. ', contextTranslation: '重复语境' },
        { slot: 3, context: freshContext, contextTranslation: '我很幸运在截止日期前得到了帮助。' },
    ] };
    const rows = await buildCacheQuestionRowsForWord({ ...f.options, approvedVariants: [f.sibling], generationCheckpoint: checkpoint });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].question_text, freshContext.replace('lucky', '_____'));
    assert.equal(rows[0].context_zh, '我很幸运在截止日期前得到了帮助。');
    assert.equal(f.calls.contexts, 0);
    assert.equal(f.calls.translations.length, 0);
    assert.equal(f.calls.audits.length, 1);
    assert.deepEqual(checkpoint.variants[0].row, f.sibling);
});

test('later candidate retries exclude the retained stem before translation or semantic audit', async () => {
    const f = await fixture();
    const contexts = [originalContext, nextContext];
    const translated = [];
    let audits = 0;
    const rows = await buildCacheQuestionRowsForWord({ ...f.options, approvedVariants: [f.sibling],
        word: { ...f.word, context_en: freshContext },
        generateContext: async () => contexts.shift() || '',
        translateContext: async context => { translated.push(context); return '他们很幸运找到了那本丢失的书。'; },
        semanticAudit: async q => { audits++; return audits === 1
            ? { approved: false, status: 'rejected', validLetters: [] }
            : { approved: true, status: 'approved', validLetters: [q.answer] }; },
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].question_text, nextContext.replace('lucky', '_____'));
    assert.equal(audits, 2);
    assert.equal(translated.length, 2, 'duplicate must be discarded before paid downstream stages');
});

test('interrupted replenishment resumes saved fresh context without regenerating or auditing the sibling', async () => {
    const f = await fixture();
    const translate = f.options.translateContext;
    f.options.translateContext = async () => { throw new Error('synthetic interruption'); };
    await assert.rejects(f.service.process(f.job), /synthetic interruption/);
    assert.equal(f.checkpoint().variants.find(v => !v.row).context, freshContext);
    assert.equal(f.checkpoint().variants.find(v => v.row).row.question_fingerprint, f.sibling.question_fingerprint);
    f.options.translateContext = translate;
    const result = await f.service.process(f.job);
    assert.equal(result.readyCount, 2);
    assert.equal(f.calls.contexts, 1);
    assert.equal(f.calls.audits.length, 1);
});
