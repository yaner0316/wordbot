const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCacheQuestionRowsForWord } = require('../supabase-data');

const LEVEL = String.fromCharCode(0x4e2d, 0x5b66);
const user = { id: 'user-1', username: 'qiuqiu' };
const word = {
    id: 'word-1',
    feishu_record_id: 'rec-word-1',
    word: 'apple',
    meaning_en: 'a fruit',
    meaning_zh: '苹果',
    context_en: 'The child ate an apple after school.',
    distractors: ['pear', 'desk', 'chair'],
};
const translateWords = async values => Object.fromEntries(values.map(value => [value, value === 'apple' ? '苹果' : '干扰项']));

test('a semantic non-unique context is remembered and never restored from the entry context',async()=>{
 const filled='The child picked an apple from the tree used to grow apples.',options=['A. apple','B. pear','C. chair','D. book'];let checkpoint;
 await buildCacheQuestionRowsForWord({user,word:{...word,context_en:filled},level:LEVEL,requiredCount:1,allowPartialCandidates:true,requireSemanticAudit:true,
 generationCheckpoint:{variants:[{slot:1,context:filled,distractors:['pear','chair','book'],optionWords:['apple','pear','chair','book'],options,answer:'A',optionMeanings:['苹果','梨','椅子','书'],contextTranslation:'这个孩子从结苹果的树上摘了一个苹果。',localValidated:true}]},saveGenerationCheckpoint:async value=>{checkpoint=structuredClone(value);},
 generateContext:async()=>'',generateDistractors:async()=>assert.fail('existing distractors are reusable until semantic review'),translateWords:async()=>assert.fail('existing meanings are reusable'),translateContext:async()=>assert.fail('existing translation is reusable'),semanticAudit:async()=>({approved:false,status:'rejected',validLetters:['A','B'],code:'semantic_non_unique'})});
 assert.ok(checkpoint.variants[0].rejectedContexts.includes(filled.replace('apple','_____')));assert.equal(checkpoint.variants[0].context,undefined);
 let generated=0;
 await buildCacheQuestionRowsForWord({user,word:{...word,context_en:filled},level:LEVEL,requiredCount:1,allowPartialCandidates:true,generationCheckpoint:checkpoint,
 generateContext:async()=>{generated++;return '';},generateDistractors:async()=>assert.fail('rejected context must be replaced before distractors')});
 assert.ok(generated>0);
});

test('a complete old-method audit resumes only semantic review instead of bypassing the new method',async()=>{
 const {SEMANTIC_AUDIT_METHOD,semanticAuditInputFingerprint}=require('../teaching-analysis');
 const options=['A. apple','B. pear','C. chair','D. book'];let audits=0;
 const analysis={schemaVersion:1,clue:'grow apples',clueReason:'树上结苹果是句中明确的来源。',correctWord:'apple',correctReason:'这种树结的是苹果，因此要填苹果。',options:options.map((o,i)=>({word:o.slice(3),fits:i===0,meaning:['苹果','梨','椅子','书'][i],reason:'树上结苹果明确了这个句子中所说的果实。'}))};
 const audit=Object.assign(async q=>{audits++;const inputFingerprint=semanticAuditInputFingerprint(q);return {approved:true,status:'approved',validLetters:['A'],auditMethod:SEMANTIC_AUDIT_METHOD,inputFingerprint,teachingAnalysis:{...analysis,auditMethod:SEMANTIC_AUDIT_METHOD,inputFingerprint}};},{auditMethod:SEMANTIC_AUDIT_METHOD});
 const rows=await buildCacheQuestionRowsForWord({user,word,level:LEVEL,requiredCount:1,allowPartialCandidates:true,requireSemanticAudit:true,semanticAudit:audit,
 generationCheckpoint:{variants:[{slot:1,context:'The child picked an apple from the tree used to grow apples.',distractors:['pear','chair','book'],optionWords:['apple','pear','chair','book'],options,answer:'A',optionMeanings:['苹果','梨','椅子','书'],contextTranslation:'这个孩子从结苹果的树上摘了一个苹果。',localValidated:true,audit:{approved:true,status:'approved',validLetters:['A'],teachingAnalysis:analysis}}]},
 generateContext:async()=>assert.fail('valid context must be reused'),generateDistractors:async()=>assert.fail('valid distractors must be reused'),translateWords:async()=>assert.fail('valid meanings must be reused'),translateContext:async()=>assert.fail('valid translation must be reused')});
 assert.equal(audits,1);assert.equal(rows.length,1);assert.match(rows[0].source_version,/blind-completion-v1/);
});
test('legacy partial audit missing teaching resumes only the audit and persists the new analysis',async()=>{
 const saved=[],options=['A. apple','B. pear','C. chair','D. book'];
 let audits=0,contexts=0,translations=0,distractors=0;
 const filled='The child picked an apple from the tree used to grow apples.';
 const rows=await buildCacheQuestionRowsForWord({user,word:{...word,context_en:filled},level:LEVEL,requiredCount:1,allowPartialCandidates:true,requireSemanticAudit:true,requireTeachingAnalysis:true,
  generationCheckpoint:{variants:[{slot:1,context:filled,distractors:['pear','chair','book'],optionWords:['apple','pear','chair','book'],options,answer:'A',optionMeanings:['苹果','梨','椅子','书'],contextTranslation:'这个孩子从结苹果的树上摘了一个苹果。',localValidated:true,audit:{approved:true,status:'approved',validLetters:['A']}}]},
  saveGenerationCheckpoint:async value=>saved.push(structuredClone(value)),
  generateContext:async()=>{contexts++;return filled;},generateDistractors:async()=>{distractors++;return ['pear','chair','book'];},
  translateWords:async()=>{translations++;return {};},translateContext:async()=>{translations++;return '';},
  semanticAudit:async q=>{audits++;return {approved:true,status:'approved',validLetters:[q.answer],teachingAnalysis:{schemaVersion:1,clue:'grow apples',clueReason:'树上结苹果是句中明确的来源。',correctWord:'apple',correctReason:'这种树结的是苹果，因此要填苹果。',options:q.options.map((opt,i)=>({word:opt.slice(3),fits:i===0,meaning:['苹果','梨','椅子','书'][i],reason:i===0?'苹果对应句中明确的果实来源。':'这个选项不符合句中明确的果实来源。'}))}};}
 });
 assert.equal(rows.length,1);assert.equal(audits,1);assert.equal(contexts,0);assert.equal(translations,0);assert.equal(distractors,0);
 assert.equal(rows[0].teaching_analysis.schemaVersion,1);assert.match(rows[0].source_version,/teaching-analysis-v1/);assert.equal(saved.at(-1).variants[0].row.teaching_analysis.schemaVersion,1);
});

const translateContext = async context => context.includes('packed')
    ? '\u8fd9\u4e2a\u5b69\u5b50\u4e3a\u957f\u9014\u65c5\u884c\u88c5\u4e86\u4e00\u4e2a\u82f9\u679c\u3002'
    : '\u8fd9\u4e2a\u5b69\u5b50\u653e\u5b66\u540e\u5403\u4e86\u4e00\u4e2a\u82f9\u679c\u3002';

const uniqueTranslateWords = async values => Object.fromEntries(values.map(value => [
    value,
    value === 'apple' ? '\u82f9\u679c' : `\u5e72\u6270-${value}`,
]));

test('cache builder publishes zero rows when it cannot build a second stem', async () => {
    const withoutGenerator = await buildCacheQuestionRowsForWord({
        user, word, level: LEVEL, roundType: 'primary', translateWords: uniqueTranslateWords,
        translateContext,
    });
    assert.deepEqual(withoutGenerator, []);

    const duplicateOnly = await buildCacheQuestionRowsForWord({
        user, word, level: LEVEL, roundType: 'primary', translateWords: uniqueTranslateWords,
        translateContext,
        generateContext: async () => word.context_en,
    });
    assert.deepEqual(duplicateOnly, []);
});

test('cache builder publishes exactly two rows only after both stems pass', async () => {
    let distractorCall = 0;
    const rows = await buildCacheQuestionRowsForWord({
        user, word, level: LEVEL, roundType: 'primary', translateWords: uniqueTranslateWords,
        translateContext,
        generateContext: async () => 'The child packed an apple for the long trip.',
        generateDistractors: async () => distractorCall++ === 0
            ? ['pear', 'banana', 'orange']
            : ['snack', 'sandwich', 'biscuit'],
    });
    assert.equal(rows.length, 2);
    assert.equal(new Set(rows.map(row => row.question_text)).size, 2);
    assert.equal(new Set(rows.map(row => row.question_fingerprint)).size, 2);
});

test('cache builder generates and uses distractors for each real stem independently', async () => {
    const calls = [];
    const generatedSets = [
        ['pear', 'banana', 'orange'],
        ['snack', 'sandwich', 'biscuit'],
    ];
    const rows = await buildCacheQuestionRowsForWord({
        user, word, level: LEVEL, roundType: 'primary', translateWords: uniqueTranslateWords,
        translateContext,
        generateContext: async () => 'The child packed an apple for the long trip.',
        generateDistractors: async input => {
            calls.push(input);
            return generatedSets[calls.length - 1];
        },
    });

    assert.equal(rows.length, 2);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].context, 'The child ate an _____ after school.');
    assert.equal(calls[1].context, 'The child packed an _____ for the long trip.');
    assert.deepEqual(calls[1].excludedDistractors, generatedSets[0]);

    const distractorsFor = row => row.options
        .map(option => option.slice(3))
        .filter(option => option !== word.word)
        .sort();
    assert.deepEqual(distractorsFor(rows[0]), [...generatedSets[0]].sort());
    assert.deepEqual(distractorsFor(rows[1]), [...generatedSets[1]].sort());
});

test('cache builder refuses to publish two stems with the same distractor set', async () => {
    let calls = 0;
    const rows = await buildCacheQuestionRowsForWord({
        user, word, level: LEVEL, roundType: 'primary', translateWords: uniqueTranslateWords,
        translateContext,
        generateContext: async () => 'The child packed an apple for the long trip.',
        generateDistractors: async () => {
            calls += 1;
            return ['pear', 'banana', 'orange'];
        },
    });

    assert.deepEqual(rows, []);
    assert.ok(calls > 2, 'the second stem should be retried before the pair is rejected');
});

test('cache builder rejects variants sharing two distractors', async () => {
    const generatedSets = [
        ['pear', 'banana', 'orange'],
        ['pear', 'banana', 'biscuit'],
        ['pear', 'banana', 'snack'],
        ['pear', 'banana', 'sandwich'],
    ];
    let call = 0;
    const rows = await buildCacheQuestionRowsForWord({
        user, word, level: LEVEL, roundType: 'primary', translateWords: uniqueTranslateWords,
        translateContext,
        generateContext: async () => 'The child packed an apple for the long trip.',
        generateDistractors: async () => generatedSets[call++],
    });

    assert.deepEqual(rows, []);
});

test('cache builder permits variants sharing only one contextually valid distractor', async () => {
    const generatedSets = [
        ['pear', 'banana', 'orange'],
        ['pear', 'snack', 'biscuit'],
    ];
    let call = 0;
    const rows = await buildCacheQuestionRowsForWord({
        user, word, level: LEVEL, roundType: 'primary', translateWords: uniqueTranslateWords,
        translateContext,
        generateContext: async () => 'The child packed an apple for the long trip.',
        generateDistractors: async () => generatedSets[call++],
    });

    assert.equal(rows.length, 2);
    assert.equal(call, 2);
    const distractorSets = rows.map(row => row.options
        .map(option => option.replace(/^[A-D]\.\s+/, ''))
        .filter(option => option !== word.word));
    assert.equal(distractorSets[0].filter(option => distractorSets[1].includes(option)).length, 1);
});

test('cache builder rejects stems that differ only by whitespace', async () => {
    let call = 0;
    const rows = await buildCacheQuestionRowsForWord({
        user, word, level: LEVEL, roundType: 'primary', translateWords: uniqueTranslateWords,
        translateContext,
        generateContext: async () => 'The  child ate an apple after school.',
        generateDistractors: async () => call++ === 0
            ? ['pear', 'banana', 'orange']
            : ['snack', 'sandwich', 'biscuit'],
    });

    assert.deepEqual(rows, []);
});

test('cache builder resumes at semantic audit without regenerating approved upstream stages', async () => {
    const saved = [];
    const rows = await buildCacheQuestionRowsForWord({
        user, word, level: LEVEL, roundType: 'primary', requiredCount: 1,
        allowPartialCandidates: true,
        generationCheckpoint: {
            variants: [{
                slot: 1,
                context: word.context_en,
                distractors: ['pear', 'banana', 'orange'],
                optionWords: ['apple', 'pear', 'banana', 'orange'],
                options: ['A. apple', 'B. pear', 'C. banana', 'D. orange'],
                answer: 'A',
                optionMeanings: ['苹果', '梨', '香蕉', '橙子'],
                contextTranslation: '这个孩子放学后吃了一个苹果。',
                localValidated: true,
            }],
        },
        saveGenerationCheckpoint: async checkpoint => saved.push(JSON.parse(JSON.stringify(checkpoint))),
        generateContext: async () => { throw new Error('context must be reused'); },
        generateDistractors: async () => { throw new Error('distractors must be reused'); },
        translateWords: async () => { throw new Error('option meanings must be reused'); },
        translateContext: async () => { throw new Error('context translation must be reused'); },
        semanticAudit: async () => ({ approved: true, status: 'approved', validLetters: ['A'] }),
        requireSemanticAudit: true,
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].ai_audit_status, 'approved');
    assert.ok(saved.at(-1).variants[0].row);
});

test('cache builder keeps context translation when repairing distractors', async () => {
    let translationCalls = 0;
    const rows = await buildCacheQuestionRowsForWord({
        user, word, level: LEVEL, roundType: 'primary', requiredCount: 1,
        allowPartialCandidates: true,
        generationCheckpoint: {
            variants: [{
                slot: 1,
                context: word.context_en,
                contextTranslation: '这个孩子放学后吃了一个苹果。',
            }],
        },
        saveGenerationCheckpoint: async () => {},
        generateContext: async () => { throw new Error('context must be reused'); },
        generateDistractors: async () => ['pear', 'banana', 'orange'],
        translateWords: uniqueTranslateWords,
        translateContext: async () => { translationCalls += 1; return 'must not run'; },
    });

    assert.equal(rows.length, 1);
    assert.equal(translationCalls, 0);
    assert.equal(rows[0].context_zh, '这个孩子放学后吃了一个苹果。');
});

test('semantic rejection invalidates distractors and downstream stages before retry', async () => {
    let checkpoint = { variants: [] };
    const common = {
        user, word, level: LEVEL, roundType: 'primary', requiredCount: 1,
        allowPartialCandidates: true,
        translateWords: uniqueTranslateWords,
        translateContext,
        generateContext: async () => { throw new Error('saved context must be reused'); },
        saveGenerationCheckpoint: async next => { checkpoint = JSON.parse(JSON.stringify(next)); },
        requireSemanticAudit: true,
    };
    const rejected = await buildCacheQuestionRowsForWord({
        ...common,
        generationCheckpoint: checkpoint,
        generateDistractors: async () => ['pear', 'banana', 'orange'],
        semanticAudit: async () => ({ approved: false, status: 'rejected', validLetters: ['A', 'B'] }),
    });

    assert.deepEqual(rejected, []);
    assert.equal(checkpoint.variants[0].context, word.context_en);
    assert.equal('distractors' in checkpoint.variants[0], false);
    assert.equal('audit' in checkpoint.variants[0], false);

    let repairedDistractors = 0;
    const repaired = await buildCacheQuestionRowsForWord({
        ...common,
        generationCheckpoint: checkpoint,
        generateDistractors: async () => { repairedDistractors += 1; return ['snack', 'sandwich', 'biscuit']; },
        semanticAudit: async ({ answer }) => ({ approved: true, status: 'approved', validLetters: [answer] }),
    });

    assert.equal(repaired.length, 1);
    assert.equal(repairedDistractors, 1);
});

test('local option-quality rejection keeps the context but discards the bad distractors', async () => {
    const reasons = [];
    let checkpoint = { variants: [{
        slot: 1,
        context: word.context_en,
        contextTranslation: '这个孩子放学后吃了一个苹果。',
        distractors: ['agree to', 'banana', 'orange'],
    }] };
    const rows = await buildCacheQuestionRowsForWord({
        user, word, level: LEVEL, roundType: 'primary', requiredCount: 1,
        allowPartialCandidates: true,
        generationCheckpoint: checkpoint,
        saveGenerationCheckpoint: async next => { checkpoint = JSON.parse(JSON.stringify(next)); },
        generateContext: async () => '',
        generateDistractors: async () => { throw new Error('stored distractors are evaluated first'); },
        translateWords: uniqueTranslateWords,
        translateContext,
        reportRejection: reason => reasons.push(reason),
    });

    assert.deepEqual(rows, []);
    assert.equal(checkpoint.variants[0].context, word.context_en);
    assert.equal('distractors' in checkpoint.variants[0], false, reasons.join(','));
    assert.equal('options' in checkpoint.variants[0], false);
});
