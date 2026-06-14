const { getAssessmentMode } = require('./assessment-mode');
const {
    normalizeSubmittedAnswer,
    parseStoredAnswer,
} = require('./mastery-evidence');
const { calculateGameReward } = require('./game-reward');

function fieldValue(value) {
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return value.length > 0 ? fieldValue(value[0]) : '';
    if (typeof value === 'object') {
        if (value.text !== undefined) return String(value.text);
        if (value.name !== undefined) return String(value.name);
        if (value.value !== undefined) return String(value.value);
        if (value.id !== undefined) return String(value.id);
        return JSON.stringify(value);
    }
    return String(value);
}

function validateAnswers(answers, questionCount) {
    if (!Array.isArray(answers)) {
        throw new Error('答案必须是数组');
    }
    if (answers.length !== questionCount) {
        throw new Error('答案数量必须与题目数量一致');
    }
    for (const answer of answers) {
        const normalized = normalizeSubmittedAnswer(answer);
        if (!Number.isInteger(normalized.option) || normalized.option < 0 || normalized.option > 3) {
            throw new Error('答案只能是 0 到 3 的整数');
        }
    }
}

function rebuildSubmittedResult(records, isCorrectValue) {
    const results = records.map((record, index) => {
        const fields = record.fields || {};
        const storedAnswer = parseStoredAnswer(fieldValue(fields.your_answer));
        return {
            q: index + 1,
            word: fieldValue(fields.word).toLowerCase(),
            recordId: fieldValue(fields.record_id),
            your: storedAnswer.option || null,
            answer: fieldValue(fields.correct_answer),
            correct: isCorrectValue(fields.is_correct),
            confidence: storedAnswer.confidence,
        };
    });
    const correct = results.filter(result => result.correct).length;
    const total = results.length;

    return {
        alreadySubmitted: true,
        mode: getAssessmentMode(fieldValue(records[0]?.fields?.test_id)),
        results,
        correct,
        total,
        accuracy: total > 0 ? `${((correct / total) * 100).toFixed(1)}%` : '0.0%',
        masteredWords: [],
        gameReward: calculateGameReward({
            testId: fieldValue(records[0]?.fields?.test_id),
            mode: getAssessmentMode(fieldValue(records[0]?.fields?.test_id)),
            correct,
            total,
        }),
    };
}

function createSubmissionCoordinator({
    loadRecords,
    isSubmitted,
    rebuildResult,
    settle,
}) {
    const locks = new Map();

    async function execute(userId, testId, answers) {
        const records = await loadRecords(testId);
        if (records.length === 0) {
            throw new Error('未找到测试记录');
        }

        const owners = new Set(records.map(record => fieldValue(record.fields?.user)));
        if (owners.size !== 1 || !owners.has(userId)) {
            throw new Error('考试不属于当前用户');
        }

        validateAnswers(answers, records.length);

        const submittedCount = records.filter(isSubmitted).length;
        if (submittedCount === records.length) {
            return rebuildResult(records);
        }
        if (submittedCount > 0) {
            throw new Error('考试提交状态不完整，请联系管理员');
        }

        return settle(records, answers, userId, testId);
    }

    async function submit(userId, testId, answers) {
        const key = `${userId}:${testId}`;
        const previous = locks.get(key) || Promise.resolve();
        const task = previous
            .catch(() => {})
            .then(() => execute(userId, testId, answers));

        locks.set(key, task);
        try {
            return await task;
        } finally {
            if (locks.get(key) === task) {
                locks.delete(key);
            }
        }
    }

    return { submit };
}

module.exports = {
    createSubmissionCoordinator,
    validateAnswers,
    rebuildSubmittedResult,
};
