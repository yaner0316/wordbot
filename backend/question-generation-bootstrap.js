'use strict';

const crypto = require('node:crypto');
const supabaseClient = require('./supabase-client');
const { createQuestionGenerationRuntime } = require('./question-generation-runtime');
const { createSupabaseQuestionCoverageRuntime } = require('./question-coverage-runtime');
const {
    buildCacheQuestionRowsForWord,
    generateReplacementContextWithAI,
} = require('./supabase-data');
const { generateSupabaseDistractors } = require('./supabase-distractors');
const { translateSupabaseContext, translateSupabaseWords } = require('./supabase-translations');
const { auditUniqueAnswer } = require('./question-semantic-audit');

const DEFAULT_QUESTION_WORKER_BATCH_SIZE = 1;
const DEFAULT_QUESTION_WORKER_LEASE_MS = 15 * 60 * 1000;
const DEFAULT_QUESTION_WORKER_MAX_ATTEMPTS = 20;
const DEFAULT_QUESTION_GENERATION_ATTEMPTS = 3;
const DEFAULT_QUESTION_COVERAGE_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_QUESTION_COVERAGE_BATCH_SIZE = 250;

function createDefaultCandidateBuilderOptions() {
    return {
        generateDistractors: generateSupabaseDistractors,
        translateWords: translateSupabaseWords,
        translateContext: translateSupabaseContext,
        generateContext: generateReplacementContextWithAI,
        semanticAudit: auditUniqueAnswer,
        requireSemanticAudit: true,
    };
}

function createDefaultQuestionGenerationRuntime({ onError, onSuccess, onCoverageError, onCoverageSuccess } = {}) {
    const workerId = String(process.env.WORDBOT_QUESTION_WORKER_ID || '').trim()
        || `wordbot-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
    const runtime = createQuestionGenerationRuntime({
        client: supabaseClient,
        workerId,
        buildCandidates: buildCacheQuestionRowsForWord,
        candidateBuilderOptions: createDefaultCandidateBuilderOptions(),
        batchSize: Number(process.env.WORDBOT_QUESTION_WORKER_BATCH_SIZE || DEFAULT_QUESTION_WORKER_BATCH_SIZE),
        pollIntervalMs: Number(process.env.WORDBOT_QUESTION_WORKER_POLL_MS || 5000),
        leaseDurationMs: Number(process.env.WORDBOT_QUESTION_WORKER_LEASE_MS || DEFAULT_QUESTION_WORKER_LEASE_MS),
        maxAttempts: Number(process.env.WORDBOT_QUESTION_WORKER_MAX_ATTEMPTS || DEFAULT_QUESTION_WORKER_MAX_ATTEMPTS),
        maxGenerationAttempts: DEFAULT_QUESTION_GENERATION_ATTEMPTS,
        runImmediately: true,
        onError: typeof onError === 'function' ? onError : () => {},
        onSuccess: typeof onSuccess === 'function' ? onSuccess : () => {},
    });
    const coverage = createSupabaseQuestionCoverageRuntime({
        client: supabaseClient,
        limit: Number(process.env.WORDBOT_QUESTION_COVERAGE_BATCH_SIZE || DEFAULT_QUESTION_COVERAGE_BATCH_SIZE),
        intervalMs: Number(process.env.WORDBOT_QUESTION_COVERAGE_INTERVAL_MS || DEFAULT_QUESTION_COVERAGE_INTERVAL_MS),
        runImmediately: true,
        onError: typeof onCoverageError === 'function' ? onCoverageError : () => {},
        onSuccess: typeof onCoverageSuccess === 'function' ? onCoverageSuccess : () => {},
    });
    return {
        ...runtime,
        coverageController: coverage.controller,
        reconcileCoverage: coverage.reconcile,
    };
}

module.exports = {
    DEFAULT_QUESTION_GENERATION_ATTEMPTS,
    DEFAULT_QUESTION_WORKER_MAX_ATTEMPTS,
    DEFAULT_QUESTION_WORKER_BATCH_SIZE,
    DEFAULT_QUESTION_WORKER_LEASE_MS,
    DEFAULT_QUESTION_COVERAGE_INTERVAL_MS,
    DEFAULT_QUESTION_COVERAGE_BATCH_SIZE,
    createDefaultCandidateBuilderOptions,
    createDefaultQuestionGenerationRuntime,
};
