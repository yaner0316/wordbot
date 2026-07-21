const crypto = require('crypto');

const {
    buildQuizWordQueue,
    selectCachedQuestionsForWordQueue,
} = require('./quiz-word-queue');
const { createAssessmentId, getAssessmentMode, isRealAssessment } = require('./assessment-mode');
const { calculateGameReward } = require('./game-reward');
const { normalizeLevel } = require('./learning-level');
const {
    evaluateWordMastery,
    normalizeSubmittedAnswer,
} = require('./mastery-evidence');

const ANSWER_LETTERS = ['A', 'B', 'C', 'D'];

function toMillis(value) {
    if (value === undefined || value === null || value === '') return 0;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function sourceRecordId(row) {
    return String(row?.feishu_record_id || row?.source_word_record_id || row?.id || '').trim();
}

function submittedAnswerField(row) {
    const answer = String(row?.submitted_answer || '').trim();
    if (!answer) return '';
    if (answer.includes('|')) return answer;
    return row?.answer_confidence ? `${answer}|${row.answer_confidence}` : answer;
}

function isFeishuRecord(row) {
    return row && typeof row === 'object' && row.fields && row.record_id;
}

function normalizeOptionalLevel(level) {
    return normalizeLevel(level, { allowNull: true }) || '';
}

function toFeishuWordRecord(row, { username }) {
    if (isFeishuRecord(row)) return row;
    const recordTime = toMillis(row.entered_at || row.created_at);
    const recordId = sourceRecordId(row);
    return {
        record_id: recordId,
        created_time: recordTime,
        fields: {
            user: row.username || username,
            Word: row.word || '',
            Meaning: row.meaning_en || '',
            CN_Meaning: row.meaning_zh || '',
            POS: row.POS || (Array.isArray(row.parts_of_speech) ? row.parts_of_speech.join(', ') : ''),
            Context: row.context_en || '',
            Context_CN: row.context_zh || '',
            Distractors: JSON.stringify(row.distractors || []),
            Old_Distractors: JSON.stringify(row.old_distractors || []),
            Level: normalizeOptionalLevel(row.level),
            Status: row.mastery_status || '',
            Error_Count: row.error_count ?? 0,
            record_time: recordTime,
            remember_time: toMillis(row.remembered_at) || '',
        },
    };
}

function toFeishuAssessmentRecord(row, { username, sourceRecordIdByWordId = new Map() }) {
    if (isFeishuRecord(row)) return row;
    const assessedAt = toMillis(row.assessed_at || row.created_at);
    const wordRecordId = String(
        row.source_word_record_id ||
        sourceRecordIdByWordId.get(row.word_id) ||
        ''
    ).trim();
    return {
        record_id: sourceRecordId(row),
        created_time: assessedAt,
        fields: {
            user: row.username || username,
            test_id: row.test_id || '',
            record_id: wordRecordId,
            word: row.word_snapshot || '',
            question_type: row.question_type || '',
            context: row.question_text || '',
            correct_answer: row.correct_answer || '',
            options: JSON.stringify(row.options || []),
            test_time: assessedAt,
            level: normalizeOptionalLevel(row.level),
            source: row.source || '',
            is_correct: row.is_correct || '',
            your_answer: submittedAnswerField(row),
        },
    };
}

function toFeishuCacheRow(row, { username }) {
    if (isFeishuRecord(row)) return row;
    const generatedAt = toMillis(row.generated_at || row.created_at);
    const wordRecordId = String(
        row.source_word_record_id ||
        row.word_feishu_record_id ||
        row.word_id ||
        ''
    ).trim();
    return {
        record_id: row.feishu_record_id || row.id || sourceRecordId(row),
        created_time: generatedAt,
        fields: {
            user: row.username || username,
            word_record_id: wordRecordId,
            word: row.word || '',
            level: normalizeOptionalLevel(row.level),
            round_type: row.round_type || 'primary',
            quality_status: row.quality_status || 'pending',
            question_type: row.question_type || '',
            question_text: row.question_text || '',
            context_cn: row.context_zh || '',
            suffix: row.suffix || '',
            options: JSON.stringify(row.options || []),
            answer: row.answer || '',
            option_meanings: JSON.stringify(row.option_meanings || []),
            correct_meaning: row.correct_meaning || '',
            used_count: Number(row.used_count || 0),
            generated_at: generatedAt,
        },
    };
}

function buildWordSourceIdMap(wordRows) {
    return new Map(
        (wordRows || [])
            .filter((row) => row?.id)
            .map((row) => [row.id, sourceRecordId(row)])
    );
}

function isCorrectAssessmentValue(value) {
    return String(value || '').trim().toLowerCase() === 'correct';
}

function masteryStageToStatus(stage) {
    if (stage === 'mastered') return 'mastered';
    if (stage === 'consolidating') return 'consolidating';
    if (stage === 'recognized') return 'recognized';
    return 'pending';
}

function buildSubmitResult({ testId, results, correct }) {
    const total = results.length;
    const mode = getAssessmentMode(testId);
    return {
        alreadySubmitted: false,
        mode,
        results,
        correct,
        total,
        accuracy: total > 0 ? `${((correct / total) * 100).toFixed(1)}%` : '0.0%',
        masteredWords: [],
        gameReward: calculateGameReward({
            testId,
            mode,
            correct,
            total,
        }),
    };
}

function filterSelectableWordRows(wordRows) {
    return (wordRows || []).filter((row) => {
        if (isFeishuRecord(row)) return true;
        return row.mastery_status !== 'mastered';
    });
}

async function generateQuizWithDataSource({
    username,
    level,
    roundType = 'primary',
    limit = 10,
    now = Date.now(),
    minAgeMs = 0,
    dataSource,
    mode = 'real',
    createId = () => crypto.randomUUID().split('-')[0],
}) {
    if (!dataSource) throw new Error('DATA_SOURCE_REQUIRED');
    if (!username) throw new Error('USERNAME_REQUIRED');
    if (!level) throw new Error('LEVEL_REQUIRED');
    const effectiveLevel = normalizeLevel(level);

    const user = dataSource.getUserByUsername
        ? await dataSource.getUserByUsername(username)
        : null;
    const canonicalUsername = user?.username || username;

    const [wordRows, assessmentRows, cacheRows] = await Promise.all([
        dataSource.getWordsForUser(username),
        dataSource.getAssessmentsForUser(username),
        dataSource.getQuestionCache(username, effectiveLevel, roundType),
    ]);

    const selectableWordRows = filterSelectableWordRows(wordRows);
    const sourceRecordIdByWordId = buildWordSourceIdMap(wordRows);
    const wordRecords = selectableWordRows.map((row) => toFeishuWordRecord(row, { username: canonicalUsername }));
    const assessmentRecords = assessmentRows.map((row) =>
        toFeishuAssessmentRecord(row, { username: canonicalUsername, sourceRecordIdByWordId })
    );
    const questionCacheRows = cacheRows.map((row) => toFeishuCacheRow(row, { username: canonicalUsername }));

    const queue = buildQuizWordQueue({
        wordRecords,
        cacheRows: questionCacheRows,
        assessmentRecords,
        userId: canonicalUsername,
        level: effectiveLevel,
        limit: wordRecords.length || limit,
        now,
        minAgeMs,
    });

    const questions = selectCachedQuestionsForWordQueue({
        cacheRows: questionCacheRows,
        queue,
        userId: canonicalUsername,
        level: effectiveLevel,
        roundType,
        limit,
    }).map((question) => ({
        ...question,
        correctAnswer: question.answer,
    }));

    const diagnostics = {
        dataSource: dataSource.name || 'custom',
        user: canonicalUsername,
        level: effectiveLevel,
        roundType,
        wordCount: wordRows.length,
        selectableWordCount: wordRecords.length,
        assessmentCount: assessmentRecords.length,
        readyCacheCount: questionCacheRows.length,
        queueCount: queue.length,
        returnedQuestionCount: questions.length,
        excludedMasteredStatusCount: wordRows.length - selectableWordRows.length,
    };

    if (queue.length < limit) {
        return {
            error: 'Question pool exhausted for this level.',
            code: 'QUESTION_POOL_EXHAUSTED',
            source: 'question_cache',
            level: effectiveLevel,
            diagnostics,
            readyCount: queue.length,
            requiredCount: limit,
            questions,
        };
    }

    if (questions.length < limit) {
        return {
            error: 'Question cache is still preparing.',
            code: 'QUESTION_CACHE_NOT_READY',
            source: 'question_cache',
            level: effectiveLevel,
            diagnostics,
            readyCount: questions.length,
            requiredCount: limit,
            questions,
        };
    }

    return {
        testId: createAssessmentId(mode, createId),
        mode,
        source: 'question_cache',
        level: effectiveLevel,
        diagnostics,
        questions,
    };
}

async function submitQuizWithDataSource({
    username,
    testId,
    answers,
    questions,
    dataSource,
    now = Date.now,
    existingAssessments = [],
}) {
    if (!dataSource) throw new Error('DATA_SOURCE_REQUIRED');
    if (!username) throw new Error('USERNAME_REQUIRED');
    if (!testId) throw new Error('TEST_ID_REQUIRED');
    if (!Array.isArray(questions) || questions.length === 0) throw new Error('QUESTIONS_REQUIRED');
    if (!Array.isArray(answers) || answers.length !== questions.length) throw new Error('ANSWERS_COUNT_MISMATCH');

    const normalizedAnswers = answers.map(answer => {
        const normalized = normalizeSubmittedAnswer(answer);
        if (!Number.isInteger(normalized.option) || normalized.option < 0 || normalized.option > 3) {
            throw new Error('ANSWER_OPTION_INVALID');
        }
        return normalized;
    });

    let correct = 0;
    const results = [];
    const insertedAssessments = [];
    const existingBySourceRecordId = new Map(
        (existingAssessments || [])
            .filter(row => row?.submitted_answer !== null && row?.submitted_answer !== undefined && row?.is_correct)
            .map(row => [String(row.source_word_record_id || '').trim(), row])
            .filter(([recordId]) => recordId)
    );
    const shouldUpdateMastery = isRealAssessment(testId) && typeof dataSource.updateWordMastery === 'function';
    let wordRows = [];
    let baseAssessmentRows = [];
    let sourceRecordIdByWordId = new Map();
    let wordRecords = [];
    if (shouldUpdateMastery) {
        wordRows = typeof dataSource.getWordsForUser === 'function'
            ? await dataSource.getWordsForUser(username)
            : [];
        const sourceWordRecordIds = [...new Set(questions
            .map(question => String(question.record_id || question.wordRecordId || '').trim())
            .filter(Boolean))];
        baseAssessmentRows = typeof dataSource.getMasteryAssessmentsForWords === 'function'
            ? await dataSource.getMasteryAssessmentsForWords(username, sourceWordRecordIds)
            : await dataSource.getAssessmentsForUser(username);
        sourceRecordIdByWordId = buildWordSourceIdMap(wordRows);
        wordRecords = wordRows.map(row => toFeishuWordRecord(row, { username }));
    }

    for (let index = 0; index < questions.length; index++) {
        const question = questions[index];
        const submitted = normalizedAnswers[index];
        const yourAnswer = ANSWER_LETTERS[submitted.option];
        const correctAnswer = String(question.correctAnswer || question.answer || '').trim();
        const sourceWordRecordId = String(question.record_id || question.wordRecordId || '').trim();
        const existing = existingBySourceRecordId.get(sourceWordRecordId);
        if (existing) {
            const existingAnswer = String(existing.submitted_answer || '').split('|')[0].trim().toUpperCase();
            const existingCorrect = isCorrectAssessmentValue(existing.is_correct);
            if (existingCorrect) correct++;
            results.push({
                q: index + 1,
                word: String(question.word || '').toLowerCase(),
                recordId: sourceWordRecordId,
                your: existingAnswer,
                answer: correctAnswer,
                correct: existingCorrect,
                confidence: existing.answer_confidence || String(existing.submitted_answer || '').split('|')[1] || '',
            });
            continue;
        }
        const isCorrect = yourAnswer === correctAnswer;
        if (isCorrect) correct++;

        const recordTime = Number(now()) + index;
        const inserted = await dataSource.submitAssessment({
            username,
            word: question.word,
            sourceWordRecordId,
            testId,
            questionType: question.type || question.question_type,
            correctness: isCorrect ? 'correct' : 'wrong',
            yourAnswer,
            confidence: submitted.confidence,
            source: question.source || (question.cacheRecordId ? 'question_cache' : 'live_fallback'),
            recordTime,
            level: question.level,
            questionText: question.context || question.questionText || '',
            options: question.options || [],
            correctAnswer,
        });
        insertedAssessments.push(inserted);

        results.push({
            q: index + 1,
            word: String(question.word || '').toLowerCase(),
            recordId: sourceWordRecordId,
            your: yourAnswer,
            answer: correctAnswer,
            correct: isCorrect,
            confidence: submitted.confidence,
        });

        if (shouldUpdateMastery) {
            const assessmentRows = [...baseAssessmentRows, ...insertedAssessments];
            const existingAssessmentRecords = assessmentRows.map(row =>
                toFeishuAssessmentRecord(row, { username, sourceRecordIdByWordId })
            );
            const assessmentRecords = existingAssessmentRecords;
            const sameSpelling = wordRecords.filter(record =>
                String(record.fields?.Word || '').trim().toLowerCase() === String(question.word || '').trim().toLowerCase()
            );
            const recordIds = sameSpelling.map(record => record.record_id).filter(Boolean);
            if (recordIds.length) {
                const evaluation = evaluateWordMastery(recordIds, assessmentRecords, value =>
                    isCorrectAssessmentValue(value)
                );
                const meaningProgress = evaluation.meanings?.[sourceWordRecordId] || { stage: isCorrect ? 'consolidating' : 'recognized' };
                const nextStatus = evaluation.mastered ? 'mastered' : masteryStageToStatus(meaningProgress.stage);
                await dataSource.updateWordMastery(username, question.word, nextStatus, { sourceWordRecordId });
            }
        }

        if (question.cacheRecordId && typeof dataSource.incrementCacheUsedCount === 'function') {
            await dataSource.incrementCacheUsedCount(question.cacheRecordId);
        }
    }

    return buildSubmitResult({ testId, results, correct });
}

module.exports = {
    generateQuizWithDataSource,
    submitQuizWithDataSource,
    toFeishuWordRecord,
    toFeishuAssessmentRecord,
    toFeishuCacheRow,
};
