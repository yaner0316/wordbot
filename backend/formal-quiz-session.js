'use strict';

const { getAssessmentMode, normalizeAssessmentMode } = require('./assessment-mode');

const FORMAL_QUIZ_REQUIRED_COUNT = 10;

function quizMeaningId(question) {
    return String(question?.meaningId || question?.meaning_id || question?.record_id || question?.wordRecordId || question?.sourceRecordId || '').trim();
}

function assertFormalQuizQuestions(questions) {
    if (!Array.isArray(questions) || questions.length !== FORMAL_QUIZ_REQUIRED_COUNT) {
        throw new Error('FORMAL_QUIZ_INCOMPLETE');
    }
    if (questions.some(question => {
        const source = String(question?.source || '').trim().toLowerCase();
        return source !== 'question_cache' || !String(question?.cacheRecordId || '').trim();
    })) {
        throw new Error('FORMAL_QUIZ_CACHE_ONLY_REQUIRED');
    }
    const meaningIds = questions.map(quizMeaningId);
    if (meaningIds.some(id => !id)) throw new Error('FORMAL_QUIZ_MEANING_ID_REQUIRED');
    if (new Set(meaningIds).size !== meaningIds.length) {
        throw new Error('FORMAL_QUIZ_DUPLICATE_MEANING_ID');
    }
}

function isResumableQuizSession(session, requestedMode = 'real') {
    const normalizedMode = normalizeAssessmentMode(requestedMode);
    if (!session || normalizedMode !== 'real' || getAssessmentMode(session.test_id) !== 'real') return false;

    const sessionMode = String(session.mode || 'real').trim().toLowerCase();
    const sessionSource = String(session.source || '').trim().toLowerCase();
    if (sessionMode !== 'real' || (sessionSource && sessionSource !== 'question_cache')) return false;

    const questions = Array.isArray(session.questions) ? session.questions : [];
    if (questions.length !== FORMAL_QUIZ_REQUIRED_COUNT) return false;
    if (questions.some(question => Number(question?.type) !== 1)) return false;

    const meaningIds = questions.map(quizMeaningId);
    return questions.every(question => {
        const source = String(question?.source || '').trim().toLowerCase();
        return String(question?.cacheRecordId || '').trim()
            && (!source || source === 'question_cache');
    })
        && meaningIds.every(Boolean)
        && new Set(meaningIds).size === questions.length;
}

module.exports = {
    FORMAL_QUIZ_REQUIRED_COUNT,
    assertFormalQuizQuestions,
    isResumableQuizSession,
    quizMeaningId,
};
