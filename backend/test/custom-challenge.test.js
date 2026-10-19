const test = require('node:test');
const assert = require('node:assert/strict');
const { generateQuizWithDataSource, getChallengeCandidatesWithDataSource, submitQuizWithDataSource } = require('../quiz-adapter');
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
  return { words, cache, displays, queued, dataSource };
}
function generate(f, meaningIds = [], mode = 'custom') {
  return generateQuizWithDataSource({ username: 'child', level: '中学', mode: 'real', now: NOW,
    dataSource: f.dataSource, selection: { mode, meaningIds }, createId: () => 'custom-test' });
}
test('custom selection is practice even if the caller requests real mode; submission preserves feedback without formal effects', async () => {
  const f = fixture(10);
  const quiz = await generate(f, ['word-0']);
  assert.equal(quiz.mode, 'practice');
  assert.match(quiz.testId, /^practice-/);
  const writes=[];
  f.dataSource.submitAssessments=async inputs=>{writes.push(...inputs);return inputs;};
  f.dataSource.updateWordMastery=async()=>assert.fail('practice must not update mastery');
  f.dataSource.ensureQuizSubmissionMastery=async()=>assert.fail('practice must not create formal progress');
  const result=await submitQuizWithDataSource({username:'child',testId:quiz.testId,questions:quiz.questions,answers:Array(10).fill(0),dataSource:f.dataSource});
  assert.equal(result.correct,10);
  assert.equal(result.mode,'practice');
  assert.equal(result.gameReward.eligible,false);
  assert.equal(result.gameReward.minutes,0);
  assert.ok(writes.every(row=>row.assessmentKind==='practice'));
});
test('practice can choose cooling meanings, and its display does not prioritize them in random selection', async () => {
  const f=fixture(20);
  f.words[0].entered_at=new Date(NOW-HOUR).toISOString();
  f.displays.push({meaning_id:'word-0',displayed_at:new Date(NOW-HOUR).toISOString(),counts_for_cooldown:true});
  const quiz=await generate(f,['word-0']);
  assert.ok(quiz.questions.some(q=>q.meaningId==='word-0'));
  const candidates=await getChallengeCandidatesWithDataSource({username:'child',dataSource:f.dataSource,now:NOW,mode:'practice'});
  assert.equal(candidates.candidates[0].eligible,true);
});

test('practice starts a complete ten-question selection with only one approved active question per meaning', async () => {
  const f = fixture(10);
  f.cache.splice(0, f.cache.length, ...f.cache.filter(row => row.variant_slot === 1));
  const ids = f.words.map(word => word.id);
  const quiz = await generate(f, ids);
  assert.equal(quiz.pending, undefined);
  assert.equal(quiz.mode, 'practice');
  assert.equal(quiz.questions.length, 10);
  assert.deepEqual(new Set(quiz.questions.map(q => q.meaningId)), new Set(ids));
  assert.deepEqual(f.queued, []);
});

for (const mode of ['custom', 'random']) test(`${mode} selects approved teaching snapshots without dropping their audit evidence`, async () => {
  const f = fixture(10);
  f.cache.forEach(row => {
    row.source_version = 'supabase-contextual-variant-v3|unique-answer-v2|teaching-analysis-v1';
    row.teaching_analysis = {
      schemaVersion: 1, clue: 'naturally in context', clueReason: '句中说明了目标词的具体使用语境。',
      correctWord: row.word, correctReason: '目标词与句中明确的语境一致。',
      options: row.options.map((option, i) => ({ word: option.slice(3), fits: i === 0,
        meaning: row.option_meanings[i], reason: i === 0 ? '这个词符合句中明确的语境。' : '这个词不符合句中明确的语境。' })),
    };
  });
  const quiz = await generate(f, mode === 'custom' ? ['word-0'] : [], mode);
  assert.equal(quiz.pending, undefined);
  assert.equal(quiz.questions.length, 10);
  for (const q of quiz.questions) {
    const snapshot = f.cache.find(row => row.id === q.cacheRecordId).teaching_analysis;
    assert.deepEqual(q.teachingAnalysis, snapshot);
    assert.equal(q.teachingAnalysis.correctWord, q.word);
  }
  assert.deepEqual(f.queued, []);
});

test('practice autofill prefers single approved questions over unrelated missing supply', async () => {
  const f = fixture(20, Array.from({length:10}, (_, i) => `word-${i}`));
  f.cache.splice(0, f.cache.length, ...f.cache.filter(row => row.variant_slot === 1));
  const quiz = await generate(f, ['word-19']);
  assert.equal(quiz.pending, undefined);
  assert.equal(quiz.questions.length, 10);
  assert.deepEqual(new Set(quiz.questions.map(q => q.meaningId)), new Set(f.words.slice(10).map(w => w.id)));
  assert.deepEqual(f.queued, []);
});

test('random formal challenges still wait when only one approved question per meaning exists', async () => {
  const f = fixture(10);
  f.cache.splice(0, f.cache.length, ...f.cache.filter(row => row.variant_slot === 1));
  const quiz = await generate(f, [], 'random');
  assert.equal(quiz.pending, true);
  assert.equal(quiz.readyCount, 0);
  assert.equal(quiz.requiredCount, 10);
  assert.deepEqual(quiz.questions, []);
});

for (const patch of [
  {cache_state:'retired'}, {quality_status:'pending'}, {level:'小学'},
  {cache_state:'reserved_next_day', available_from:new Date(NOW + HOUR).toISOString()},
  {question_fingerprint:''}, {options:[]},
]) test(`practice rejects an unusable single question: ${JSON.stringify(patch)}`, async () => {
  const f = fixture(10);
  f.cache.splice(0, f.cache.length, ...f.cache.filter(row => row.variant_slot === 1));
  Object.assign(f.cache.find(row => row.word_id === 'word-0'), patch);
  const ids = f.words.map(word => word.id);
  const quiz = await generate(f, ids);
  assert.equal(quiz.pending, true);
  assert.equal(quiz.requiredCount, 10);
  assert.deepEqual(quiz.meaningIds, ids);
  assert.deepEqual(quiz.questions, []);
  assert.ok(f.queued.includes('word-0'));
});

for (const patch of [{ai_audit_status:'rejected'}, {source_version:'legacy-unattested'}]) {
  test(`practice retains the production audit gate: ${JSON.stringify(patch)}`, async t => {
    const previous = process.env.WORDBOT_REQUIRE_AI_AUDIT;
    process.env.WORDBOT_REQUIRE_AI_AUDIT = '1';
    t.after(() => {
      if (previous === undefined) delete process.env.WORDBOT_REQUIRE_AI_AUDIT;
      else process.env.WORDBOT_REQUIRE_AI_AUDIT = previous;
    });
    const f = fixture(10);
    f.cache.splice(0, f.cache.length, ...f.cache.filter(row => row.variant_slot === 1));
    f.cache.forEach(row => { row.source_version = 'supabase-contextual-variant-v3|unique-answer-v2'; });
    Object.assign(f.cache.find(row => row.word_id === 'word-0'), patch);
    const quiz = await generate(f, f.words.map(word => word.id));
    assert.equal(quiz.pending, true);
    assert.deepEqual(quiz.questions, []);
    assert.ok(f.queued.includes('word-0'));
  });
}
test('practice modes and corrected practice evidence never count as formal mastery or game rewards', () => {
  const {getAssessmentMode,isRealAssessment,normalizeAssessmentMode}=require('../assessment-mode');
  const {isFormalAssessment}=require('../mastery-evidence');
  assert.equal(normalizeAssessmentMode('practice'),'practice');
  assert.equal(getAssessmentMode('practice-example'),'practice');
  assert.equal(isRealAssessment('practice-example'),false);
  assert.equal(isFormalAssessment({fields:{test_id:'real-old',assessment_kind:'practice'}}),false);
  assert.equal(calculateGameReward({testId:'practice-example',mode:'real',correct:10,total:10}).eligible,false);
});
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
  const quiz = await generate(fixture(3), [], 'random');
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
test('random challenge excludes a word still cooling', async () => {
  const f = fixture();
  f.displays.push({ meaning_id: 'word-0', displayed_at: new Date(NOW - HOUR).toISOString() });
  const quiz=await generate(f, [], 'random');
  assert.ok(quiz.questions.every(q=>q.meaningId!=='word-0'));
});

test('using the last fresh cached stem identifies only exhausted meanings for advance replenishment', async () => {
  const f = fixture(3);
  f.displays.push({meaning_id:'word-0',stem:'Variant 1 uses _____ naturally in context.',
    displayed_at:new Date(NOW - 19 * HOUR).toISOString(),history_expires_at:new Date(NOW + HOUR).toISOString()});
  const quiz = await generate(f,[],'random');
  assert.deepEqual(quiz.nextSupplyMeaningIds,['word-0']);
});

test('first challenge requires eighteen hours from entry even with approved cached questions', async () => {
  const f = fixture(3);
  f.words[0].entered_at = new Date(NOW - 18 * HOUR + 1).toISOString();
  const status = await getChallengeCandidatesWithDataSource({ username:'child', dataSource:f.dataSource, now:NOW });
  assert.equal(status.candidates[0].eligible, false);
  assert.equal(status.candidates[0].cooldownEndsAt, new Date(NOW + 1).toISOString());
  assert.equal((await generate(f, [], 'random')).code, 'CHALLENGE_COOLDOWN');
  f.words[0].entered_at = new Date(NOW - 18 * HOUR).toISOString();
  assert.equal((await generate(f, [], 'random')).questions.length, 3);
});

test('cooling words do not shrink a library of twelve to a short quiz', async () => {
  const f = fixture(12);
  for (const w of f.words.slice(5)) w.entered_at = new Date(NOW - HOUR).toISOString();
  const quiz = await generate(f, [], 'random');
  assert.equal(quiz.code, 'CHALLENGE_COOLDOWN');
  assert.equal(quiz.requiredCount, 10);
  assert.equal(quiz.availableCount, 5);
  assert.deepEqual(quiz.questions, []);
});

test('pending challenge names only missing words with safe generation status and retains exact ten choices',async()=>{
 const f=fixture(12,['word-0']);f.dataSource.ensureQuizQuestionSupply=async(u,ids)=>({words:ids.map(id=>({meaningId:id,state:'retry_wait',retryAt:'2026-10-05T05:00:00Z',last_error_detail:'private-provider-details'}))});
 const ids=f.words.slice(0,10).map(w=>w.id);const result=await generate(f,ids);
 assert.equal(result.readyCount,9);assert.deepEqual(result.meaningIds,ids);
 assert.deepEqual(result.missingWords,[{meaningId:'word-0',word:'target0',state:'retry_wait',retryAt:'2026-10-05T05:00:00Z'}]);
 assert.ok(!JSON.stringify(result).includes('private-provider-details'));assert.ok(!JSON.stringify(result.missingWords).includes('释义'));
});
