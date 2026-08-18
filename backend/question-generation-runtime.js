'use strict';

const { createQuestionGenerationJobStore } = require('./question-generation-job');
const { createQuestionGenerationService } = require('./question-generation-service');
const { createQuestionGenerationWorker } = require('./question-generation-worker');
const { normalizeLevel } = require('./learning-level');
const { getQuestionQualityIssues, hasMeaningfulChineseMeaning } = require('./question-quality');
const { isContextSentenceTranslationAcceptable } = require('./context-sentence-translation');

const DEFAULT_CLAIM_RPC = 'claim_question_generation_jobs';
const RENEW_RPC = 'renew_question_generation_job';
const PUBLISH_RPC = 'publish_question_generation_variants';
const COMPLETE_RPC = 'complete_question_generation_job';
const FAIL_RPC = 'fail_question_generation_job';
const JOB_TABLE = 'question_generation_jobs';
const CACHE_TABLE = 'question_cache';
const WORD_TABLE = 'words';

function requireClient(client) {
    if (!client || typeof client.from !== 'function' || typeof client.rpc !== 'function') {
        throw new Error('SUPABASE_CLIENT_REQUIRED');
    }
    return client;
}

function requireFunction(value, code) {
    if (typeof value !== 'function') throw new Error(code);
    return value;
}

function requireId(value, code) {
    const id = String(value || '').trim();
    if (!id) throw new Error(code);
    return id;
}

function throwSupabaseError(error, operation) {
    if (!error) return;
    if (error instanceof Error) throw error;
    const wrapped = new Error(String(error.message || `${operation} failed`));
    Object.assign(wrapped, error);
    throw wrapped;
}

function rowsFrom(data) {
    if (Array.isArray(data)) return data;
    return data && typeof data === 'object' ? [data] : [];
}

function normalizeStem(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function createStaleLeaseError() {
    const error = new Error('Question generation job lease is no longer owned by this worker');
    error.code = 'JOB_LEASE_NOT_OWNED_OR_STALE';
    return error;
}

function createSupabaseQuestionGenerationJobStore({
    client,
    claimRpc = DEFAULT_CLAIM_RPC,
    now,
    leaseDurationMs,
    maxAttempts,
    baseBackoffMs,
    maxBackoffMs,
} = {}) {
    const supabase = requireClient(client);
    const rpcName = requireId(claimRpc, 'QUESTION_GENERATION_CLAIM_RPC_REQUIRED');

    async function upsert(row, options) {
        const { data, error } = await supabase
            .from(JOB_TABLE)
            .upsert(row, {
                onConflict: options?.onConflict || 'word_id',
                ignoreDuplicates: options?.ignoreDuplicates !== false,
            })
            .select('*')
            .maybeSingle();
        throwSupabaseError(error, 'questionGenerationJob.enqueue');
        return data;
    }

    async function claimDue(request) {
        const { data, error } = await supabase.rpc(rpcName, {
            p_worker_id: request.workerId,
            p_limit: request.limit,
            p_lease_duration_ms: Math.max(1, Number(leaseDurationMs) || 60_000),
        });
        throwSupabaseError(error, 'questionGenerationJob.claim');
        return rowsFrom(data);
    }

    async function updateClaimed(request) {
        const isComplete = request?.row?.status === 'ready';
        const rpc = isComplete ? COMPLETE_RPC : FAIL_RPC;
        const args = {
            p_job_id: request.jobId,
            p_worker_id: request.workerId,
            p_expected_word_version: request.expectedWordVersion,
            p_lease_token: request.leaseToken,
            ...(isComplete ? {} : {
                p_max_attempts: Math.max(1, Number(maxAttempts) || 5),
                p_base_backoff_ms: Math.max(1, Number(baseBackoffMs) || 60_000),
                p_max_backoff_ms: Math.max(1, Number(maxBackoffMs) || 3_600_000),
                p_error_code: String(request?.patch?.last_error_code || 'QUESTION_GENERATION_FAILED'),
                p_error_detail: String(request?.patch?.last_error_detail || 'Question generation failed'),
                p_rejection_reasons: request?.patch?.rejection_reasons || {},
            }),
        };
        const { data, error } = await supabase.rpc(rpc, args);
        throwSupabaseError(error, 'questionGenerationJob.' + (isComplete ? 'complete' : 'fail'));
        const row = rowsFrom(data)[0];
        if (!row) throw createStaleLeaseError();
        return row;
    }

    async function renewClaimed(request) {
        const { data, error } = await supabase.rpc(RENEW_RPC, {
            p_job_id: request.jobId,
            p_worker_id: request.workerId,
            p_expected_word_version: request.expectedWordVersion,
            p_lease_token: request.leaseToken,
            p_lease_duration_ms: Math.max(1, Number(leaseDurationMs) || 60_000),
        });
        throwSupabaseError(error, 'questionGenerationJob.renew');
        const row = rowsFrom(data)[0];
        if (!row) throw createStaleLeaseError();
        return row;
    }

    return createQuestionGenerationJobStore({
        upsert,
        claimDue,
        updateClaimed,
        renewClaimed,
        now,
        leaseDurationMs,
        maxAttempts,
        baseBackoffMs,
        maxBackoffMs,
    });
}

function createSupabaseWordLoader({ client } = {}) {
    const supabase = requireClient(client);
    return async function loadWord(wordId, userId) {
        const exactWordId = requireId(wordId, 'WORD_ID_REQUIRED');
        const exactUserId = requireId(userId, 'USER_ID_REQUIRED');
        const { data, error } = await supabase
            .from(WORD_TABLE)
            .select('*')
            .eq('id', exactWordId)
            .eq('user_id', exactUserId)
            .maybeSingle();
        throwSupabaseError(error, 'questionGeneration.loadWord');
        if (!data) return null;
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('learning_level')
            .eq('id', exactUserId)
            .maybeSingle();
        throwSupabaseError(userError, 'questionGeneration.loadUserLevel');
        return {
            ...data,
            // Formal question stems and quality gates follow the child's
            // current learning level, never the word's historical level.
            level: normalizeLevel(user?.learning_level),
        };
    };
}

function validatePublishableVariants(variants, requiredReadyCount) {
    const required = Math.max(2, Number(requiredReadyCount) || 2);
    if (required !== 2) {
        const error = new Error('The product invariant requires exactly two ready variants');
        error.code = 'REQUIRED_READY_COUNT_MUST_BE_TWO';
        throw error;
    }
    if (!Array.isArray(variants) || variants.length !== 2) {
        const error = new Error('Exactly two ready variants are required before publishing');
        error.code = 'EXACTLY_TWO_READY_VARIANTS_REQUIRED';
        throw error;
    }
    const fingerprints = new Set();
    const stems = new Set();
    for (const variant of variants) {
        const fingerprint = String(variant?.question_fingerprint || '').trim();
        const stem = normalizeStem(variant?.question_text || variant?.questionText);
        if (!fingerprint || !stem || fingerprints.has(fingerprint) || stems.has(stem)) {
            const error = new Error('Published variants require distinct fingerprints and question stems');
            error.code = 'INVALID_READY_VARIANTS_FOR_PUBLISH';
            throw error;
        }
        fingerprints.add(fingerprint);
        stems.add(stem);
    }
    return fingerprints;
}

function createSupabaseReadyVariantPublisher({ client, workerId, requiredReadyCount = 2 } = {}) {
    const supabase = requireClient(client);
    const configuredWorkerId = String(workerId || '').trim();

    return async function publishReadyVariants({ job, variants } = {}) {
        const exactJobId = requireId(job?.id, 'JOB_ID_REQUIRED');
        const exactWorkerId = requireId(configuredWorkerId || job?.lease_owner, 'WORKER_ID_REQUIRED');
        const newFingerprints = validatePublishableVariants(variants, requiredReadyCount);
        const { data, error } = await supabase.rpc(PUBLISH_RPC, {
            p_job_id: exactJobId,
            p_expected_word_version: job?.word_version,
            p_lease_token: job?.lease_token,
            p_worker_id: exactWorkerId,
            p_variants: variants,
        });
        throwSupabaseError(error, 'questionGenerationCache.publish');
        const result = rowsFrom(data)[0];
        if (!result) throw createStaleLeaseError();
        return {
            published: Math.max(0, Number(result.published) || 0),
            retired: Math.max(0, Number(result.retired) || 0),
            fingerprints: Array.isArray(result.fingerprints) ? result.fingerprints : [...newFingerprints],
        };
    };
}

function defaultValidateCandidate(candidate, word) {
    const issues = [];
    const questionText = normalizeStem(candidate?.question_text || candidate?.questionText);
    const options = Array.isArray(candidate?.options) ? candidate.options : [];
    const normalizedOptions = options.map(normalizeStem).filter(Boolean);
    const answer = String(candidate?.answer || '').trim().toUpperCase();
    if (!questionText) issues.push('question_text_required');
    if (options.length !== 4 || normalizedOptions.length !== 4 || new Set(normalizedOptions).size !== 4) {
        issues.push('four_distinct_options_required');
    }
    if (!/^[A-D]$/.test(answer)) issues.push('answer_invalid');
    if (!String(candidate?.question_type || candidate?.questionType || '').trim()) issues.push('question_type_required');
    if (!String(candidate?.correct_meaning || candidate?.meaning_zh || candidate?.meaning_en || '').trim()) {
        issues.push('correct_meaning_required');
    }
    const optionMeanings = Array.isArray(candidate?.option_meanings)
        ? candidate.option_meanings.map(value => String(value || '').trim())
        : [];
    if (optionMeanings.length !== 4 || !optionMeanings.every(hasMeaningfulChineseMeaning)) {
        issues.push('bad_option_meanings');
    } else if (new Set(optionMeanings.map(value => value.toLowerCase())).size !== 4) {
        issues.push('duplicate_option_meanings');
    }
    if (!hasMeaningfulChineseMeaning(candidate?.correct_meaning)) {
        issues.push('bad_correct_meaning');
    }
    if (!isContextSentenceTranslationAcceptable({
        type: Number(candidate?.question_type || candidate?.questionType || 0),
        context: candidate?.question_text || candidate?.questionText,
        contextCN: candidate?.context_zh || candidate?.contextCN,
        correctMeaning: candidate?.correct_meaning,
    })) {
        issues.push('invalid_context_translation');
    }
    if (candidate?.quality_status && candidate.quality_status !== 'ready') issues.push('quality_status_not_ready');
    if (candidate?.round_type && candidate.round_type !== 'primary') issues.push('round_type_not_primary');
    if (candidate?.word_id && String(candidate.word_id) !== String(word?.id)) issues.push('word_id_mismatch');
    if (candidate?.user_id && String(candidate.user_id) !== String(word?.user_id)) issues.push('user_id_mismatch');
    const questionType = Number(candidate?.question_type || candidate?.questionType);
    const qualityQuestion = {
        type: questionType,
        level: candidate?.level || word?.level || '',
        word: candidate?.word || word?.word || '',
        context: questionText,
        options,
        answer,
        correctMeaning: candidate?.correct_meaning || candidate?.meaning_zh || candidate?.meaning_en || '',
        optionMeanings: candidate?.option_meanings || candidate?.optionMeanings || [],
    };
    // Type-one candidates must contain a blank before semantic context checks are meaningful.
    if (questionType !== 1 || /_{3,}/.test(questionText)) {
        issues.push(...getQuestionQualityIssues(qualityQuestion));
    }
    return issues;
}

function resolveCandidateBuilder(buildCandidates) {
    if (typeof buildCandidates === 'function') return buildCandidates;
    const { buildCacheQuestionRowsForWord } = require('./supabase-data');
    return requireFunction(buildCacheQuestionRowsForWord, 'BUILD_CANDIDATES_REQUIRED');
}

function createSupabaseQuestionGenerationService({
    client,
    workerId,
    buildCandidates,
    candidateBuilderOptions = {},
    validateCandidate = defaultValidateCandidate,
    requiredReadyCount = 2,
    maxAttempts = 3,
} = {}) {
    const supabase = requireClient(client);
    const builder = resolveCandidateBuilder(buildCandidates);
    const validate = requireFunction(validateCandidate, 'VALIDATE_CANDIDATE_REQUIRED');
    const loadWord = createSupabaseWordLoader({ client: supabase });
    const publishReadyVariants = createSupabaseReadyVariantPublisher({
        client: supabase,
        workerId,
        requiredReadyCount,
    });

    const generationService = createQuestionGenerationService({
        loadWord,
        validateCandidate: validate,
        requiredReadyCount,
        maxAttempts,
        generateCandidates: async ({ job, word, attempt, requiredCount, existingFingerprints }) => builder({
            ...candidateBuilderOptions,
            client: supabase,
            job,
            word,
            user: { id: word.user_id },
            level: word.level || candidateBuilderOptions.level,
            attempt,
            requiredCount,
            existingFingerprints,
        }),
        publishReadyVariants,
    });

    return generationService;
}

function createQuestionGenerationRuntime({
    client,
    buildCandidates,
    candidateBuilderOptions,
    validateCandidate,
    workerId,
    claimRpc,
    requiredReadyCount = 2,
    maxGenerationAttempts = 3,
    now,
    leaseDurationMs,
    maxAttempts,
    baseBackoffMs,
    maxBackoffMs,
    batchSize,
    pollIntervalMs,
    runImmediately,
    onError,
    onSuccess,
    setIntervalFn,
    clearIntervalFn,
} = {}) {
    const supabase = requireClient(client);
    const loadWord = createSupabaseWordLoader({ client: supabase });
    const publishReadyVariants = createSupabaseReadyVariantPublisher({
        client: supabase,
        workerId,
        requiredReadyCount,
    });
    const builder = resolveCandidateBuilder(buildCandidates);
    let jobStore;
    const generationService = createQuestionGenerationService({
        loadWord,
        validateCandidate: validateCandidate || defaultValidateCandidate,
        requiredReadyCount,
        maxAttempts: maxGenerationAttempts,
        generateCandidates: async ({ job, word, attempt, requiredCount, existingFingerprints }) => builder({
            ...(candidateBuilderOptions || {}),
            client: supabase,
            job,
            word,
            user: { id: word.user_id },
            level: word.level || candidateBuilderOptions?.level,
            attempt,
            requiredCount,
            existingFingerprints,
        }),
        beforePublish: async ({ job }) => jobStore.renew(job, { workerId }),
        publishReadyVariants,
    });
    jobStore = createSupabaseQuestionGenerationJobStore({
        client: supabase,
        claimRpc,
        now,
        leaseDurationMs,
        maxAttempts,
        baseBackoffMs,
        maxBackoffMs,
    });
    const worker = createQuestionGenerationWorker({
        jobStore,
        generationService,
        workerId,
        batchSize,
        pollIntervalMs,
        runImmediately,
        onError,
        onSuccess,
        setIntervalFn,
        clearIntervalFn,
    });

    return {
        worker,
        jobStore,
        generationService,
        loadWord,
        publishReadyVariants,
    };
}

module.exports = {
    createSupabaseQuestionGenerationJobStore,
    createSupabaseWordLoader,
    createSupabaseReadyVariantPublisher,
    createSupabaseQuestionGenerationService,
    createQuestionGenerationRuntime,
};

