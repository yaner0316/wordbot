'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');
const { runLegacyQuestionCacheAiAudit } = require('../legacy-question-cache-ai-audit');
const { auditUniqueAnswer } = require('../question-semantic-audit');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function parseArguments(argv = []) {
    const args = { apply: false, planFingerprint: '', afterId: '', limit: DEFAULT_LIMIT };
    for (let index = 0; index < argv.length; index += 1) {
        const value = argv[index];
        if (value === '--apply') args.apply = true;
        else if (value === '--plan-fingerprint') args.planFingerprint = String(argv[++index] || '').trim();
        else if (value === '--after-id') args.afterId = String(argv[++index] || '').trim();
        else if (value === '--limit') args.limit = Math.min(MAX_LIMIT, Math.max(1, Number(argv[++index]) || DEFAULT_LIMIT));
        else throw new Error('INVALID_ARGUMENT');
    }
    return args;
}

function requireEnvironment() {
    const url = String(process.env.SUPABASE_URL || '').trim();
    const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!url || !key) throw new Error('SUPABASE_AUDIT_CREDENTIALS_REQUIRED');
    return { url, key };
}

function createDependencies(client, { afterId, limit }) {
    return {
        loadRows: async () => {
            let query = client.from('question_cache')
                .select('id,user_id,word_id,quality_status,cache_state,question_type,question_text,options,answer,option_meanings,ai_audit_status,source_version,updated_at')
                .eq('quality_status', 'ready')
                .in('cache_state', ['active', 'reserved_next_day'])
                .eq('question_type', '1')
                .or('ai_audit_status.is.null,ai_audit_status.neq.approved')
                .order('id', { ascending: true })
                .limit(limit);
            if (afterId) query = query.gt('id', afterId);
            const { data, error } = await query;
            if (error) throw error;
            return data || [];
        },
        auditQuestion: auditUniqueAnswer,
        approveRow: async item => {
            const { data, error } = await client.from('question_cache')
                .update({ ai_audit_status: 'approved', source_version: 'legacy-ai-audited-v1' })
                .eq('id', item.cacheId)
                .eq('user_id', item.userId)
                .eq('word_id', item.wordId)
                .eq('updated_at', item.rowVersion)
                .eq('quality_status', 'ready')
                .in('cache_state', ['active', 'reserved_next_day'])
                .eq('question_type', '1')
                .or('ai_audit_status.is.null,ai_audit_status.neq.approved')
                .select('id');
            if (error || !Array.isArray(data) || data.length !== 1) throw new Error('CACHE_AUDIT_APPROVAL_FAILED');
        },
        enqueueReplacement: async item => {
            const { error } = await client.rpc('enqueue_question_generation_job_if_needed', {
                p_user_id: item.userId,
                p_word_id: item.wordId,
                p_reason: 'legacy_ai_audit_rejected',
            });
            if (error) throw new Error('CACHE_AUDIT_REPLACEMENT_ENQUEUE_FAILED');
        },
    };
}

function safeErrorCode(error) {
    const code = String(error?.message || error || '');
    return [
        'INVALID_ARGUMENT',
        'SUPABASE_AUDIT_CREDENTIALS_REQUIRED',
        'PLAN_FINGERPRINT_REQUIRED',
        'PLAN_FINGERPRINT_MISMATCH',
    ].find(value => code.startsWith(value)) || 'LEGACY_QUESTION_CACHE_AI_AUDIT_FAILED';
}

async function main() {
    const options = parseArguments(process.argv.slice(2));
    const { url, key } = requireEnvironment();
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const result = await runLegacyQuestionCacheAiAudit(createDependencies(client, options), options);
    result.afterId = options.afterId || null;
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (require.main === module) main().catch(error => {
    console.error(safeErrorCode(error));
    process.exitCode = 1;
});

module.exports = { createDependencies, parseArguments, requireEnvironment, safeErrorCode };
