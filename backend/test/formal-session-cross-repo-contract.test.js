'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createApp } = require('../http-app');
const webContractPath = process.env.WORDBOT_WEB_CONTRACT_PATH
    || path.resolve(__dirname, '../../../web/src/quiz-logic.js');
const { inspectFormalQuizResponse } = require(webContractPath);

async function withServer(app, callback) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    try {
        await callback(`http://127.0.0.1:${server.address().port}`);
    } finally {
        await new Promise((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        });
    }
}

test('the real active-session HTTP DTO passes the production frontend formal gate unchanged', async () => {
    const questions = Array.from({ length: 10 }, (_, index) => ({
        type: 1,
        word: index < 2 ? 'bank' : `word-${index}`,
        wordRecordId: `meaning-${index}`,
        cacheRecordId: `cache-${index}`,
    }));
    const app = createApp({
        submitAnswers: async () => ({}),
        getActiveQuizSession: async () => ({
            test_id: 'real-student-cross-contract',
            questions,
            progress: { currentQuestion: 2, answers: ['A'] },
        }),
    });

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/quiz/session?user=student`);
        assert.equal(response.status, 200);
        const rawDto = await response.json();
        assert.deepEqual(inspectFormalQuizResponse(rawDto), {
            blocked: false,
            code: '',
            message: '',
        });
        assert.equal(rawDto.partialFormalChallenge, false);
        assert.equal(rawDto.diagnostics.finalQuestionCount, 10);
        assert.equal(new Set(rawDto.questions.map(question => question.wordRecordId)).size, 10);
    });
});
