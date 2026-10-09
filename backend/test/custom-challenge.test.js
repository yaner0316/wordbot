const test = require('node:test');
const assert = require('node:assert/strict');
const { generateQuizWithDataSource, getChallengeCandidatesWithDataSource } = require('../quiz-adapter');
const { assertFormalQuizQuestions, isResumableQuizSession } = require('../formal-quiz-session');
const { calculateGameReward } = require('../game-reward');
const NOW = Date.parse('2026-10-05T04:00:00Z');
const HOUR = 3600000;
function fixture(count = 12, missing = []) {
  const words = Array.from({ length: count }, (_, i) => ({ id: `word-${i}`, feishu_record_id: `rec-${i}`, word: `target${i}`, meaning_zh: `释义${i}`, mastery_status: 'pending', entered_at: new Date(NOW - 20 * HOUR).toISOString() }));
  const cache = words.filter(w => !missing.includes(w.id)).flatMap((w, i) => [1, 2].map(slot => ({
    id: `cache-${w.id}-${slot}`, word_id: w.id, word_record_id: w.feishu_record_id, word: w.word,
    level: '中学', round_type: 'primary', quality_status: 'ready', ai_audit_status: 'approved', cache_state: 'active',
    variant_slot: slot, question_fingerprint: `fp-${i}-${slot}`, question_type: '1',
    question_text: `Variant ${slot} uses _____ naturally in context.`, context_zh: '这是练习中的完整中文句子。',
    options: [`A. ${w.word}`, `B. alpha${slot}`, `C. bravo${slot}`, `D. charlie${slot}`], answer: 'A',
    option_meanings: ['释义', '阿尔法', '布拉沃', '查理'], correct_meaning: w.meaning_zh, used_count: 0,
  })));
  const displays = [];
  const queued = [];
  const dataSource = {
    getUserByUsername: async () => ({ username: 'child' }), getWordsForUser: async () => words,
    getAssessmentsForUser: async () => [], getFormalDisplayEventsForUser: async () => displays,
    getQuestionCache: async () => cache, ensureQuizQuestionSupply: async (user, ids) => queued.push(...ids),
  };
  return { words, displays, queued, dataSource };
}
function generate(f, meaningIds = [], mode = 'custom') {
  return generateQuizWithDataSource({ username: 'child', level: '中学', mode: 'real', now: NOW,
    dataSource: f.dataSource, selection: { mode, meaningIds }, createId: () => 'custom-test' });
}
test('random challenge prioritizes yesterday displayed words after cooldown', async () => {
  const f = fixture(25);
  for (const w of f.words.slice(15)) f.displays.push({meaning_id:w.id,displayed_at:new Date(NOW-20*HOUR).toISOString(),counts_for_cooldown:true});
  const quiz = await generate(f, [], 'random');
  assert.deepEqual(new Set(quiz.questions.map(q=>q.meaningId)), new Set(f.words.slice(15).map(w=>w.id)));
});
test('random and custom fill use ready questions before waiting on unrelated missing cache', async () => {
  for (const mode of ['random','custom']) {
    const f=fixture(20,Array.from({length:10},(_,i)=>`word-${i}`));
    const quiz=await generate(f,mode==='custom'?['word-19']:[],mode);
    assert.equal(quiz.questions.length,10);
    assert.equal(quiz.pending,undefined);
  }
});
for (const count of [0, 5, 10]) test(`preserves ${count} chosen meanings, fills to ten without duplicates`, async () => {
  const f = fixture();
  const selected = Array.from({length: count}, (_, i) => `word-${i + 2}`);
  const quiz = await generate(f, selected);
  assert.equal(quiz.error, undefined);
  assert.equal(quiz.questions.length, 10);
  const ids = quiz.questions.map(q => q.meaningId);
  assert.equal(new Set(ids).size, 10);
  for (const id of selected) assert.ok(ids.includes(id));
});
test('candidate eligibility is independent of cache, includes recognized, and uses last display cooldown', async () => {
  const f = fixture(5, ['word-0']);
  f.words[1].mastery_status = 'recognized';
  f.words[2].mastery_status = 'mastered';
  f.displays.push({ meaning_id: 'word-3', displayed_at: new Date(NOW - 18 * HOUR + 1).toISOString(), counts_for_cooldown: true });
  f.displays.push({ meaning_id: 'word-4', displayed_at: new Date(NOW - 18 * HOUR).toISOString(), counts_for_cooldown: true });
  const result = await getChallengeCandidatesWithDataSource({ username: 'child', dataSource: f.dataSource, now: NOW });
  assert.equal(result.availableCount, 3);
  assert.equal(result.candidates.find(w => w.meaningId === 'word-0').eligible, true);
  assert.equal(result.candidates.find(w => w.meaningId === 'word-1').status, 'recognized');
  assert.ok(!result.candidates.some(w => w.meaningId === 'word-2'));
  assert.equal(result.candidates.find(w => w.meaningId === 'word-3').eligible, false);
});
test('only a genuinely small eligible pool produces a short formal challenge', async () => {
  const quiz = await generate(fixture(3), ['word-1']);
  assert.equal(quiz.questions.length, 3);
  assert.equal(quiz.requiredCount, 3);
  assert.doesNotThrow(() => assertFormalQuizQuestions(quiz.questions));
  assert.equal(isResumableQuizSession({ test_id: 'real-short', questions: quiz.questions }), true);
  assert.equal(calculateGameReward({ testId: 'real-short', mode: 'real', correct: 3, total: 3 }).minutes, 0);
  assert.throws(() => assertFormalQuizQuestions(quiz.questions.slice(0, 2)), /INCOMPLETE/);
});
test('missing selected cache keeps exact choices pending and queues supply, never substitutes or shortens', async () => {
  const f = fixture(12, ['word-0']);
  const quiz = await generate(f, ['word-0']);
  assert.equal(quiz.pending, true);
  assert.equal(quiz.error, undefined);
  assert.equal(quiz.requiredCount, 10);
  assert.deepEqual(quiz.questions, []);
  assert.ok(quiz.meaningIds.includes('word-0'));
  assert.ok(f.queued.includes('word-0'));
});
for (const ids of [['foreign-id'], ['word-1', 'word-1'], Array.from({length:11}, (_,i)=>`word-${i}`)]) {
  test(`rejects illegal selection ${JSON.stringify(ids)}`, async () => {
    await assert.rejects(generate(fixture(), ids), /CHALLENGE_SELECTION_INVALID/);
  });
}
test('rejects a chosen word still cooling without substituting another', async () => {
  const f = fixture();
  f.displays.push({ meaning_id: 'word-0', displayed_at: new Date(NOW - HOUR).toISOString() });
  await assert.rejects(generate(f, ['word-0']), /CHALLENGE_SELECTION_CHANGED/);
});

test('using the last fresh cached stem identifies only exhausted meanings for advance replenishment', async () => {
  const f = fixture(3);
  f.displays.push({meaning_id:'word-0',stem:'Variant 1 uses _____ naturally in context.',
    displayed_at:new Date(NOW - 19 * HOUR).toISOString(),history_expires_at:new Date(NOW + HOUR).toISOString()});
  const quiz = await generate(f,['word-0']);
  assert.deepEqual(quiz.nextSupplyMeaningIds,['word-0']);
});

test('first challenge requires eighteen hours from entry even with approved cached questions', async () => {
  const f = fixture(3);
  f.words[0].entered_at = new Date(NOW - 18 * HOUR + 1).toISOString();
  const status = await getChallengeCandidatesWithDataSource({ username:'child', dataSource:f.dataSource, now:NOW });
  assert.equal(status.candidates[0].eligible, false);
  assert.equal(status.candidates[0].cooldownEndsAt, new Date(NOW + 1).toISOString());
  assert.equal((await generate(f)).code, 'CHALLENGE_COOLDOWN');
  f.words[0].entered_at = new Date(NOW - 18 * HOUR).toISOString();
  assert.equal((await generate(f)).questions.length, 3);
});

test('cooling words do not shrink a library of twelve to a short quiz', async () => {
  const f = fixture(12);
  for (const w of f.words.slice(5)) w.entered_at = new Date(NOW - HOUR).toISOString();
  const quiz = await generate(f, ['word-0']);
  assert.equal(quiz.code, 'CHALLENGE_COOLDOWN');
  assert.equal(quiz.requiredCount, 10);
  assert.equal(quiz.availableCount, 5);
  assert.deepEqual(quiz.questions, []);
});
