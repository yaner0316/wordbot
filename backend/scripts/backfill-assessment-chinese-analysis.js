'use strict';

const { createClient } = require('@supabase/supabase-js');
const { isRealAssessment } = require('../assessment-mode');
const { isContextSentenceTranslationAcceptable } = require('../context-sentence-translation');
const { hasMeaningfulChineseMeaning } = require('../question-quality');

const PAGE_SIZE = 1000;

function normalizedText(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function cacheKey(row) {
    const options = Array.isArray(row?.options)
        ? row.options.map(value => normalizedText(value)).join('|')
        : '';
    return [
        row?.user_id,
        row?.word_id,
        normalizedText(row?.question_text),
        String(row?.answer || row?.correct_answer || '').trim().toUpperCase(),
        options,
    ].map(value => String(value || '')).join(':');
}

function validMeanings(values) {
    if (!Array.isArray(values) || values.length !== 4) return null;
    const normalized = values.map(value => String(value || '').trim());
    if (!normalized.every(hasMeaningfulChineseMeaning)) return null;
    if (new Set(normalized.map(value => value.toLowerCase())).size !== 4) return null;
    return normalized;
}

function validContext(questionText, contextZh, correctMeaning) {
    return isContextSentenceTranslationAcceptable({
        type: 1,
        context: String(questionText || '').trim(),
        contextCN: String(contextZh || '').trim(),
        correctMeaning: String(correctMeaning || '').trim(),
    });
}

function cacheAnalysis(cache, assessment, word) {
    if (!cache) return null;
    if (String(cache.user_id || '') !== String(assessment.user_id || '')
        || String(cache.word_id || '') !== String(assessment.word_id || '')
        || normalizedText(cache.question_text) !== normalizedText(assessment.question_text)) return null;
    const assessmentAnswer = String(assessment?.correct_answer || '').trim().toUpperCase();
    const cacheAnswer = String(cache?.answer || '').trim().toUpperCase();
    if (assessmentAnswer && cacheAnswer && assessmentAnswer !== cacheAnswer) return null;
    const assessmentOptions = Array.isArray(assessment?.options)
        ? assessment.options.map(value => normalizedText(value))
        : [];
    const cacheOptions = Array.isArray(cache?.options)
        ? cache.options.map(value => normalizedText(value))
        : [];
    if (assessmentOptions.length && cacheOptions.length
        && JSON.stringify(assessmentOptions) !== JSON.stringify(cacheOptions)) return null;
    const answer = assessmentAnswer || cacheAnswer;
    const answerIndex = 'ABCD'.indexOf(answer);
    const candidate = Array.isArray(cache.option_meanings)
        ? cache.option_meanings.map(value => String(value || '').trim())
        : [];
    if (candidate.length === 4 && answerIndex >= 0 && !hasMeaningfulChineseMeaning(candidate[answerIndex])
        && hasMeaningfulChineseMeaning(word?.meaning_zh)) {
        candidate[answerIndex] = String(word.meaning_zh).trim();
    }
    const meanings = validMeanings(candidate);
    const correctMeaning = answerIndex >= 0 ? meanings?.[answerIndex] : '';
    const contextZh = String(cache.context_zh || '').trim();
    if (!meanings || !validContext(assessment?.question_text || cache.question_text, contextZh, correctMeaning)) return null;
    return { meanings, contextZh };
}

function unwrapQuestionSnapshot(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const nested = value.question_snapshot;
    return nested && typeof nested === 'object' && !Array.isArray(nested) ? nested : value;
}

function challengeAnalysis(challengeQuestion, challenge, assessment) {
    if (!challengeQuestion || !challenge) return null;
    if (String(challenge.user_id || '') !== String(assessment.user_id || '')
        || String(challenge.test_id || '') !== String(assessment.test_id || '')
        || String(challengeQuestion.meaning_id || '') !== String(assessment.word_id || '')
        || normalizedText(challengeQuestion.stem) !== normalizedText(assessment.question_text)) return null;
    const snapshot = unwrapQuestionSnapshot(challengeQuestion.question_snapshot);
    if (Number(snapshot.type || snapshot.question_type) !== 1) return null;
    const snapshotMeaningId = String(snapshot.meaningId || snapshot.meaning_id || '').trim();
    const snapshotCacheId = String(snapshot.cacheRecordId || snapshot.cache_question_id || '').trim();
    if ((snapshotMeaningId && snapshotMeaningId !== String(challengeQuestion.meaning_id || ''))
        || (snapshotCacheId && snapshotCacheId !== String(challengeQuestion.cache_question_id || ''))
        || normalizedText(snapshot.context || snapshot.stem) !== normalizedText(assessment.question_text)) return null;
    const assessmentOptions = Array.isArray(assessment.options)
        ? assessment.options.map(value => normalizedText(value))
        : [];
    const snapshotOptions = Array.isArray(snapshot.options)
        ? snapshot.options.map(value => normalizedText(value))
        : [];
    if (assessmentOptions.length && snapshotOptions.length
        && JSON.stringify(assessmentOptions) !== JSON.stringify(snapshotOptions)) return null;
    const answer = String(snapshot.answer || snapshot.correctAnswer || '').trim().toUpperCase();
    if (!answer || answer !== String(assessment.correct_answer || '').trim().toUpperCase()) return null;
    const meanings = validMeanings(snapshot.optionMeanings || snapshot.option_meanings);
    const answerIndex = 'ABCD'.indexOf(answer);
    const contextZh = String(snapshot.contextCN || snapshot.context_zh || '').trim();
    if (!meanings || answerIndex < 0 || !validContext(assessment.question_text, contextZh, meanings[answerIndex])) return null;
    return { meanings, contextZh };
}

function isSubmittedFormalTypeOne(row) {
    return isRealAssessment(row?.test_id)
        && String(row?.question_type || '') === '1'
        && ['correct', 'wrong'].includes(String(row?.is_correct || '').trim().toLowerCase());
}

function buildAssessmentChineseAnalysisPlan({ assessments = [], caches = [], challengeQuestions = [], challenges = [], words = [] } = {}) {
    const cacheById = new Map(caches.map(row => [String(row.id || ''), row]));
    const challengeById = new Map(challenges.map(row => [String(row.id || ''), row]));
    const wordById = new Map(words.map(row => [String(row.id || ''), row]));
    const cacheGroups = new Map();
    for (const row of caches) {
        const key = cacheKey(row);
        if (!cacheGroups.has(key)) cacheGroups.set(key, []);
        cacheGroups.get(key).push(row);
    }

    const repairs = [];
    const unresolvedIds = [];
    let scanned = 0;
    let alreadyComplete = 0;
    for (const assessment of assessments) {
        if (!isSubmittedFormalTypeOne(assessment)) continue;
        scanned += 1;
        const currentMeanings = validMeanings(assessment.option_meanings);
        const currentAnswerIndex = 'ABCD'.indexOf(String(assessment.correct_answer || '').trim().toUpperCase());
        const currentCorrectMeaning = currentAnswerIndex >= 0 ? currentMeanings?.[currentAnswerIndex] : '';
        const currentContextValid = validContext(assessment.question_text, assessment.context_zh, currentCorrectMeaning);
        if (currentMeanings && currentContextValid) {
            alreadyComplete += 1;
            continue;
        }

        const sourceQuestionId = String(assessment.source_question_id || '').trim();
        const snapshotCandidates = challengeQuestions.filter(row => {
            const challenge = challengeById.get(String(row.challenge_id || ''));
            if (!challengeAnalysis(row, challenge, assessment)) return false;
            if (sourceQuestionId) {
                return sourceQuestionId === String(row.id || '')
                    || sourceQuestionId === String(row.cache_question_id || '');
            }
            return true;
        });
        const snapshotSource = snapshotCandidates.length === 1 ? snapshotCandidates[0] : null;
        const snapshotAnalysis = snapshotSource
            ? challengeAnalysis(snapshotSource, challengeById.get(String(snapshotSource.challenge_id || '')), assessment)
            : null;
        let cache = cacheById.get(sourceQuestionId) || null;
        if (!cache) {
            const candidates = cacheGroups.get(cacheKey(assessment)) || [];
            if (candidates.length === 1) cache = candidates[0];
        }
        const analysis = snapshotAnalysis || cacheAnalysis(cache, assessment, wordById.get(String(assessment.word_id || '')));
        if (!analysis) {
            unresolvedIds.push(String(assessment.id || ''));
            continue;
        }
        const patch = {};
        if (!currentMeanings) patch.option_meanings = analysis.meanings;
        const patchCorrectIndex = 'ABCD'.indexOf(String(assessment.correct_answer || cache.answer || '').trim().toUpperCase());
        const patchCorrectMeaning = patchCorrectIndex >= 0 ? (patch.option_meanings || currentMeanings)?.[patchCorrectIndex] : '';
        if (!validContext(assessment.question_text, assessment.context_zh, patchCorrectMeaning)) {
            patch.context_zh = analysis.contextZh;
        }
        if (Object.keys(patch).length) {
            repairs.push({
                id: String(assessment.id || ''),
                patch,
                expected: {
                    option_meanings: assessment.option_meanings,
                    context_zh: assessment.context_zh,
                },
                identity: {
                    user_id: assessment.user_id,
                    word_id: assessment.word_id,
                    test_id: assessment.test_id,
                    question_text: assessment.question_text,
                    correct_answer: assessment.correct_answer,
                },
                sourceCacheId: String(cache?.id || snapshotSource?.cache_question_id || ''),
                ...(snapshotSource ? { sourceChallengeQuestionId: String(snapshotSource.id || '') } : {}),
            });
        }
    }
    return { scanned, alreadyComplete, repairs, unresolvedIds };
}

async function applyAssessmentChineseAnalysisPlan(client, plan) {
    let updated = 0;
    let skippedConcurrent = 0;
    for (const repair of plan?.repairs || []) {
        const allowedPatch = Object.fromEntries(Object.entries(repair.patch || {})
            .filter(([key]) => key === 'option_meanings' || key === 'context_zh'));
        if (!Object.keys(allowedPatch).length) continue;
        let query = client.from('assessments')
            .update(allowedPatch)
            .eq('id', repair.id);
        for (const [key, expected] of Object.entries(repair.identity || {})) {
            query = expected === null || expected === undefined
                ? query.is(key, null)
                : query.eq(key, expected);
        }
        for (const key of Object.keys(allowedPatch)) {
            const expected = repair.expected?.[key];
            query = expected === null || expected === undefined
                ? query.is(key, null)
                : Array.isArray(expected)
                    ? query.filter(key, 'eq', JSON.stringify(expected))
                    : query.eq(key, expected);
        }
        const { data, error } = await query
            .select('id')
            .maybeSingle();
        if (error) throw error;
        if (!data) {
            skippedConcurrent += 1;
            continue;
        }
        updated += 1;
    }
    return { updated, skippedConcurrent };
}

async function readAll(client, table, columns) {
    const rows = [];
    let lastId = '';
    for (;;) {
        let query = client.from(table).select(columns).order('id', { ascending: true }).limit(PAGE_SIZE);
        if (lastId) query = query.gt('id', lastId);
        const { data, error } = await query;
        if (error) throw error;
        const page = Array.isArray(data) ? data : [];
        rows.push(...page);
        if (page.length < PAGE_SIZE) return rows;
        lastId = String(page[page.length - 1].id || '');
    }
}

async function collectInputs(client) {
    const [assessments, caches, challengeQuestions, challenges, words] = await Promise.all([
        readAll(client, 'assessments', 'id,user_id,word_id,source_question_id,test_id,question_type,question_text,options,correct_answer,is_correct,option_meanings,context_zh'),
        readAll(client, 'question_cache', 'id,user_id,word_id,question_text,options,answer,option_meanings,context_zh'),
        readAll(client, 'quiz_challenge_questions', 'id,challenge_id,meaning_id,cache_question_id,stem,question_snapshot'),
        readAll(client, 'quiz_challenges', 'id,user_id,test_id'),
        readAll(client, 'words', 'id,user_id,meaning_zh'),
    ]);
    return { assessments, caches, challengeQuestions, challenges, words };
}

function reportFor(plan, mode, result = {}) {
    return {
        batch: `assessment-chinese-analysis-${new Date().toISOString()}`,
        mode,
        scanned: plan.scanned,
        alreadyComplete: plan.alreadyComplete,
        repairable: plan.repairs.length,
        unresolved: plan.unresolvedIds.length,
        updated: Number(result.updated || 0),
        skippedConcurrent: Number(result.skippedConcurrent || 0),
        repairs: plan.repairs.map(item => ({
            id: item.id,
            fields: Object.keys(item.patch).sort(),
            sourceCacheId: item.sourceCacheId,
            ...(item.sourceChallengeQuestionId
                ? { sourceChallengeQuestionId: item.sourceChallengeQuestionId }
                : {}),
        })),
        unresolvedIds: plan.unresolvedIds,
    };
}

async function main() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_BACKFILL_CREDENTIALS_REQUIRED');
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const plan = buildAssessmentChineseAnalysisPlan(await collectInputs(client));
    const apply = process.argv.includes('--apply');
    const result = apply ? await applyAssessmentChineseAnalysisPlan(client, plan) : { updated: 0 };
    process.stdout.write(JSON.stringify(reportFor(plan, apply ? 'apply' : 'inventory', result), null, 2) + '\n');
}

if (require.main === module) main().catch(error => {
    console.error(error?.message === 'SUPABASE_BACKFILL_CREDENTIALS_REQUIRED'
        ? error.message
        : `ASSESSMENT_CHINESE_ANALYSIS_BACKFILL_FAILED${error?.code ? ` (${error.code})` : ''}`);
    process.exitCode = 1;
});

module.exports = {
    applyAssessmentChineseAnalysisPlan,
    buildAssessmentChineseAnalysisPlan,
    collectInputs,
    readAll,
    reportFor,
};
