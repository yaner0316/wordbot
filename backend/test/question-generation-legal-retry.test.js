'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getQuestionQualityIssues } = require('../question-quality');
const { createQuestionGenerationService, fingerprintQuestion } = require('../question-generation-service');
const { buildCacheQuestionRowsForWord } = require('../supabase-data');

const quality = row => getQuestionQualityIssues({
    type: 1, word: 'be', level: '中学', context: row.question_text,
    options: row.options, answer: row.answer, correctMeaning: '是',
});
const beRow = context => ({
    question_text: context, options: ['A. be', 'B. exist', 'C. become', 'D. seem'], answer: 'A',
});

test('be word-meaning meta sentence fails the existing context gate while real usage passes', () => {
    assert.ok(quality(beRow("The meaning of '是' (_____) is fundamental to this language.")).includes('generic_fill_in_context'));
    assert.ok(!quality(beRow('Please _____ quiet while the teacher reads the story.')).includes('generic_fill_in_context'));
});

test('resume revalidates a saved row, discards its bad context and preserves an approved sibling on interruption', async () => {
    const word = { id: 'synthetic-be', word: 'be', meaning_zh: '是', level: '中学', word_version: 1 };
    const bad = beRow("The meaning of '是' (_____) is fundamental to this language.");
    const good = beRow('Please _____ quiet while the teacher reads the story.');
    for (const row of [bad, good]) row.question_fingerprint = fingerprintQuestion(row, word.id);
    const saved = [];
    const service = createQuestionGenerationService({
        loadWord: async () => word,
        loadCheckpoint: async () => ({ word: 'be', level: '中学', wordVersion: 1, meaning: '["","是"]', variants: [
            { slot: 1, context: "The meaning of '是' (be) is fundamental to this language.", contextTranslation: '这个词义对于语言很重要', row: bad },
            { slot: 2, context: 'Please be quiet while the teacher reads the story.', row: good },
        ] }),
        saveCheckpoint: async ({ checkpoint }) => saved.push(structuredClone(checkpoint)),
        validateCandidate: quality,
        generateCandidates: async request => {
            assert.equal(request.requiredCount, 1);
            assert.deepEqual(request.approvedVariants, [good]);
            const invalid = request.generationCheckpoint.variants.find(v => v.slot === 1);
            assert.equal(invalid.context, undefined);
            assert.equal(invalid.row, undefined);
            throw new Error('synthetic interruption');
        },
        publishReadyVariants: async () => assert.fail('must not publish'),
    });
    await assert.rejects(service.process({ user_id: 'synthetic-user', word_id: word.id }), /synthetic interruption/);
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0].variants.find(v => v.slot === 2).row, good);
});

test('regenerating an invalid context slot does not overwrite its saved sibling before an interrupted translation', async () => {
    const sibling = { question_fingerprint: 'synthetic-approved', options: ['A. be', 'B. exist', 'C. become', 'D. seem'], answer: 'A' };
    const checkpoint = { variants: [{ slot: 1 }, { slot: 2, row: sibling }] };
    let saved;
    await assert.rejects(buildCacheQuestionRowsForWord({
        user: { id: 'synthetic-user' }, word: { id: 'synthetic-be', word: 'be', meaning_zh: '是' }, level: '中学',
        requiredCount: 1, approvedVariants: [sibling], generationCheckpoint: checkpoint,
        saveGenerationCheckpoint: async next => { saved = structuredClone(next); },
        generateContext: async () => 'Please be quiet while the teacher reads the story.',
        generateDistractors: async () => ['stay', 'remain', 'appear'],
        translateWords: async () => { throw new Error('synthetic translation interruption'); },
    }), /synthetic translation interruption/);
    assert.deepEqual(saved.variants.find(v => v.slot === 2).row, sibling);
    assert.equal(saved.variants.find(v => v.slot === 1).context, 'Please be quiet while the teacher reads the story.');
});

for (const repairedDuringResume of [false, true]) test(`dot resume rebuilds stale option layout (${repairedDuringResume ? 'distractors repaired now' : 'historical mismatch'}) without retranslating context`, async () => {
    const context = 'The teacher asked us to mark a dot on the map.';
    const contextTranslation = '老师让我们在地图上标一个圆点';
    const checkpoint = { variants: [{
        slot: 1, context, contextTranslation,
        distractors: repairedDuringResume ? ['spot', 'speck', 'point'] : ['speck', 'dash', 'mark'],
        optionWords: ['dot', 'spot', 'speck', 'point'],
        options: ['A. dot', 'B. spot', 'C. speck', 'D. point'], answer: 'A',
    }] };
    const translated = [];
    let auditCalls = 0;
    const rows = await buildCacheQuestionRowsForWord({
        user: { id: 'synthetic-user' },
        word: { id: 'synthetic-dot', word: 'dot', meaning_zh: '圆点' }, level: '中学', requiredCount: 1,
        generationCheckpoint: checkpoint, saveGenerationCheckpoint: async () => {},
        generateContext: async () => assert.fail('resume must retain context'),
        generateDistractors: async () => ['speck', 'dash', 'mark'],
        translateWords: async words => {
            translated.push([...words]);
            if (words.includes('spot') && !repairedDuringResume) throw Object.assign(new Error('stale translation'), { code: 'TRANSLATION_RESPONSE_INVALID' });
            return Object.fromEntries(words.map(word => [word, { spot: '圆点', point: '地点', speck: '斑粒', dash: '破折号', mark: '记号' }[word]]));
        },
        translateContext: async () => assert.fail('resume must retain context translation'),
        requireSemanticAudit: true,
        semanticAudit: async question => {
            auditCalls += 1;
            assert.deepEqual(question.options.map(v => v.slice(3)).sort(), ['dash', 'dot', 'mark', 'speck']);
            return { approved: true, status: 'approved', validLetters: [question.answer] };
        },
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].context_zh, contextTranslation);
    assert.equal(auditCalls, 1);
    assert.deepEqual(translated, repairedDuringResume ? [['spot', 'speck', 'point'], ['speck', 'dash', 'mark']] : [['speck', 'dash', 'mark']]);
});
