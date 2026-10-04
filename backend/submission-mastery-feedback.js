const { assessmentTimestamp } = require('./mastery-evidence');
const { evaluateMeaning } = require('./mastery-service');

function emptyFeedback() {
    return { newlyMasteredMeanings: [], masteredWords: [] };
}

function buildSubmissionMasteryBaseline(words, questions) {
    const spellings = new Set(questions.map(q => String(q.word || '').trim().toLowerCase()));
    return words.filter(w => spellings.has(String(w.word || '').trim().toLowerCase())).map(w => ({
        meaningId: String(w.id || '').trim(),
        recordId: String(w.feishu_record_id || w.source_word_record_id || w.id || '').trim(),
        word: String(w.word || '').trim().toLowerCase(),
        meaningZh: String(w.meaning_zh || '').trim(),
        mastered: String(w.mastery_status || '').trim().toLowerCase() === 'mastered',
        revision: String(w.updated_at || '').trim(),
    }));
}

function deriveSubmissionMasteryFeedback(testId, baseline, records) {
    if (!Array.isArray(baseline) || !baseline.length) return emptyFeedback();
    const current = records.filter(r => r.fields?.test_id === testId);
    if (!current.length) return emptyFeedback();
    const times = current.map(assessmentTimestamp);
    if (times.some(t => !t)) return emptyFeedback();
    const first = Math.min(...times);
    const last = Math.max(...times);
    const correct = value => String(value || '').trim().toLowerCase() === 'correct';
    const newlyMasteredMeanings = baseline.filter(meaning => {
        if (meaning.mastered || !meaning.meaningId || !meaning.recordId) return false;
        const belongs = r => String(r.fields?.meaning_id || '') === meaning.meaningId
            || String(r.fields?.record_id || '') === meaning.recordId;
        if (!current.some(r => belongs(r) && correct(r.fields?.is_correct))) return false;
        const before = records.filter(r => belongs(r) && r.fields?.test_id !== testId && assessmentTimestamp(r) < first);
        const after = records.filter(r => belongs(r) && assessmentTimestamp(r) <= last);
        return !evaluateMeaning(before, correct).mastered && evaluateMeaning(after, correct).mastered;
    }).map(({ meaningId, recordId, word, meaningZh }) => ({ meaningId, recordId, word, meaningZh }));
    const newlyIds = new Set(newlyMasteredMeanings.map(m => m.meaningId));
    const spellings = [...new Set(newlyMasteredMeanings.map(m => m.word))];
    return {
        newlyMasteredMeanings,
        masteredWords: spellings.filter(word => baseline.filter(m => m.word === word)
            .every(m => m.mastered || newlyIds.has(m.meaningId))),
    };
}

async function mutateSubmissionMastery(client, userId, testId, mutate) {
    for (let attempt = 0; attempt < 3; attempt++) {
        const existing = await client.from('quiz_challenges').select('id, session_state')
            .eq('user_id', userId).eq('test_id', testId).maybeSingle();
        if (existing.error) throw new Error('SUBMISSION_MASTERY_READ_FAILED');
        if (!existing.data) throw new Error('SUBMISSION_MASTERY_CHALLENGE_NOT_FOUND');
        const state = existing.data.session_state || {};
        const previous = state.submissionMastery;
        const next = mutate(previous);
        if (next === previous) return previous || null;
        const saved = await client.from('quiz_challenges')
            .update({ session_state: { ...state, submissionMastery: next } })
            .eq('id', existing.data.id).eq('user_id', userId)
            .eq('session_state', JSON.stringify(state)).select('session_state').maybeSingle();
        if (saved.error) throw new Error('SUBMISSION_MASTERY_SAVE_FAILED');
        if (saved.data) return saved.data.session_state.submissionMastery;
    }
    throw new Error('SUBMISSION_MASTERY_CONFLICT');
}

async function getQuizSubmissionMasteryWithClient(client, userId, testId) {
    const row = await client.from('quiz_challenges').select('session_state')
        .eq('user_id', userId).eq('test_id', testId).maybeSingle();
    if (row.error) throw new Error('SUBMISSION_MASTERY_READ_FAILED');
    return row.data?.session_state?.submissionMastery || null;
}

function ensureQuizSubmissionMasteryWithClient(client, userId, testId, baseline) {
    return mutateSubmissionMastery(client, userId, testId,
        previous => previous || (Array.isArray(baseline) ? { version: 1, baseline } : previous));
}

async function saveQuizSubmissionMasteryResultWithClient(client, userId, testId, result) {
    const snapshot = await mutateSubmissionMastery(client, userId, testId, previous => {
        if (!previous || previous.result) return previous;
        return { ...previous, result };
    });
    return snapshot?.result || emptyFeedback();
}

module.exports = {
    emptyFeedback, buildSubmissionMasteryBaseline, deriveSubmissionMasteryFeedback,
    getQuizSubmissionMasteryWithClient, ensureQuizSubmissionMasteryWithClient,
    saveQuizSubmissionMasteryResultWithClient,
};
