'use strict';

const { normalizeLevel } = require('./learning-level');
const { getCacheQuestionReadinessIssues } = require('./question-cache');
const { getReadyPrimaryPairIssues } = require('./question-cache-pair');

const EXECUTABLE_JOB_STATUSES = new Set([
    'pending',
    'generating',
    'validating',
    'repairing',
    'retry_wait',
]);

function text(value) {
    return String(value || '').trim();
}

function isCoverageTarget(word) {
    if (!text(word?.id || word?.word_id) || !text(word?.user_id)) return false;
    if (word?.deleted_at) return false;
    const status = text(word?.mastery_status).toLowerCase();
    return status !== 'mastered' && status !== 'deleted';
}

function readinessRow(row, word) {
    return {
        ...row,
        user: row?.user || row?.user_id,
        word_record_id: row?.word_record_id || row?.source_word_record_id || word?.id,
        word: row?.word || word?.word,
        context_cn: row?.context_cn || row?.context_zh,
    };
}

function hasCurrentQuestionCoverage({ word, user, cacheRows = [] } = {}) {
    if (!isCoverageTarget(word) || text(user?.id) !== text(word?.user_id)) return false;
    let level;
    try {
        level = normalizeLevel(user?.learning_level);
    } catch (_) {
        return false;
    }
    const candidates = cacheRows
        .filter(row => text(row?.user_id || row?.user) === text(word.user_id))
        .filter(row => text(row?.word_id || row?.meaning_id) === text(word.id || word.word_id))
        .filter(row => text(row?.level) === level)
        .map(row => readinessRow(row, word))
        .filter(row => getCacheQuestionReadinessIssues(row, { requireAiAudit: true }).length === 0);
    return getReadyPrimaryPairIssues(candidates).length === 0;
}

function jobIsExecutable(job, word) {
    return text(job?.user_id) === text(word?.user_id)
        && text(job?.word_id) === text(word?.id || word?.word_id)
        && Number(job?.word_version) === Number(word?.question_generation_version)
        && EXECUTABLE_JOB_STATUSES.has(text(job?.status).toLowerCase());
}

function planQuestionCoverage({ users = [], words = [], cacheRows = [], jobs = [], limit = Infinity } = {}) {
    const usersById = new Map(users.map(user => [text(user?.id), user]));
    const cacheByWordId = new Map();
    const jobsByWordId = new Map();
    for (const row of cacheRows) {
        const wordId = text(row?.word_id || row?.meaning_id);
        if (!cacheByWordId.has(wordId)) cacheByWordId.set(wordId, []);
        cacheByWordId.get(wordId).push(row);
    }
    for (const job of jobs) {
        const wordId = text(job?.word_id);
        if (!jobsByWordId.has(wordId)) jobsByWordId.set(wordId, []);
        jobsByWordId.get(wordId).push(job);
    }

    const summary = { scanned: 0, targets: 0, ready: 0, executable: 0, planned: 0 };
    const targets = [];
    const boundedLimit = Number.isFinite(Number(limit))
        ? Math.max(0, Math.floor(Number(limit)))
        : Infinity;
    for (const word of words) {
        summary.scanned += 1;
        if (!isCoverageTarget(word)) continue;
        const user = usersById.get(text(word.user_id));
        if (!user) continue;
        summary.targets += 1;
        const wordId = text(word.id || word.word_id);
        if (hasCurrentQuestionCoverage({ word, user, cacheRows: cacheByWordId.get(wordId) || [] })) {
            summary.ready += 1;
            continue;
        }
        if ((jobsByWordId.get(wordId) || []).some(job => jobIsExecutable(job, word))) {
            summary.executable += 1;
            continue;
        }
        if (targets.length < boundedLimit) {
            targets.push({
                userId: text(word.user_id),
                wordId,
                wordVersion: Number(word.question_generation_version) || 1,
                reason: 'coverage_reconcile',
            });
        }
    }
    summary.planned = targets.length;
    return { targets, summary };
}

module.exports = {
    hasCurrentQuestionCoverage,
    isCoverageTarget,
    planQuestionCoverage,
    EXECUTABLE_JOB_STATUSES,
};
