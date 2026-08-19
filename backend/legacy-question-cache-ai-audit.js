'use strict';

const { createHash } = require('node:crypto');

function text(value) {
    return String(value || '').trim();
}

function isEligible(row) {
    return text(row?.quality_status).toLowerCase() === 'ready'
        && ['active', 'reserved_next_day'].includes(text(row?.cache_state || 'active').toLowerCase())
        && Number(row?.question_type) === 1
        && text(row?.ai_audit_status).toLowerCase() !== 'approved'
        && text(row?.id)
        && text(row?.user_id)
        && text(row?.word_id);
}

function normalizePlanItem(row) {
    const content = {
        questionText: text(row.question_text),
        options: Array.isArray(row.options) ? row.options : [],
        optionMeanings: Array.isArray(row.option_meanings) ? row.option_meanings : [],
        answer: text(row.answer).toUpperCase(),
    };
    return {
        cacheId: text(row.id),
        userId: text(row.user_id),
        wordId: text(row.word_id),
        rowVersion: text(row.updated_at),
        qualityStatus: text(row.quality_status).toLowerCase(),
        cacheState: text(row.cache_state || 'active').toLowerCase(),
        questionType: text(row.question_type),
        aiAuditStatus: text(row.ai_audit_status).toLowerCase(),
        contentHash: createHash('sha256').update(JSON.stringify(content)).digest('hex'),
    };
}

function createLegacyAuditPlan(rows = []) {
    const items = rows.filter(isEligible).map(normalizePlanItem)
        .sort((left, right) => left.cacheId.localeCompare(right.cacheId));
    const payload = { version: 1, items };
    return {
        items,
        planFingerprint: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
    };
}

function requireFunction(dependencies, name) {
    const value = dependencies?.[name];
    if (typeof value !== 'function') throw new Error(`${name.toUpperCase()}_REQUIRED`);
    return value;
}

function toAuditQuestion(row) {
    return {
        cacheId: text(row.id),
        type: 1,
        context: text(row.question_text),
        options: Array.isArray(row.options) ? row.options : [],
        optionMeanings: Array.isArray(row.option_meanings) ? row.option_meanings : [],
        answer: text(row.answer).toUpperCase(),
    };
}

async function runLegacyQuestionCacheAiAudit(dependencies, options = {}) {
    const loadRows = requireFunction(dependencies, 'loadRows');
    const rows = await loadRows();
    const plan = createLegacyAuditPlan(rows);
    const apply = options.apply === true;
    const reviewedFingerprint = text(options.planFingerprint).toLowerCase();
    if (apply && !reviewedFingerprint) {
        throw new Error('PLAN_FINGERPRINT_REQUIRED: run dry-run and review its planFingerprint first');
    }
    if (apply && reviewedFingerprint !== plan.planFingerprint) {
        throw new Error('PLAN_FINGERPRINT_MISMATCH: cache scope changed; run a new dry-run');
    }

    const progress = {
        total: plan.items.length,
        audited: 0,
        approved: 0,
        replacementQueued: 0,
        unavailable: 0,
        failed: 0,
    };
    if (!apply) {
        return {
            mode: 'dry-run',
            planned: plan.items.length,
            planFingerprint: plan.planFingerprint,
            nextAfterId: plan.items.at(-1)?.cacheId || null,
            progress,
            items: plan.items,
        };
    }

    const auditQuestion = requireFunction(dependencies, 'auditQuestion');
    const approveRow = requireFunction(dependencies, 'approveRow');
    const enqueueReplacement = requireFunction(dependencies, 'enqueueReplacement');
    const rowsById = new Map(rows.map(row => [text(row?.id), row]));
    for (const item of plan.items) {
        try {
            const audit = await auditQuestion(toAuditQuestion(rowsById.get(item.cacheId)));
            progress.audited += 1;
            if (audit?.approved === true && text(audit?.status).toLowerCase() === 'approved') {
                await approveRow(item);
                progress.approved += 1;
            } else if (text(audit?.status).toLowerCase() === 'rejected') {
                await enqueueReplacement(item);
                progress.replacementQueued += 1;
            } else {
                progress.unavailable += 1;
            }
        } catch (_) {
            progress.failed += 1;
        }
    }
    return {
        mode: 'apply',
        planned: plan.items.length,
        planFingerprint: plan.planFingerprint,
        nextAfterId: plan.items.at(-1)?.cacheId || null,
        progress,
    };
}

module.exports = {
    createLegacyAuditPlan,
    normalizePlanItem,
    runLegacyQuestionCacheAiAudit,
};
