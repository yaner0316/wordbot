const test = require('node:test');
const assert = require('node:assert/strict');
const { submitQuizWithDataSource } = require('../quiz-adapter');
const { rebuildSubmittedResult } = require('../submission-coordinator');

const start = Date.UTC(2026, 9, 1);
function fixture({ siblingMastered = false } = {}) {
    const words = Array.from({ length: 10 }, (_, i) => ({
        id: `meaning-${i}`, feishu_record_id: `record-${i}`, word: i < 2 ? 'bank' : `word${i}`,
        meaning_zh: `义项${i}`, mastery_status: i === 0 ? 'mastered' : 'consolidating',
        updated_at: '2026-10-01T00:00:00.000Z',
    }));
    words.push({ id: 'bank-sibling', feishu_record_id: 'record-sibling', word: 'bank',
        meaning_zh: '其他义项', mastery_status: siblingMastered ? 'mastered' : 'pending' });
    const questions = words.slice(0, 10).map((w, i) => ({
        meaningId: w.id, record_id: w.feishu_record_id, word: w.word, type: 1,
        source: 'question_cache', cacheRecordId: `cache-${i}`, context: `A fresh sentence ${i} uses ____ today.`,
        options: ['A. bank', 'B. desk', 'C. road', 'D. school'], answer: 'A', correctAnswer: 'A',
    }));
    const rows = words.slice(0, 10).map((w, i) => ({
        id: `prior-${i}`, word_id: w.id, source_word_record_id: w.feishu_record_id,
        word_snapshot: w.word, test_id: 'real-prior', is_correct: 'correct', submitted_answer: 'A',
        assessed_at: new Date(start).toISOString(), question_text: `A previous sentence ${i}.`,
    }));
    let snapshot = null;
    const calls = [];
    const dataSource = {
        getWordsForUser: async () => structuredClone(words),
        getMasteryAssessmentsForWords: async () => structuredClone(rows),
        ensureQuizSubmissionMastery: async (_user, _id, baseline) => {
            snapshot ||= { version: 1, baseline }; calls.push('baseline'); return structuredClone(snapshot);
        },
        saveQuizSubmissionMasteryResult: async (_user, _id, result) => {
            snapshot.result ||= structuredClone(result); calls.push('result'); return structuredClone(snapshot.result);
        },
        submitAssessments: async inputs => {
            assert.equal(calls[0], 'baseline', 'baseline must persist before immutable answer writes');
            calls.push('answers');
            const added = inputs.map((x, i) => ({ id: `current-${i}`, word_id: words[i].id,
                source_word_record_id: x.sourceWordRecordId, word_snapshot: x.word, test_id: x.testId,
                is_correct: x.correctness, submitted_answer: x.yourAnswer, question_text: x.questionText,
                assessed_at: new Date(x.recordTime).toISOString() }));
            rows.push(...added); return added;
        },
        updateWordMastery: async (_user, _word, status, options) => {
            const word = words.find(w => w.feishu_record_id === options.sourceWordRecordId);
            word.mastery_status = status; calls.push('mastery'); return [word];
        },
    };
    return { words, rows, questions, dataSource, calls, getSnapshot: () => snapshot };
}

test('formal submission persists baseline and excludes parent mastered meanings from new feedback', async () => {
    const f = fixture();
    const result = await submitQuizWithDataSource({ username: 'synthetic', testId: 'real-feedback',
        questions: f.questions, answers: Array(10).fill(0), dataSource: f.dataSource,
        now: () => start + 24 * 3600 * 1000 });
    assert.equal(result.newlyMasteredMeanings.length, 9);
    assert.deepEqual(result.newlyMasteredMeanings[0], {
        meaningId: 'meaning-1', recordId: 'record-1', word: 'bank', meaningZh: '义项1',
    });
    assert.equal(result.masteredWords.includes('bank'), false, 'one unmastered sibling prevents spelling mastery');
    assert.deepEqual(result.masteredWords, Array.from({ length: 8 }, (_, i) => `word${i + 2}`));
    assert.equal(f.calls.at(-1), 'result');
    assert.equal(f.calls.filter(call => call === 'mastery').length, 10, 'initial submission applies each projection once');
    assert.equal(f.getSnapshot().baseline[0].revision, '2026-10-01T00:00:00.000Z');
    const records = f.rows.filter(r => r.test_id === 'real-feedback').map(r =>
        require('../quiz-adapter').toFeishuAssessmentRecord(r, { username: 'synthetic' }));
    const replay = rebuildSubmittedResult(records, v => v === 'correct', f.getSnapshot().result);
    assert.deepEqual(replay.newlyMasteredMeanings, result.newlyMasteredMeanings);
    assert.deepEqual(replay.masteredWords, result.masteredWords);
});

test('spelling feedback requires every related meaning to be mastered', async () => {
    const f = fixture({ siblingMastered: true });
    const result = await submitQuizWithDataSource({ username: 'synthetic', testId: 'real-all-senses',
        questions: f.questions, answers: Array(10).fill(0), dataSource: f.dataSource,
        now: () => start + 24 * 3600 * 1000 });
    assert.equal(result.masteredWords.includes('bank'), true);
});

test('submission without durable baseline cannot claim newly mastered feedback', async () => {
    const f = fixture();
    delete f.dataSource.ensureQuizSubmissionMastery;
    delete f.dataSource.saveQuizSubmissionMasteryResult;
    f.dataSource.submitAssessments = async () => [];
    const result = await submitQuizWithDataSource({ username: 'synthetic', testId: 'real-no-baseline',
        questions: f.questions, answers: Array(10).fill(0), dataSource: f.dataSource,
        now: () => start + 24 * 3600 * 1000 });
    assert.deepEqual(result.newlyMasteredMeanings, []);
    assert.deepEqual(result.masteredWords, []);
});

test('feedback uses the existing formal evidence rules for duplicate stems, timing, wrong resets and preparation rows', async () => {
    const scenarios = [
        ['duplicate-stems', f => { f.rows.forEach((r, i) => { r.question_text = f.questions[i].context; }); }, 24],
        ['too-soon', () => {}, 17],
        ['too-late', () => {}, 721],
        ['preparation', f => { f.rows.forEach(r => { r.assessment_kind = 'initial_context'; }); }, 24],
        ['wrong-reset', f => { f.rows.push(...f.rows.map((r, i) => ({ ...r, id: `wrong-${i}`,
            test_id: 'real-wrong-reset', is_correct: 'wrong', assessed_at: new Date(start + 12 * 3600 * 1000).toISOString() }))); }, 24],
    ];
    for (const [name, configure, hours] of scenarios) {
        const f = fixture();
        configure(f);
        const result = await submitQuizWithDataSource({ username: 'synthetic', testId: `real-feedback-${name}`,
            questions: f.questions, answers: Array(10).fill(0), dataSource: f.dataSource,
            now: () => start + hours * 3600 * 1000 });
        assert.deepEqual(result.newlyMasteredMeanings, [], name);
        assert.deepEqual(result.masteredWords, [], name);
    }
});
