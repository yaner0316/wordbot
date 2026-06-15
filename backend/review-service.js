const { getAssessmentMode } = require('./assessment-mode');
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
    isSubmitted,
    isCorrect,
    fieldValue,
}) {
    const submittedResults = new Map();

    function assessmentOwner(records) {
        return new Set(records.map(item => fieldValue(item.fields?.user)));
    }

    function toSource(record) {
        const fields = record.fields || {};
        return {
            sourceQuestionId: record.record_id,
            recordId: fieldValue(fields.record_id),
            word: fieldValue(fields.word).toLowerCase(),
            type: Number(fieldValue(fields.question_type)) || 1,
            context: fieldValue(fields.context),
            options: parseOptions(fields.options),
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
        return buildRoundResponse(
            records.filter(record => fieldValue(record.fields?.test_id) === reviewId)
        );
    }

    function buildRoundResponse(records) {
        if (!records.length) return null;
        const first = records[0].fields || {};
        return {
            reviewId: fieldValue(first.test_id),
            sourceTestId: fieldValue(first.source_test_id),
            parentReviewId: fieldValue(first.parent_review_id),
            round: Number(fieldValue(first.review_round)) || 1,
            mode: getAssessmentMode(fieldValue(first.test_id)),
            status: fieldValue(first.review_status),
            questions: records.map(record => ({
                recordId: fieldValue(record.fields?.record_id),
                type: Number(fieldValue(record.fields?.question_type)) || 1,
                word: fieldValue(record.fields?.word),
                context: fieldValue(record.fields?.context),
                options: parseOptions(record.fields?.options),
                answer: fieldValue(record.fields?.correct_answer),
            })),
        };
    }

    async function createRound({
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
        const sourceRecords = await loadAssessmentRecords(sourceAssessmentId);
        if (!sourceRecords.length) throw new Error('未找到复习来源记录');
        const owners = assessmentOwner(sourceRecords);
        if (owners.size !== 1 || !owners.has(userId)) {
            throw new Error('测验不属于当前用户');
        }
        if (!sourceRecords.every(isSubmitted)) {
            throw new Error('必须先提交并查看上一轮结果');
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
            const info = await loadWordInfo(source.recordId, wordRecords);
            const question = await buildReviewQuestion({
                userId,
                reviewId,
                source,
                info,
                wordRecords,
                usedDistractors,
            });
            questions.push({ ...question, sourceQuestionId: source.sourceQuestionId });
        }

        const baseTime = Date.now();
        const rows = questions.map((question, index) => ({
            user: userId,
            test_id: reviewId,
            record_id: question.record_id,
            word: question.word,
            question_type: question.type,
            context: question.context,
            correct_answer: question.answer,
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
            questions: questions.map(question => ({
                recordId: question.record_id,
                type: question.type,
                word: question.word,
                context: question.context,
                options: question.options,
                answer: question.answer,
            })),
        };
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
        const records = await loadAssessmentRecords(reviewId);
        if (!records.length) throw new Error('未找到复习记录');
        const first = records[0].fields || {};
        const result = await submitAssessment(userId, reviewId, answers);
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
        const records = await loadAssessmentRecords(reviewId);
        if (!records.length) throw new Error('未找到复习记录');
        const owners = assessmentOwner(records);
        if (owners.size !== 1 || !owners.has(userId)) {
            throw new Error('复习不属于当前用户');
        }
        const cached = submittedResults.get(reviewId);
        const remaining = new Set(
            cached?.remainingRecordIds ||
            records
                .filter(record => !isCorrect(record.fields?.is_correct))
                .map(record => fieldValue(record.fields?.record_id))
        );
        if (!remaining.size) throw new Error('当前复习没有待延期错词');
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
