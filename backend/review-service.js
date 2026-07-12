const { getAssessmentMode } = require('./assessment-mode');
const { isMeaningAnswerCorrect, isMultiMeaningCorrect } = require('./meaning-review');
const { buildReviewRecordFields } = require('./review-record');
const {
    REVIEW_STATUS,
    createReviewId,
    summarizeReviewRound,
} = require('./review-session');

function parseOptions(value) {
    if (Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(String(value || '[]'));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return String(value || '').split(/\n|\|/).map(item => item.trim()).filter(Boolean);
    }
}

function buildMeaningRecallQuestion({ reviewId, source, info }) {
    return {
        type: 4,
        answerMode: 'cn_meaning',
        word: info.word,
        context: '',
        options: [],
        correctMeaning: info.CN_Meaning || info.cn_meaning || '',
        answer: undefined,
        record_id: source.recordId,
        testId: reviewId,
    };
}

// Merge same-word type-4 questions into a single multi-def question.
// Writes one DB row per logical question (multi-def becomes one row with JSON array answer).
function mergeMultiDefQuestions(questions) {
    const wordIndex = new Map(); // lowercase word -> position in result
    const result = [];
    for (const q of questions) {
        if (q.type !== 4) {
            result.push({ ...q });
            continue;
        }
        const key = String(q.word || '').toLowerCase();
        if (wordIndex.has(key)) {
            const existing = result[wordIndex.get(key)];
            existing.correctMeanings = existing.correctMeanings || [existing.correctMeaning || ''];
            existing.correctMeanings.push(q.correctMeaning || '');
        } else {
            wordIndex.set(key, result.length);
            result.push({ ...q });
        }
    }
    return result;
}

function createReviewService({
    createId,
    loadAssessmentRecords,
    loadReviewChainRecords,
    loadWordInfo,
    loadWordRecords,
    buildReviewQuestion,
    addReviewRecords,
    updateReviewRecord,
    submitAssessment,
    correctValue,
    wrongValue,
    isSubmitted,
    isCorrect,
    fieldValue,
    resolveMeaningRecallAnswer = null,
    recordReadRetryAttempts = 12,
    recordReadRetryDelayMs = 500,
}) {
    const submittedResults = new Map();
    const inFlightRounds = new Map();

    function reviewCreationKey({ userId, sourceTestId, parentReviewId = '' }) {
        return [userId, sourceTestId, parentReviewId || ''].map(value => String(value ?? '')).join('\u0000');
    }

    function applySubmittedResult(records, assessmentId) {
        const summary = submittedResults.get(assessmentId);
        if (!summary || !Array.isArray(summary.remainingRecordIds)) return records;
        const remaining = new Set(summary.remainingRecordIds.map(item => String(item)));
        return records.map(record => {
            if (record?.fields?.is_correct !== undefined && record?.fields?.is_correct !== null) {
                return record;
            }
            const recordId = fieldValue(record?.fields?.record_id);
            return {
                ...record,
                fields: {
                    ...(record.fields || {}),
                    is_correct: remaining.has(recordId) ? wrongValue : correctValue,
                },
            };
        });
    }

    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function loadAssessmentRecordsWithRetry(
        assessmentId,
        isReady = records => records.length > 0
    ) {
        let records = [];
        for (let attempt = 0; attempt < recordReadRetryAttempts; attempt++) {
            records = await loadAssessmentRecords(assessmentId);
            if (records.length && isReady(records)) return records;
            if (recordReadRetryDelayMs > 0) await wait(recordReadRetryDelayMs);
        }
        return records;
    }

    function assessmentOwner(records) {
        return new Set(records.map(item => fieldValue(item.fields?.user)));
    }

    function toSource(record) {
        const fields = record.fields || {};
        return {
            sourceQuestionId: fieldValue(fields.source_question_id) || record.record_id,
            recordId: fieldValue(fields.record_id),
            word: fieldValue(fields.word).toLowerCase(),
            type: Number(fieldValue(fields.question_type)) || 1,
            context: fieldValue(fields.context),
            options: parseOptions(fields.options),
            correctAnswer: fieldValue(fields.correct_answer),
            level: fieldValue(fields.level),
        };
    }

    async function findExistingActive(userId, sourceTestId, parentReviewId = null) {
        const records = await loadReviewChainRecords(sourceTestId);
        const matches = records.filter(record => {
            const fields = record.fields || {};
            return fieldValue(fields.user) === userId &&
                fieldValue(fields.source_test_id) === sourceTestId &&
                (parentReviewId === null ||
                    fieldValue(fields.parent_review_id) === parentReviewId) &&
                fieldValue(fields.review_status) === REVIEW_STATUS.ACTIVE;
        });
        const match = matches.sort((left, right) =>
            Number(fieldValue(right.fields?.review_round)) -
            Number(fieldValue(left.fields?.review_round))
        )[0];
        if (!match) return null;
        const reviewId = fieldValue(match.fields.test_id);
        return await buildRoundResponse(
            records.filter(record => fieldValue(record.fields?.test_id) === reviewId)
        );
    }

    function contextFromWordInfo(info, type) {
        if (!info) return '';
        if (type === 1) return fieldValue(info.context);
        if (type === 2) return fieldValue(info.meaning).split(';')[0];
        return fieldValue(info.CN_Meaning || info.cn_meaning);
    }

    function findOriginalSourceRecord(reviewRecord, chainRecords = []) {
        const sourceQuestionId = fieldValue(reviewRecord.fields?.source_question_id);
        if (!sourceQuestionId) return null;
        return chainRecords.find(record => record.record_id === sourceQuestionId) || null;
    }

    async function resolveMeaningRecallForRecord(record, fallback, chainRecords = null) {
        if (typeof resolveMeaningRecallAnswer !== 'function') return fallback;
        const sourceTestId = fieldValue(record.fields?.source_test_id);
        const records = chainRecords || (sourceTestId ? await loadReviewChainRecords(sourceTestId) : []);
        const sourceRecord = findOriginalSourceRecord(record, records);
        const source = sourceRecord ? toSource(sourceRecord) : toSource(record);
        const recordId = fieldValue(record.fields?.record_id);
        let info = null;
        if (recordId) {
            try {
                info = await loadWordInfo(recordId);
            } catch {
                info = null;
            }
        }
        const resolved = await resolveMeaningRecallAnswer({
            record,
            source,
            info,
            fallback,
            fieldValue,
        });
        return fieldValue(resolved).trim() || fallback;
    }

    async function buildRoundResponse(records) {
        if (!records.length) return null;
        const first = records[0].fields || {};
        return {
            reviewId: fieldValue(first.test_id),
            sourceTestId: fieldValue(first.source_test_id),
            parentReviewId: fieldValue(first.parent_review_id),
            round: Number(fieldValue(first.review_round)) || 1,
            mode: getAssessmentMode(fieldValue(first.test_id)),
            status: fieldValue(first.review_status),
            questions: await Promise.all(records.map(async record => {
                const recordId = fieldValue(record.fields?.record_id);
                const type = Number(fieldValue(record.fields?.question_type)) || 1;
                let context = fieldValue(record.fields?.context);
                if (!context && recordId) {
                    const info = await loadWordInfo(recordId);
                    context = contextFromWordInfo(info, type);
                }
                let correctMeaning = '';
                let correctMeanings = null;
                if (type === 4) {
                    const raw = fieldValue(record.fields?.correct_answer);
                    try {
                        const parsed = JSON.parse(raw);
                        if (Array.isArray(parsed) && parsed.length > 1) {
                            correctMeanings = parsed;
                            correctMeaning = parsed[0];
                        } else {
                            correctMeaning = raw;
                        }
                    } catch {
                        correctMeaning = raw;
                    }
                }
                    if (!correctMeanings) {
                        correctMeaning = await resolveMeaningRecallForRecord(record, correctMeaning);
                    }
                return {
                    recordId,
                    type,
                    word: fieldValue(record.fields?.word),
                    context,
                    options: parseOptions(record.fields?.options),
                    answer: type === 4 ? undefined : fieldValue(record.fields?.correct_answer),
                    answerMode: type === 4 ? 'cn_meaning' : undefined,
                    correctMeaning,
                    correctMeanings,
                };
            })),
        };
    }

    async function createRoundOnce({
        userId,
        sourceTestId,
        parentReviewId = '',
    }) {
        const existing = await findExistingActive(
            userId,
            sourceTestId,
            parentReviewId
        );
        if (existing) return existing;

        const sourceAssessmentId = parentReviewId || sourceTestId;
        const sourceRecords = applySubmittedResult(
            await loadAssessmentRecordsWithRetry(
                sourceAssessmentId,
                records => records.every(isSubmitted)
            ),
            sourceAssessmentId
        );
        if (!sourceRecords.length) throw new Error('Review source records not found');
        const owners = assessmentOwner(sourceRecords);
        if (owners.size !== 1 || !owners.has(userId)) {
            throw new Error('Review source does not belong to current user');
        }
        if (!sourceRecords.every(isSubmitted)) {
            throw new Error('Source assessment must be submitted before review');
        }

        const wrongRecords = sourceRecords.filter(
            record => !isCorrect(record.fields?.is_correct)
        );
        if (!wrongRecords.length) {
            return {
                sourceTestId,
                parentReviewId,
                complete: true,
                questions: [],
            };
        }

        const chainRecords = await loadReviewChainRecords(sourceTestId);
        const usedDistractors = new Set(
            chainRecords.flatMap(record => {
                const correctWord = fieldValue(record.fields?.word).toLowerCase();
                return parseOptions(record.fields?.options)
                    .map(option => option.replace(/^[A-D]\.\s*/, '').trim().toLowerCase())
                    .filter(option => option && option !== correctWord);
            })
        );
        const mode = getAssessmentMode(sourceTestId);
        const reviewId = createReviewId(mode, createId);
        const round = parentReviewId
            ? Number(fieldValue(sourceRecords[0].fields?.review_round) || 0) + 1
            : 1;
        const wordRecords = typeof loadWordRecords === 'function'
            ? await loadWordRecords()
            : null;
        const questions = [];
        for (const record of wrongRecords) {
            const source = toSource(record);
            if (source.type === 4 && source.correctAnswer) {
                source.correctMeaning = await resolveMeaningRecallForRecord(record, source.correctAnswer, chainRecords);
            }
            const info = await loadWordInfo(source.recordId, wordRecords);
            const question = await (buildReviewQuestion || buildMeaningRecallQuestion)({
                userId,
                reviewId,
                source,
                info,
                wordRecords,
                usedDistractors,
            });
            questions.push({ ...question, sourceQuestionId: source.sourceQuestionId });
        }

        // Merge same-word type-4 questions into one multi-def question
        const mergedQuestions = mergeMultiDefQuestions(questions);

        const baseTime = Date.now();
        const rows = mergedQuestions.map((question, index) => ({
            user: userId,
            test_id: reviewId,
            record_id: question.record_id,
            word: question.word,
            question_type: question.type,
            context: question.context,
            correct_answer: question.type === 4
                ? (question.correctMeanings
                    ? JSON.stringify(question.correctMeanings)
                    : question.correctMeaning)
                : question.answer,
            options: JSON.stringify(question.options),
            test_time: baseTime + index,
            ...buildReviewRecordFields({
                sourceTestId,
                parentReviewId,
                round,
                status: REVIEW_STATUS.ACTIVE,
                sourceQuestionId: question.sourceQuestionId,
            }),
        }));
        await addReviewRecords(rows);
        return {
            reviewId,
            sourceTestId,
            parentReviewId,
            round,
            mode,
            status: REVIEW_STATUS.ACTIVE,
            questions: mergedQuestions.map(question => ({
                recordId: question.record_id,
                type: question.type,
                word: question.word,
                context: question.context,
                options: question.options,
                answer: question.type === 4 ? undefined : question.answer,
                answerMode: question.type === 4 ? 'cn_meaning' : question.answerMode,
                correctMeaning: question.correctMeaning || '',
                correctMeanings: question.correctMeanings || null,
            })),
        };
    }

    function createRound(input) {
        const key = reviewCreationKey(input || {});
        if (inFlightRounds.has(key)) return inFlightRounds.get(key);
        const promise = createRoundOnce(input).finally(() => {
            inFlightRounds.delete(key);
        });
        inFlightRounds.set(key, promise);
        return promise;
    }

    async function getActiveRound({ userId, sourceTestId }) {
        return findExistingActive(userId, sourceTestId);
    }

    async function getSummary({ userId, sourceTestId }) {
        const records = (await loadReviewChainRecords(sourceTestId)).filter(record =>
            fieldValue(record.fields?.user) === userId &&
            fieldValue(record.fields?.source_test_id) === sourceTestId
        );
        const recordIds = new Set(records.map(record =>
            fieldValue(record.fields?.record_id)
        ).filter(Boolean));
        const deferredRecordIds = [...new Set(records
            .filter(record =>
                fieldValue(record.fields?.review_status) === REVIEW_STATUS.DEFERRED
            )
            .map(record => fieldValue(record.fields?.record_id))
            .filter(Boolean))];
        return {
            sourceTestId,
            reviewedRecordIds: [...recordIds],
            deferredRecordIds,
            reviewed: recordIds.size,
            deferred: deferredRecordIds.length,
        };
    }

    async function submitRound({ userId, reviewId, answers }) {
        const records = await loadAssessmentRecordsWithRetry(reviewId);
        if (!records.length) throw new Error('Review records not found');
        const first = records[0].fields || {};
        if (records.every(record => Number(fieldValue(record.fields?.question_type)) === 4)) {
            const sortedRecords = [...records].sort((left, right) =>
                Number(fieldValue(left.fields?.test_time)) -
                Number(fieldValue(right.fields?.test_time))
            );
            const results = [];
            for (let index = 0; index < sortedRecords.length; index++) {
                const record = sortedRecords[index];
                const answer = answers[index] || {};
                let expectedRaw = fieldValue(record.fields?.correct_answer);

                // Detect multi-def: correct_answer is a JSON array
                let expectedMeanings = null;
                try {
                    const parsed = JSON.parse(expectedRaw);
                    if (Array.isArray(parsed) && parsed.length > 1) expectedMeanings = parsed;
                } catch { /* single-def */ }

                if (!expectedMeanings) {
                    const resolvedExpected = await resolveMeaningRecallForRecord(record, expectedRaw);
                    if (resolvedExpected && resolvedExpected !== expectedRaw) {
                        expectedRaw = resolvedExpected;
                        await updateReviewRecord(record.record_id, { correct_answer: expectedRaw });
                    }
                }

                let submitted, correct, yourTexts;
                if (expectedMeanings) {
                    yourTexts = (answer.texts || []).map(t => String(t ?? '').trim());
                    correct = isMultiMeaningCorrect(yourTexts, expectedMeanings);
                    submitted = yourTexts.join(' / ');
                } else {
                    submitted = String(answer.text ?? '').trim();
                    correct = isMeaningAnswerCorrect(submitted, expectedRaw);
                }

                const recordId = fieldValue(record.fields?.record_id);
                await updateReviewRecord(record.record_id, {
                    your_answer: submitted,
                    is_correct: correct ? correctValue : wrongValue,
                });
                results.push({
                    q: index + 1,
                    word: fieldValue(record.fields?.word),
                    recordId,
                    your: submitted,
                    yourTexts: yourTexts || null,
                    answer: expectedRaw,
                    expectedMeanings: expectedMeanings || null,
                    correct,
                    confidence: answer.confidence || '',
                });
            }
            const summary = summarizeReviewRound(results);
            submittedResults.set(reviewId, summary);
            for (const record of records) {
                await updateReviewRecord(record.record_id, {
                    review_status: summary.status,
                });
            }
            const total = results.length;
            const correct = results.filter(result => result.correct).length;
            return {
                mode: getAssessmentMode(reviewId),
                results,
                correct,
                total,
                accuracy: total ? `${((correct / total) * 100).toFixed(1)}%` : '0.0%',
                masteredWords: [],
                ...summary,
                reviewId,
                sourceTestId: fieldValue(first.source_test_id),
                round: Number(fieldValue(first.review_round)) || 1,
            };
        }        const result = await submitAssessment(userId, reviewId, answers);
        const summary = summarizeReviewRound(result.results || []);
        submittedResults.set(reviewId, summary);
        for (const record of records) {
            await updateReviewRecord(record.record_id, {
                review_status: summary.status,
            });
        }
        return {
            ...result,
            ...summary,
            reviewId,
            sourceTestId: fieldValue(first.source_test_id),
            round: Number(fieldValue(first.review_round)) || 1,
        };
    }

    async function deferRound({ userId, reviewId }) {
        const records = await loadAssessmentRecordsWithRetry(reviewId);
        if (!records.length) throw new Error('Review records not found');
        const owners = assessmentOwner(records);
        if (owners.size !== 1 || !owners.has(userId)) {
            throw new Error('Review source does not belong to current user');
        }
        const cached = submittedResults.get(reviewId);
        const remaining = new Set(
            cached?.remainingRecordIds ||
            records
                .filter(record => !isCorrect(record.fields?.is_correct))
                .map(record => fieldValue(record.fields?.record_id))
        );
        if (!remaining.size) throw new Error('No review words remain deferred');
        for (const record of records) {
            const recordId = fieldValue(record.fields?.record_id);
            await updateReviewRecord(record.record_id, {
                review_status: remaining.has(recordId)
                    ? REVIEW_STATUS.DEFERRED
                    : REVIEW_STATUS.COMPLETE,
            });
        }
        return {
            reviewId,
            deferred: true,
            remainingRecordIds: [...remaining],
        };
    }

    return {
        createRound,
        deferRound,
        getActiveRound,
        getSummary,
        submitRound,
    };
}

module.exports = {
    createReviewService,
    parseOptions,
};
