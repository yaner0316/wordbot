'use strict';

const {
    createQuestionCoverageController,
    createQuestionCoverageReconciler,
} = require('./question-coverage-controller');

const PAGE_SIZE = 1000;

function requireClient(client) {
    if (!client || typeof client.from !== 'function' || typeof client.rpc !== 'function') {
        throw new Error('SUPABASE_CLIENT_REQUIRED');
    }
    return client;
}

async function loadAllRows(client, table, columns) {
    const rows = [];
    let lastId = null;
    for (;;) {
        let query = client.from(table).select(columns);
        if (lastId !== null) query = query.gt('id', lastId);
        const { data, error } = await query.order('id', { ascending: true }).limit(PAGE_SIZE);
        if (error) throw new Error(`QUESTION_COVERAGE_${table.toUpperCase()}_LOAD_FAILED`);
        const page = Array.isArray(data) ? data : [];
        rows.push(...page);
        if (page.length < PAGE_SIZE) return rows;
        const nextId = page[page.length - 1]?.id;
        if (!nextId || String(nextId) === String(lastId)) {
            throw new Error(`QUESTION_COVERAGE_${table.toUpperCase()}_CURSOR_INVALID`);
        }
        lastId = nextId;
    }
}

function createSupabaseCoverageSnapshotReader(client) {
    return async function loadSnapshot() {
        const [users, words, cacheRows, jobs] = await Promise.all([
            loadAllRows(client, 'users', 'id,learning_level'),
            loadAllRows(client, 'words', 'id,user_id,word,mastery_status,question_generation_version'),
            loadAllRows(client, 'question_cache', 'id,user_id,word_id,source_word_record_id,level,round_type,quality_status,cache_state,variant_slot,question_type,question_text,context_zh,options,option_meanings,answer,correct_meaning,question_fingerprint,ai_audit_status,source_version'),
            loadAllRows(client, 'question_generation_jobs', 'id,user_id,word_id,word_version,status'),
        ]);
        return { users, words, cacheRows, jobs };
    };
}

function createSupabaseCoverageEnqueue(client) {
    return async function enqueue(target) {
        const { data, error } = await client.rpc('enqueue_question_generation_job_if_needed', {
            p_user_id: target.userId,
            p_word_id: target.wordId,
            p_reason: target.reason,
        });
        if (error) throw new Error('QUESTION_COVERAGE_ENQUEUE_FAILED');
        return data === true;
    };
}

function createSupabaseQuestionCoverageRuntime({
    client,
    limit,
    intervalMs,
    runImmediately,
    onError,
    onSuccess,
    now,
    setIntervalFn,
    clearIntervalFn,
} = {}) {
    const supabase = requireClient(client);
    const reconcile = createQuestionCoverageReconciler({
        loadSnapshot: createSupabaseCoverageSnapshotReader(supabase),
        enqueue: createSupabaseCoverageEnqueue(supabase),
        limit,
    });
    const controller = createQuestionCoverageController({
        reconcile,
        intervalMs,
        runImmediately,
        onError,
        onSuccess,
        now,
        setIntervalFn,
        clearIntervalFn,
    });
    return {
        controller,
        reconcile,
    };
}

module.exports = {
    createSupabaseQuestionCoverageRuntime,
    createSupabaseCoverageSnapshotReader,
    createSupabaseCoverageEnqueue,
};
