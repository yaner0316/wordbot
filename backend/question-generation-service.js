'use strict';

const crypto = require('node:crypto');

function normalizeText(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function fingerprintQuestion(candidate, wordId) {
    const payload = JSON.stringify({
        wordId: String(wordId || '').trim(),
        questionText: normalizeText(candidate?.question_text || candidate?.questionText),
        questionType: normalizeText(candidate?.question_type || candidate?.questionType || '1'),
        meaning: normalizeText(candidate?.correct_meaning || candidate?.meaning_zh || candidate?.meaning_en),
    });
    return crypto.createHash('sha256').update(payload).digest('hex');
}

function validationIssues(validateCandidate, candidate, word) {
    const result = validateCandidate(candidate, word);
    if (Array.isArray(result)) return result.filter(Boolean);
    if (result === true || result === undefined || result === null) return [];
    if (result === false) return ['quality_rejected'];
    return [String(result)];
}

function insufficientVariantsError(readyCount, rejectionReasons) {
    const error = new Error('Could not build two distinct quality-approved question variants');
    error.code = 'INSUFFICIENT_DISTINCT_READY_VARIANTS';
    error.readyCount = readyCount;
    error.rejectionReasons = rejectionReasons;
    return error;
}

function createQuestionGenerationService({
    loadWord,
    generateCandidates,
    validateCandidate,
    publishReadyVariants,
    beforePublish = async () => {},
    requiredReadyCount = 2,
    maxAttempts = 3,
} = {}) {
    if (typeof loadWord !== 'function') throw new Error('LOAD_WORD_REQUIRED');
    if (typeof generateCandidates !== 'function') throw new Error('GENERATE_CANDIDATES_REQUIRED');
    if (typeof validateCandidate !== 'function') throw new Error('VALIDATE_CANDIDATE_REQUIRED');
    if (typeof publishReadyVariants !== 'function') throw new Error('PUBLISH_READY_VARIANTS_REQUIRED');
    if (typeof beforePublish !== 'function') throw new Error('BEFORE_PUBLISH_REQUIRED');

    const required = Math.max(2, Number(requiredReadyCount) || 2);
    const attemptsLimit = Math.max(1, Number(maxAttempts) || 3);

    return {
        async process(job) {
            const wordId = String(job?.word_id || job?.wordId || '').trim();
            const userId = String(job?.user_id || job?.userId || '').trim();
            if (!wordId) throw new Error('WORD_ID_REQUIRED');
            if (!userId) throw new Error('USER_ID_REQUIRED');

            const word = await loadWord(wordId, userId);
            if (!word) {
                const error = new Error('Word meaning no longer exists');
                error.code = 'WORD_NOT_FOUND';
                throw error;
            }

            const variantsByFingerprint = new Map();
            const rejectionReasons = {};
            for (let attempt = 1; attempt <= attemptsLimit && variantsByFingerprint.size < required; attempt += 1) {
                const candidates = await generateCandidates({
                    job,
                    word,
                    attempt,
                    requiredCount: required,
                    existingFingerprints: new Set(variantsByFingerprint.keys()),
                });
                for (const candidate of candidates || []) {
                    const issues = validationIssues(validateCandidate, candidate, word);
                    if (issues.length) {
                        for (const issue of issues) rejectionReasons[issue] = (rejectionReasons[issue] || 0) + 1;
                        continue;
                    }
                    const questionFingerprint = fingerprintQuestion(candidate, wordId);
                    if (variantsByFingerprint.has(questionFingerprint)) {
                        rejectionReasons.duplicate_fingerprint = (rejectionReasons.duplicate_fingerprint || 0) + 1;
                        continue;
                    }
                    variantsByFingerprint.set(questionFingerprint, {
                        ...candidate,
                        user_id: userId,
                        word_id: wordId,
                        round_type: 'primary',
                        quality_status: 'ready',
                        question_fingerprint: questionFingerprint,
                    });
                    if (variantsByFingerprint.size >= required) break;
                }
            }

            if (variantsByFingerprint.size < required) {
                throw insufficientVariantsError(variantsByFingerprint.size, rejectionReasons);
            }

            const variants = [...variantsByFingerprint.values()].slice(0, required).map((variant, index) => ({
                ...variant,
                variant_slot: index + 1,
                cache_state: index === 0 ? 'active' : 'reserved_next_day',
            }));
            await beforePublish({ job, userId, wordId, word, variants });
            await publishReadyVariants({ job, userId, wordId, word, variants });
            return { readyCount: variants.length, variants, rejectionReasons };
        },
    };
}

module.exports = {
    createQuestionGenerationService,
    fingerprintQuestion,
};
