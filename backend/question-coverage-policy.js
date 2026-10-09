'use strict';

const { normalizeLevel } = require('./learning-level');
const { getCacheQuestionReadinessIssues } = require('./question-cache');
const { getReadyPrimaryPairIssues } = require('./question-cache-pair');
const { isValidGenerationWord } = require('./question-generation-eligibility');

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

function hasUsableCurrentLevel(user) {
    if (text(user?.learning_level) === '') return false;
    try {
        normalizeLevel(user.learning_level);
        return true;
    } catch (_) {
        return false;
    }
}

function hasCurrentQuestionCoverage({ word, user, cacheRows = [], displayEvents = [], now = Date.now() } = {}) {
    if (!isCoverageTarget(word) || !isValidGenerationWord(word.word) || text(user?.id) !== text(word?.user_id)) return false;
    let level;
    try {
        level = normalizeLevel(user?.learning_level);
    } catch (_) {
        return false;
    }
    const normalizeStem = value => text(value).toLowerCase().replace(/\s+/g, ' ');
    const consumed = new Set(displayEvents.filter(event => text(event.user_id) === text(word.user_id)
        && text(event.meaning_id) === text(word.id || word.word_id) && Date.parse(event.history_expires_at) > Number(now))
        .map(event => normalizeStem(event.stem)));
    const candidates = cacheRows
        .filter(row => text(row?.user_id || row?.user) === text(word.user_id))
        .filter(row => text(row?.word_id || row?.meaning_id) === text(word.id || word.word_id))
        .filter(row => text(row?.level) === level)
        .filter(row => !consumed.has(normalizeStem(row.question_text)))
        .map(row => readinessRow(row, word))
        .filter(row => getCacheQuestionReadinessIssues(row, { requireAiAudit: true }).length === 0);
    return getReadyPrimaryPairIssues(candidates).length === 0;
}

function jobIsExecutable(job, word) {
    return isValidGenerationWord(word?.word) && text(job?.user_id) === text(word?.user_id)
        && text(job?.word_id) === text(word?.id || word?.word_id)
        && Number(job?.word_version) === Number(word?.question_generation_version)
        && EXECUTABLE_JOB_STATUSES.has(text(job?.status).toLowerCase());
}

function planQuestionCoverage({ users = [], words = [], cacheRows = [], jobs = [], displayEvents = [], now = Date.now(), limit = Infinity } = {}) {
    const usersById = new Map(users.map(user => [text(user?.id), user]));
    const cacheByWordId = new Map();
    const jobsByWordId = new Map();
    const displaysByWordId = new Map();
    for (const event of displayEvents) {
        const wordId = text(event.meaning_id);
        if (!displaysByWordId.has(wordId)) displaysByWordId.set(wordId, []);
        displaysByWordId.get(wordId).push(event);
    }
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

    const summary = { scanned: 0, targets: 0, ready: 0, executable: 0, planned: 0, skippedMissingLevel: 0, blockedInvalidWord: 0 };
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
        if (!isValidGenerationWord(word.word)) {
            summary.blockedInvalidWord += 1;
            continue;
        }
        // Every formal question is generated at the user's current learning level.
        // Without a selected level the generator refuses the work, so planning these
        // meanings only produces un-actionable targets. Report them instead.
        if (!hasUsableCurrentLevel(user)) {
            summary.skippedMissingLevel += 1;
            continue;
        }
        const wordId = text(word.id || word.word_id);
        if (hasCurrentQuestionCoverage({ word, user, cacheRows: cacheByWordId.get(wordId) || [], displayEvents: displaysByWordId.get(wordId) || [], now })) {
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
    hasUsableCurrentLevel,
    isCoverageTarget,
    planQuestionCoverage,
    EXECUTABLE_JOB_STATUSES,
};
