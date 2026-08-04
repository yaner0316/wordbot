'use strict';

const { createHash } = require('node:crypto');

const REQUIRED_READY_FINGERPRINTS = 2;
const PAGE_SIZE = 1000;
const invalidatedPlanFingerprints = new Set();

function normalizeId(value) {
    return String(value || '').trim();
}

function identityKey(userId, wordId) {
    return `${normalizeId(userId)}\u0000${normalizeId(wordId)}`;
}
function compareText(left, right) {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
}

function comparePlanJobs(left, right) {
    return compareText(normalizeId(left?.user_id), normalizeId(right?.user_id))
        || compareText(normalizeId(left?.word_id), normalizeId(right?.word_id));
}

function sortedPlanJobs(jobs = []) {
    return [...jobs]
        .map(job => ({
            user_id: normalizeId(job?.user_id),
            word_id: normalizeId(job?.word_id),
            reason: String(job?.reason || '').trim(),
        }))
        .sort(comparePlanJobs);
}

function createPlanFingerprint({ userId = null, jobs = [] } = {}) {
    const payload = {
        version: 1,
        userId: normalizeId(userId) || null,
        jobs: sortedPlanJobs(jobs),
    };
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}


function isMastered(word) {
    return String(word?.mastery_status || '').trim().toLowerCase() === 'mastered';
}

function readyFingerprintCounts(cacheRows) {
    const fingerprintsByMeaning = new Map();
    for (const row of cacheRows || []) {
        if (String(row?.round_type || '').trim() !== 'primary') continue;
        if (String(row?.quality_status || '').trim() !== 'ready') continue;
        const userId = normalizeId(row?.user_id);
        const wordId = normalizeId(row?.word_id);
        const fingerprint = normalizeId(row?.question_fingerprint);
        if (!userId || !wordId || !fingerprint) continue;
        const key = identityKey(userId, wordId);
        if (!fingerprintsByMeaning.has(key)) fingerprintsByMeaning.set(key, new Set());
        fingerprintsByMeaning.get(key).add(fingerprint);
    }
    return fingerprintsByMeaning;
}

function planQuestionGenerationJobBackfill({ words = [], cacheRows = [], jobs = [] } = {}) {
    const fingerprintsByMeaning = readyFingerprintCounts(cacheRows);
    const existingJobs = new Set(
        jobs
            .map(job => identityKey(job?.user_id, job?.word_id))
            .filter(key => key !== '\u0000')
    );
    const seenMeanings = new Set();
    const plannedJobs = [];
    const summary = {
        scannedMeanings: 0,
        eligibleMeanings: 0,
        alreadyReady: 0,
        alreadyQueued: 0,
        planned: 0,
    };

    for (const word of words) {
        const userId = normalizeId(word?.user_id);
        const wordId = normalizeId(word?.id || word?.word_id);
        if (!userId || !wordId) continue;
        const key = identityKey(userId, wordId);
        if (seenMeanings.has(key)) continue;
        seenMeanings.add(key);
        summary.scannedMeanings += 1;

        if (isMastered(word)) continue;
        summary.eligibleMeanings += 1;

        const readyCount = fingerprintsByMeaning.get(key)?.size || 0;
        if (readyCount >= REQUIRED_READY_FINGERPRINTS) {
            summary.alreadyReady += 1;
            continue;
        }
        if (existingJobs.has(key)) {
            summary.alreadyQueued += 1;
            continue;
        }
        plannedJobs.push({
            user_id: userId,
            word_id: wordId,
            reason: 'cache_backfill',
        });
    }

    plannedJobs.sort(comparePlanJobs);
    summary.planned = plannedJobs.length;
    return { jobs: plannedJobs, summary };
}

function requireDependency(dependencies, name) {
    const dependency = dependencies?.[name];
    if (typeof dependency !== 'function') throw new Error(`${name.toUpperCase()}_REQUIRED`);
    return dependency;
}

async function backfillQuestionGenerationJobs(dependencies, options = {}) {
    const loadWords = requireDependency(dependencies, 'loadWords');
    const loadQuestionCache = requireDependency(dependencies, 'loadQuestionCache');
    const loadJobs = requireDependency(dependencies, 'loadJobs');
    const apply = options.apply === true;
    const userId = normalizeId(options.userId) || null;
    const reviewedPlanFingerprint = normalizeId(options.planFingerprint).toLowerCase() || null;
    const loadOptions = { userId };

    const [words, cacheRows, jobs] = await Promise.all([
        loadWords(loadOptions),
        loadQuestionCache(loadOptions),
        loadJobs(loadOptions),
    ]);
    const plan = planQuestionGenerationJobBackfill({ words, cacheRows, jobs });
    const planFingerprint = createPlanFingerprint({ userId, jobs: plan.jobs });

    if (!apply) invalidatedPlanFingerprints.delete(planFingerprint);
    if (apply && !reviewedPlanFingerprint) {
        throw new Error('PLAN_FINGERPRINT_REQUIRED: run dry-run and review its planFingerprint first');
    }
    if (apply && invalidatedPlanFingerprints.has(reviewedPlanFingerprint)) {
        throw new Error('PLAN_FINGERPRINT_INVALIDATED: partial apply failed; run and review a new dry-run first');
    }
    if (apply && reviewedPlanFingerprint !== planFingerprint) {
        throw new Error('PLAN_FINGERPRINT_MISMATCH: data changed; run and review a new dry-run');
    }

    const progress = {
        total: plan.jobs.length,
        attempted: 0,
        applied: 0,
        skipped: 0,
        failed: 0,
    };
    const failures = [];
    if (apply) {
        const enqueueJob = requireDependency(dependencies, 'enqueueJob');
        for (const job of plan.jobs) {
            progress.attempted += 1;
            try {
                const enqueued = await enqueueJob(job);
                if (enqueued === false) {
                    progress.skipped += 1;
                } else {
                    progress.applied += 1;
                }
            } catch (error) {
                progress.failed += 1;
                failures.push({
                    user_id: job.user_id,
                    word_id: job.word_id,
                    error: String(error?.message || error || 'unknown enqueue failure'),
                });
            }
        }
    }

    if (apply && progress.applied > 0 && progress.failed > 0) {
        invalidatedPlanFingerprints.add(reviewedPlanFingerprint);
    }

    return {
        mode: apply ? 'apply' : 'dry-run',
        userId,
        planFingerprint,
        planned: plan.jobs.length,
        enqueued: progress.applied,
        applied: progress.applied,
        skipped: progress.skipped,
        failed: progress.failed,
        progress,
        failures,
        summary: plan.summary,
        jobs: plan.jobs,
    };
}

function parseArgs(argv = []) {
    const parsed = { apply: false, userId: null, planFingerprint: null, help: false };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--apply') {
            parsed.apply = true;
        } else if (argument === '--help' || argument === '-h') {
            parsed.help = true;
        } else if (argument === '--user-id') {
            const value = normalizeId(argv[index + 1]);
            if (!value || value.startsWith('--')) throw new Error('USER_ID_VALUE_REQUIRED');
            parsed.userId = value;
            index += 1;
        } else if (argument === '--plan-fingerprint') {
            const value = normalizeId(argv[index + 1]).toLowerCase();
            if (!value || value.startsWith('--')) {
                throw new Error('PLAN_FINGERPRINT_VALUE_REQUIRED');
            }
            if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('PLAN_FINGERPRINT_VALUE_INVALID');
            parsed.planFingerprint = value;
            index += 1;
        } else {
            throw new Error(`UNKNOWN_ARGUMENT: ${argument}`);
        }
    }
    return parsed;
}

async function loadAllRows(client, table, columns, userId, orderColumn = null) {
    const rows = [];
    let lastId = null;
    for (;;) {
        let query = client
            .from(table)
            .select(columns);
        if (userId) query = query.eq('user_id', userId);
        if (orderColumn && lastId !== null) query = query.gt(orderColumn, lastId);
        if (orderColumn) query = query.order(orderColumn, { ascending: true });
        query = query.limit(PAGE_SIZE);
        const { data, error } = await query;
        if (error) throw new Error(table.toUpperCase() + '_LOAD_FAILED: ' + error.message);
        const page = data || [];
        rows.push(...page);
        if (page.length < PAGE_SIZE) return rows;
        if (!orderColumn) continue;
        const nextLastId = page[page.length - 1]?.[orderColumn];
        if (nextLastId === undefined || nextLastId === null || String(nextLastId) === String(lastId)) {
            throw new Error(table.toUpperCase() + '_KEYSET_CURSOR_INVALID');
        }
        lastId = nextLastId;
    }
}

function createSupabaseDependencies(client) {
    if (!client || typeof client.from !== 'function') throw new Error('SUPABASE_CLIENT_REQUIRED');
    return {
        loadWords: ({ userId } = {}) => loadAllRows(
            client,
            'words',
            'id,user_id,word,meaning_zh,mastery_status',
            userId, 'id'
        ),
        loadQuestionCache: ({ userId } = {}) => loadAllRows(
            client,
            'question_cache',
            'id,user_id,word_id,round_type,quality_status,question_fingerprint',
            userId, 'id'
        ),
        loadJobs: ({ userId } = {}) => loadAllRows(
            client,
            'question_generation_jobs',
            'id,user_id,word_id,status',
            userId, 'id'
        ),
        async enqueueJob(job) {
            const { data, error } = await client.rpc(
                'enqueue_question_generation_job_if_needed',
                {
                    p_user_id: job.user_id,
                    p_word_id: job.word_id,
                    p_reason: job.reason,
                },
            );
            if (error) throw new Error('QUESTION_GENERATION_JOB_ENQUEUE_FAILED: ' + error.message);
            return data === true;
        },
    };
}

function usage() {
    return [
        'Usage: node backend/scripts/backfill-question-generation-jobs.js [--user-id UUID] [--apply --plan-fingerprint SHA256]',
        '',
        'Default mode is dry-run. Review its jobs and planFingerprint.',
        'Apply writes only when --apply includes that exact --plan-fingerprint.',
    ].join('\n');
}

async function main(argv = process.argv.slice(2)) {
    const options = parseArgs(argv);
    if (options.help) {
        process.stdout.write(`${usage()}\n`);
        return null;
    }
    const client = require('../supabase-client');
    const result = await backfillQuestionGenerationJobs(createSupabaseDependencies(client), options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.failed > 0) process.exitCode = 1;
    return result;
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`${error.stack || error.message}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    REQUIRED_READY_FINGERPRINTS,
    parseArgs,
    planQuestionGenerationJobBackfill,
    createPlanFingerprint,
    backfillQuestionGenerationJobs,
    createSupabaseDependencies,
    main,
};
