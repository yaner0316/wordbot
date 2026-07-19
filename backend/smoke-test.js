const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const { getUserByUsername, getWordsForUser, getAssessmentsForUser, getQuestionCache } = require('./supabase-data');
const { generateQuizWithDataSource } = require('./quiz-adapter');

const USERNAME = 'qiuqiu';
const LEVEL = '\u4e2d\u5b66';
const REQUIRED_OPTIONS = new Set(['A', 'B', 'C', 'D']);

function fail(message, details = {}) {
    console.log(JSON.stringify({ result: 'FAIL', message, details }, null, 2));
    process.exitCode = 1;
}

function pass(details = {}) {
    console.log(JSON.stringify({ result: 'PASS', details }, null, 2));
}

function questionAnswerOption(question) {
    if (REQUIRED_OPTIONS.has(question.correctAnswer)) return question.correctAnswer;
    if (REQUIRED_OPTIONS.has(question.answer)) return question.answer;
    return '';
}

function validateQuestion(question) {
    if (!question || typeof question !== 'object') return 'missing_question';
    if (!String(question.word || '').trim()) return 'missing_word';
    if (!Array.isArray(question.options) || question.options.length !== 4) return 'invalid_options';
    if (!REQUIRED_OPTIONS.has(questionAnswerOption(question))) return 'invalid_correct_answer';
    return null;
}

async function main() {
    const user = await getUserByUsername(USERNAME);
    if (!user) {
        fail('user_not_found', { username: USERNAME });
        return;
    }

    const [words, levelWords] = await Promise.all([
        getWordsForUser(USERNAME),
        getWordsForUser(USERNAME, LEVEL),
    ]);
    if (!words.length) {
        fail('no_words_for_user', { username: USERNAME, canonicalUsername: user.username });
        return;
    }

    const [assessments, cacheRows] = await Promise.all([
        getAssessmentsForUser(USERNAME),
        getQuestionCache(USERNAME, LEVEL, 'primary'),
    ]);

    const result = await generateQuizWithDataSource({
        username: USERNAME,
        level: LEVEL,
        limit: 10,
        roundType: 'primary',
        dataSource: {
            getUserByUsername,
            getWordsForUser,
            getAssessmentsForUser,
            getQuestionCache,
        },
    });

    if (result.error) {
        fail('quiz_generation_failed', {
            error: result.error,
            code: result.code,
            diagnostics: result.diagnostics,
            user: user.username,
            wordCount: words.length,
            levelWordCount: levelWords.length,
            assessmentCount: assessments.length,
            readyCacheCount: cacheRows.length,
        });
        return;
    }

    const question = result.questions?.[0] || result.question;
    const questionIssue = validateQuestion(question);
    if (questionIssue) {
        fail(questionIssue, { question, diagnostics: result.diagnostics });
        return;
    }

    const wordIds = new Set(words.map((word) => String(word.feishu_record_id || word.id || '').trim()).filter(Boolean));
    const questionRecordId = String(question.record_id || question.wordRecordId || '').trim();
    if (!wordIds.has(questionRecordId)) {
        fail('question_word_not_from_user_words', {
            questionWord: question.word,
            questionRecordId,
            sampleWordIds: [...wordIds].slice(0, 5),
        });
        return;
    }

    const masteredWordIds = new Set(
        words
            .filter((word) => word.mastery_status === 'mastered')
            .map((word) => String(word.feishu_record_id || word.id || '').trim())
            .filter(Boolean)
    );
    const selectedMastered = (result.questions || []).filter((item) =>
        masteredWordIds.has(String(item.record_id || item.wordRecordId || '').trim())
    );
    if (selectedMastered.length > 0) {
        fail('mastered_word_selected', {
            selectedMastered: selectedMastered.map((item) => ({
                recordId: item.record_id || item.wordRecordId,
                word: item.word,
            })),
        });
        return;
    }

    pass({
        user: user.username,
        level: LEVEL,
        wordCount: words.length,
        levelWordCount: levelWords.length,
        assessmentCount: assessments.length,
        readyCacheCount: cacheRows.length,
        returnedQuestionCount: result.questions.length,
        firstQuestion: {
            recordId: question.record_id,
            word: question.word,
            answer: questionAnswerOption(question),
            optionCount: question.options.length,
        },
        diagnostics: result.diagnostics,
    });
}

main().catch((error) => {
    fail('unhandled_error', {
        message: error.message,
        stack: error.stack,
    });
});
