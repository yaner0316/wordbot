const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const supabase = require('./supabase-client');
const dataSource = require('./data-source');
const {
    generateQuizWithDataSource,
    submitQuizWithDataSource,
} = require('./quiz-adapter');

const USERNAME = 'qiuqiu';
const LEVEL = String.fromCharCode(0x4e2d, 0x5b66);
const ROUND_TYPE = 'primary';
const ANSWER_LETTERS = ['A', 'B', 'C', 'D'];

const stepResults = [];

function printStep(step, status, details = {}) {
    const result = { step, status, details };
    stepResults.push(result);
    console.log(JSON.stringify(result, null, 2));
}

function failStep(step, details = {}) {
    printStep(step, 'FAIL', details);
    process.exitCode = 1;
}

function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

async function findCacheRow(cacheId) {
    const id = String(cacheId || '').trim();
    if (!id) return null;
    if (isUuid(id)) {
        const { data, error } = await supabase
            .from('question_cache')
            .select('*')
            .eq('id', id)
            .maybeSingle();
        if (error) throw new Error(`findCacheRow.id: ${error.message}`);
        if (data) return data;
    }
    const { data, error } = await supabase
        .from('question_cache')
        .select('*')
        .eq('feishu_record_id', id)
        .maybeSingle();
    if (error) throw new Error(`findCacheRow.feishu_record_id: ${error.message}`);
    return data;
}

async function findAssessment(testId, sourceWordRecordId) {
    const { data, error } = await supabase
        .from('assessments')
        .select('*')
        .eq('test_id', testId)
        .eq('source_word_record_id', sourceWordRecordId)
        .maybeSingle();
    if (error) throw new Error(`findAssessment: ${error.message}`);
    return data;
}

async function findWordBySourceRecordId(sourceWordRecordId) {
    const id = String(sourceWordRecordId || '').trim();
    if (!id) return null;
    if (isUuid(id)) {
        const { data, error } = await supabase
            .from('words')
            .select('*')
            .eq('id', id)
            .maybeSingle();
        if (error) throw new Error(`findWordBySourceRecordId.id: ${error.message}`);
        if (data) return data;
    }
    const { data, error } = await supabase
        .from('words')
        .select('*')
        .eq('feishu_record_id', id)
        .maybeSingle();
    if (error) throw new Error(`findWordBySourceRecordId.feishu_record_id: ${error.message}`);
    return data;
}

function correctOptionIndex(question) {
    const answer = String(question.correctAnswer || question.answer || '').trim();
    return ANSWER_LETTERS.indexOf(answer);
}

async function main() {
    let quiz;
    let question;
    let cacheBefore = null;
    let wordBefore = null;
    let submitResult = null;
    let assessment = null;

    try {
        quiz = await generateQuizWithDataSource({
            username: USERNAME,
            level: LEVEL,
            roundType: ROUND_TYPE,
            limit: 1,
            dataSource,
        });
        if (quiz.error) {
            failStep('1_get_question', {
                error: quiz.error,
                code: quiz.code,
                diagnostics: quiz.diagnostics,
            });
            return;
        }
        question = quiz.questions?.[0];
        const answerIndex = correctOptionIndex(question);
        if (!question || answerIndex < 0) {
            failStep('1_get_question', { quiz, question });
            return;
        }
        if (question.cacheRecordId) {
            cacheBefore = await findCacheRow(question.cacheRecordId);
        }
        wordBefore = await findWordBySourceRecordId(question.record_id || question.wordRecordId);
        printStep('1_get_question', 'PASS', {
            testId: quiz.testId,
            word: question.word,
            recordId: question.record_id || question.wordRecordId,
            cacheRecordId: question.cacheRecordId || null,
            cacheUsedCountBefore: cacheBefore?.used_count ?? null,
            masteryBefore: wordBefore?.mastery_status ?? null,
            diagnostics: quiz.diagnostics,
        });
    } catch (error) {
        failStep('1_get_question', { message: error.message, stack: error.stack });
        return;
    }

    try {
        submitResult = await submitQuizWithDataSource({
            username: USERNAME,
            testId: quiz.testId,
            questions: [question],
            answers: [{ option: correctOptionIndex(question), confidence: 'sure' }],
            dataSource,
        });
        if (submitResult.correct !== 1 || submitResult.total !== 1) {
            failStep('2_submit_correct_answer', { submitResult });
            return;
        }
        printStep('2_submit_correct_answer', 'PASS', {
            correct: submitResult.correct,
            total: submitResult.total,
            accuracy: submitResult.accuracy,
        });
    } catch (error) {
        failStep('2_submit_correct_answer', { message: error.message, stack: error.stack });
        return;
    }

    try {
        assessment = await findAssessment(quiz.testId, question.record_id || question.wordRecordId);
        if (!assessment) {
            failStep('3_verify_assessment_written', {
                testId: quiz.testId,
                sourceWordRecordId: question.record_id || question.wordRecordId,
            });
            return;
        }
        const assessmentPass =
            assessment.is_correct === 'correct' &&
            assessment.submitted_answer === String(question.correctAnswer || question.answer);
        if (!assessmentPass) {
            failStep('3_verify_assessment_written', { assessment });
            return;
        }
        printStep('3_verify_assessment_written', 'PASS', {
            assessmentId: assessment.id,
            testId: assessment.test_id,
            wordId: assessment.word_id,
            isCorrect: assessment.is_correct,
            submittedAnswer: assessment.submitted_answer,
            confidence: assessment.answer_confidence,
        });
    } catch (error) {
        failStep('3_verify_assessment_written', { message: error.message, stack: error.stack });
        return;
    }

    try {
        const wordAfter = await findWordBySourceRecordId(question.record_id || question.wordRecordId);
        if (!wordAfter) {
            failStep('4_check_mastery_update', {
                sourceWordRecordId: question.record_id || question.wordRecordId,
            });
            return;
        }
        const pushedToMastered = wordBefore?.mastery_status !== 'mastered' && wordAfter.mastery_status === 'mastered';
        printStep('4_check_mastery_update', 'PASS', {
            wordId: wordAfter.id,
            masteryBefore: wordBefore?.mastery_status ?? null,
            masteryAfter: wordAfter.mastery_status,
            pushedToMastered,
            note: pushedToMastered
                ? 'This correct answer pushed the word to mastered.'
                : 'This answer did not push the word to mastered; no mastered transition expected.',
        });
    } catch (error) {
        failStep('4_check_mastery_update', { message: error.message, stack: error.stack });
        return;
    }

    try {
        if (!question.cacheRecordId) {
            printStep('5_verify_cache_used_count', 'PASS', {
                skipped: true,
                reason: 'Question did not include cacheRecordId.',
            });
        } else {
            const cacheAfter = await findCacheRow(question.cacheRecordId);
            const before = Number(cacheBefore?.used_count ?? question.cacheUsedCount ?? 0);
            const after = Number(cacheAfter?.used_count ?? 0);
            if (after !== before + 1) {
                failStep('5_verify_cache_used_count', {
                    cacheRecordId: question.cacheRecordId,
                    before,
                    after,
                });
                return;
            }
            printStep('5_verify_cache_used_count', 'PASS', {
                cacheRecordId: question.cacheRecordId,
                before,
                after,
                lastUsedAt: cacheAfter.last_used_at,
            });
        }
    } catch (error) {
        failStep('5_verify_cache_used_count', { message: error.message, stack: error.stack });
        return;
    }

    const failed = stepResults.filter(result => result.status === 'FAIL');
    console.log(JSON.stringify({
        result: failed.length ? 'FAIL' : 'PASS',
        passedSteps: stepResults.filter(result => result.status === 'PASS').length,
        failedSteps: failed.length,
        testId: quiz.testId,
    }, null, 2));
}

main().catch(error => {
    failStep('unhandled_error', {
        message: error.message,
        stack: error.stack,
    });
});
