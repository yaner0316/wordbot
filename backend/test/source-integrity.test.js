const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const feishuSource = fs.readFileSync(path.join(__dirname, '..', 'feishu.js'), 'utf8');
const feishuLines = feishuSource.split(/\r?\n/);

test('feishu runtime constants are executable code, not hidden in comments', () => {
    assert.ok(
        feishuLines.some(line => line.trim() === 'const { STATUS_MASTERED, STATUS_PENDING } = STATUS;'),
        'STATUS_MASTERED/STATUS_PENDING must be declared as executable code'
    );
});

test('distractor pool statistics are declared before use', () => {
    assert.ok(
        feishuLines.some(line => line.trim() === 'let stats = { total: 0, hasCN: 0, hasDist3: 0, canType3: 0 };'),
        'getDistractorPool must declare stats before incrementing it'
    );
    assert.ok(
        feishuLines.some(line => line.includes('${stats.canType3}')),
        'getDistractorPool should log the computed canType3 count without referencing an undeclared stats variable'
    );
});

test('runtime console diagnostics stay concise', () => {
    const longDiagnostics = feishuLines
        .map((line, index) => ({ line, lineNumber: index + 1 }))
        .filter(({ line }) => /console\.(log|warn|error)/.test(line) && line.length > 500);

    assert.deepEqual(
        longDiagnostics.map(({ lineNumber }) => lineNumber),
        [],
        'Replace huge mojibake console diagnostics with short messages'
    );
});



test('runtime errors stay concise enough for HTTP responses', () => {
    const longErrors = feishuLines
        .map((line, index) => ({ line, lineNumber: index + 1 }))
        .filter(({ line }) => /throw new Error/.test(line) && line.length > 500);

    assert.deepEqual(
        longErrors.map(({ lineNumber }) => lineNumber),
        [],
        'Replace huge mojibake thrown errors with short operational messages'
    );
});


test('search record timeout is applied to each Feishu request', () => {
    assert.ok(
        feishuSource.includes('function request(method, path, body, token, timeoutOverrideMs)'),
        'Feishu request must allow a per-call timeout override'
    );
    assert.ok(
        feishuSource.includes("records/search`, body, token, timeout)"),
        'searchRecords must pass its timeout to the underlying Feishu request'
    );
});


test('Feishu request timeout is enforced as total wall time', () => {
    assert.ok(
        feishuSource.includes('totalTimer = setTimeout'),
        'request timeout must use an explicit wall-clock timer, not only socket idle timeout'
    );
});


test('learning settings are stored on the stats table, not word records', () => {
    const getStart = feishuSource.indexOf('async function getUserLearningSettings');
    const helperStart = feishuSource.indexOf('async function writeLearningSettingsRecord');
    const updateStart = feishuSource.indexOf('async function updateUserLearningSettings');
    const statusStart = feishuSource.indexOf('async function getQuestionCacheStatus');
    assert.ok(getStart >= 0 && helperStart > getStart && updateStart > helperStart && statusStart > updateStart);

    const getSettingsSource = feishuSource.slice(getStart, helperStart);
    const writeSettingsSource = feishuSource.slice(helperStart, updateStart);
    const updateSettingsSource = feishuSource.slice(updateStart, statusStart);

    assert.ok(getSettingsSource.includes('getRecords(STATS_TABLE)'));
    assert.ok(!getSettingsSource.includes('getRecords(WORD_TABLE)'));
    assert.ok(updateSettingsSource.includes('getRecords(STATS_TABLE)'));
    assert.ok(updateSettingsSource.includes('writeLearningSettingsRecord(userRecord, updateFields)'));
    assert.ok(writeSettingsSource.includes('updateRecord(STATS_TABLE'));
    assert.ok(writeSettingsSource.includes('addRecord(STATS_TABLE'));
    assert.ok(!updateSettingsSource.includes('updateRecord(WORD_TABLE'));
    assert.ok(!writeSettingsSource.includes('updateRecord(WORD_TABLE'));
});
test('learning settings use a short-lived overlay after write consistency gaps', () => {
    assert.ok(
        feishuSource.includes('const learningSettingsOverlay = createLearningSettingsOverlay'),
        'learning settings need a write-through overlay for immediate read-after-write consistency'
    );
    assert.ok(
        feishuSource.includes('return resolveLearningSettings(canonicalUserId, userRecord || null);'),
        'getUserLearningSettings should read through the overlay'
    );
    assert.ok(
        feishuSource.includes('learningSettingsOverlay.set(canonicalUserId, settings);'),
        'updateUserLearningSettings should publish saved settings to the overlay'
    );
    assert.ok(
        feishuSource.includes('change.unchanged && !userRecord && hasPendingSettings'),
        're-saving the just-saved level should not add a duplicate stats row while Feishu list is stale'
    );
});

test('table field listing stops on repeated page tokens', () => {
    const start = feishuSource.indexOf('async function listTableFields');
    const end = feishuSource.indexOf('async function createTableField');
    assert.ok(start >= 0 && end > start);
    const listFieldsSource = feishuSource.slice(start, end);

    assert.ok(
        listFieldsSource.includes('prevPageToken'),
        'field pagination must guard against repeated Feishu page tokens'
    );
    assert.ok(
        listFieldsSource.includes('pageToken === prevPageToken'),
        'field pagination should stop instead of looping forever on repeated page tokens'
    );
});

test('learning settings write does not block on field preparation before normal saves', () => {
    const helperStart = feishuSource.indexOf('async function writeLearningSettingsRecord');
    const updateStart = feishuSource.indexOf('async function updateUserLearningSettings');
    const statusStart = feishuSource.indexOf('async function getQuestionCacheStatus');
    assert.ok(helperStart >= 0 && updateStart > helperStart && statusStart > updateStart);

    const helperSource = feishuSource.slice(helperStart, updateStart);
    const updateSource = feishuSource.slice(updateStart, statusStart);

    assert.ok(
        helperSource.includes('FieldNameNotFound'),
        'learning settings should repair missing fields only after Feishu reports a missing field'
    );
    assert.ok(
        helperSource.includes('LEARNING_SETTINGS_WRITE_TIMEOUT_MS'),
        'learning settings writes need an explicit short timeout'
    );
    assert.ok(
        updateSource.includes('writeLearningSettingsRecord(userRecord, updateFields)'),
        'updateUserLearningSettings should delegate writes through the guarded writer'
    );
    assert.ok(
        !updateSource.includes('await ensureLearningSettingsFields();'),
        'normal learning settings saves must not scan table fields before writing'
    );
});

test('assessment record lookup uses quoted Feishu filter fields', () => {
    const start = feishuSource.indexOf('async function getUserAssessmentRecords');
    const end = feishuSource.indexOf('async function getRecentQuizFootprint');
    assert.ok(start >= 0 && end > start);
    const lookupSource = feishuSource.slice(start, end);

    assert.ok(lookupSource.includes("conjunction: 'and'"));
    assert.ok(lookupSource.includes("field_name: 'user'"));
    assert.ok(lookupSource.includes("operator: 'is'"));
    assert.ok(lookupSource.includes("field_name: 'test_time'"));
});

test('live quiz generation uses fill-in-only slots for elementary level and mixed slots otherwise', () => {
    assert.ok(
        feishuSource.includes('const typeSlots = isElementaryCacheLevel(effectiveLevel)'),
        'live quiz generation should branch by learning level'
    );
    assert.ok(
        feishuSource.includes('? Array(10).fill(1)'),
        'elementary live fallback should use only fill-in questions'
    );
    assert.ok(
        feishuSource.includes(': secureRandom([...Array(7).fill(1), ...Array(2).fill(2), ...Array(1).fill(3)], 10)'),
        'non-elementary live fallback should keep 7 fill-in, 2 English definition, and 1 translation question'
    );
});
test('live quiz generation tries level-appropriate fallback question types to fill ten questions', () => {
    assert.ok(
        feishuSource.includes('const fallbackTypeSlots = isElementaryCacheLevel(effectiveLevel) ? [1] : [1, 2, 3]'),
        'elementary fallback should not retry English definition or Chinese selection types'
    );
    assert.ok(
        feishuSource.includes('for (const slot of [...typeSlots, ...fallbackTypeSlots])'),
        'fallback slots should run after the preferred question mix'
    );
    assert.ok(
        feishuSource.includes('Number(question.type) !== 1'),
        'elementary live fallback should reject non-fill-in questions as a final guard'
    );
});
test('batch word translation keeps partial results and falls back only missing words', () => {
    const start = feishuSource.indexOf('async function translateWordsToCN');
    const end = feishuSource.indexOf('async function fetchWordDefinition');
    assert.ok(start >= 0 && end > start);
    const translateSource = feishuSource.slice(start, end);

    assert.ok(
        translateSource.includes('const missingWords = words.filter(word => !translations[word]);'),
        'partial batch translations should be reused instead of discarded'
    );
    assert.ok(
        !translateSource.includes('if (Object.keys(translations).length === words.length) return translations;'),
        'incomplete batch translations must not trigger fallback for every word'
    );
});

test('question cache rebuild only uses meaningful Chinese meanings for type 3', () => {
    const start = feishuSource.indexOf('async function rebuildQuestionCacheForUser');
    const end = feishuSource.indexOf('async function validateWords');
    assert.ok(start >= 0 && end > start);
    const rebuildSource = feishuSource.slice(start, end);

    assert.ok(
        rebuildSource.includes('hasMeaningfulChineseMeaning('),
        'cache rebuild should not treat AI meta-responses or English text as usable Chinese meanings'
    );
    assert.ok(
        !rebuildSource.includes('info.CN_Meaning?.trim()'),
        'cache rebuild should not use a plain trim check for Chinese meanings'
    );
});

test('question cache rebuild enriches type-one contextual meanings before option meanings', () => {
    const start = feishuSource.indexOf('async function rebuildQuestionCacheForUser');
    const end = feishuSource.indexOf('async function validateWords');
    assert.ok(start >= 0 && end > start);
    const rebuildSource = feishuSource.slice(start, end);
    const contextMeaningIndex = rebuildSource.indexOf('enrichContextualCorrectMeanings');
    const optionMeaningIndex = rebuildSource.indexOf('enrichQuestionOptionMeanings');
    const cacheWriteIndex = rebuildSource.indexOf('appendReadyCacheRows');

    assert.ok(contextMeaningIndex >= 0, 'cache rebuild should enrich type-one contextual meanings');
    assert.ok(optionMeaningIndex > contextMeaningIndex, 'option meanings should use contextual correct meanings');
    assert.ok(cacheWriteIndex > contextMeaningIndex, 'cache rows should store contextual correct meanings');
});

test('question cache rebuild writes ready rows incrementally before the full rebuild finishes', () => {
    const start = feishuSource.indexOf('async function rebuildQuestionCacheForUser');
    const end = feishuSource.indexOf('async function validateWords');
    assert.ok(start >= 0 && end > start);
    const rebuildSource = feishuSource.slice(start, end);

    assert.ok(rebuildSource.includes('const QUESTION_CACHE_REBUILD_FLUSH_SIZE = 1;'));
    assert.ok(rebuildSource.includes('flushQuestionCacheRows'));
    assert.ok(rebuildSource.includes('await flushQuestionCacheRows(bufferedRows, writtenRows);'));
    assert.ok(!rebuildSource.includes('await addQuestionCacheRecords(rows);'));
});

test('quiz assessment rows persist level and source trace fields', () => {
    const cacheStart = feishuSource.indexOf('if (cachedQuestions.length >= 10)');
    const cacheEnd = feishuSource.indexOf("markTiming('question-cache-hit')");
    const liveStart = feishuSource.indexOf('const testRows = randomizedQuestions.map');
    const liveEnd = feishuSource.indexOf('quizRecordWrites.stage');
    assert.ok(cacheStart >= 0 && cacheEnd > cacheStart);
    assert.ok(liveStart >= 0 && liveEnd > liveStart);

    const cacheWriteSource = feishuSource.slice(cacheStart, cacheEnd);
    const liveWriteSource = feishuSource.slice(liveStart, liveEnd);

    assert.ok(cacheWriteSource.includes('level: effectiveLevel'));
    assert.ok(cacheWriteSource.includes("source: 'question_cache'"));
    assert.ok(liveWriteSource.includes('level: effectiveLevel'));
    assert.ok(liveWriteSource.includes("source: 'live_fallback'"));
});

test('quiz response keeps difficultyApplied for frontend guards', () => {
    const cacheReturnStart = feishuSource.indexOf("source: 'question_cache'");
    const cacheReturnEnd = feishuSource.indexOf('questions: randomizedQuestions.map', cacheReturnStart);
    const liveReturnStart = feishuSource.indexOf('return {', feishuSource.indexOf("markTiming('test-record-write-staged')"));
    const liveReturnEnd = feishuSource.indexOf('questions: randomizedQuestions.map', liveReturnStart);
    assert.ok(cacheReturnStart >= 0 && cacheReturnEnd > cacheReturnStart);
    assert.ok(liveReturnStart >= 0 && liveReturnEnd > liveReturnStart);

    assert.ok(feishuSource.slice(cacheReturnStart, cacheReturnEnd).includes('difficultyApplied: true'));
    assert.ok(feishuSource.slice(liveReturnStart, liveReturnEnd).includes('difficultyApplied'));
});

test('question cache usage writes text timestamp for Feishu text field', () => {
    const markStart = feishuSource.indexOf('async function markQuestionCacheUsed');
    const markEnd = feishuSource.indexOf('async function updateRecord', markStart);
    assert.ok(markStart >= 0 && markEnd > markStart);

    const markSource = feishuSource.slice(markStart, markEnd);
    assert.ok(!markSource.includes('last_used_at: Date.now()'));
    assert.ok(markSource.includes('last_used_at: String(Date.now())'));
});
test('quiz cache diagnostics include Feishu write latencies', () => {
    assert.ok(feishuSource.includes('testRecordWriteLatencyMs'));
    assert.ok(feishuSource.includes('cacheUsageWriteLatencyMs'));
    assert.ok(feishuSource.includes('const testRecordWriteStarted = Date.now()'));
    assert.ok(feishuSource.includes('cacheUsageWriteScheduled'));
    assert.ok(!feishuSource.includes('const cacheUsageWriteStarted = Date.now()'));
});

test('question cache usage marking runs after response is prepared', () => {
    const cacheStart = feishuSource.indexOf('if (cachedQuestions.length >= 10)');
    const cacheEnd = feishuSource.indexOf('questions: randomizedQuestions.map', cacheStart);
    assert.ok(cacheStart >= 0 && cacheEnd > cacheStart);
    const cacheHitSource = feishuSource.slice(cacheStart, cacheEnd);

    assert.ok(cacheHitSource.includes('markQuestionCacheUsed(randomizedQuestions.map(q => q.cacheRecordId))'));
    assert.ok(!cacheHitSource.includes('await markQuestionCacheUsed(randomizedQuestions.map(q => q.cacheRecordId))'));
    assert.ok(cacheHitSource.includes('cacheUsageWriteScheduled'));
});
test('question cache rebuild selects pending meanings from mastery evidence instead of legacy Status', () => {
    const pendingStart = feishuSource.indexOf('async function getPendingWords');
    const assessmentStart = feishuSource.indexOf('async function getUserAssessmentRecords');
    const rebuildStart = feishuSource.indexOf('async function rebuildQuestionCacheForUser');
    const validateStart = feishuSource.indexOf('async function validateWords');
    assert.ok(pendingStart >= 0 && assessmentStart > pendingStart, 'getPendingWords should exist before assessment helpers');
    assert.ok(rebuildStart >= 0 && validateStart > rebuildStart, 'rebuildQuestionCacheForUser should exist');

    const pendingSource = feishuSource.slice(pendingStart, assessmentStart);
    const rebuildSource = feishuSource.slice(rebuildStart, validateStart);

    assert.ok(pendingSource.includes('submittedRecords'), 'getPendingWords should receive submitted assessment records');
    assert.ok(pendingSource.includes('evaluateWordMastery'), 'pending meanings should be based on mastery evidence');
    assert.ok(pendingSource.includes('!meaningProgress?.mastered'), 'only unmastered meaning records should enter rebuild');
    assert.ok(!pendingSource.includes('!isMasteredStatus(r.fields.Status)'), 'legacy Status must not control cache rebuild eligibility');
    assert.ok(rebuildSource.includes('getUserAssessmentRecords(userId)'), 'rebuild should load user assessment evidence');
    assert.ok(rebuildSource.includes('getPendingWords(userId, wordRecords, submittedRecords)'), 'rebuild should pass evidence into pending selection');
});

test('question cache rebuild uses elementary fill-in-only quota and non-elementary 7/2/1 quota', () => {
    const start = feishuSource.indexOf('async function rebuildQuestionCacheForUser');
    const end = feishuSource.indexOf('async function validateWords');
    assert.ok(start >= 0 && end > start);
    const rebuildSource = feishuSource.slice(start, end);

    assert.ok(
        rebuildSource.includes('isElementaryCacheLevel(level) ? [1,1,1,1,1,1,1,1,1,1] : [1,1,1,1,1,1,1,2,2,3]'),
        'primary cache rebuild should use all fill-in for elementary and 7/2/1 for other levels'
    );
    assert.ok(rebuildSource.includes('isElementaryCacheLevel(level) ? { 1: 10, 2: 0, 3: 0 } : { 1: 7, 2: 2, 3: 1 }'));
    assert.ok(!rebuildSource.includes('const PRIMARY_TYPE_QUOTA = [1,1,1,1,1,1,2,2,2,3];'));
});

test('question cache rebuild generates natural fill-in contexts before downgrading to definition questions', () => {
    const start = feishuSource.indexOf('async function rebuildQuestionCacheForUser');
    const end = feishuSource.indexOf('async function validateWords');
    assert.ok(start >= 0 && end > start);
    const rebuildSource = feishuSource.slice(start, end);

    assert.ok(feishuSource.includes('async function generateNaturalFillInContext'));
    assert.ok(rebuildSource.includes('preferred === 1 && (!isContextUsableForWord'));
    assert.ok(rebuildSource.includes('|| isElementaryCacheLevel(level)'));
    assert.ok(rebuildSource.includes('await generateNaturalFillInContext'));
    assert.ok(rebuildSource.includes('contextEnhancedInfo'));
    assert.ok(rebuildSource.includes('isContextUsableForWord(contextEnhancedInfo.word, contextEnhancedInfo.context)'));
});



test('natural fill-in generation passes explicit level guidance for elementary prompts', () => {
    const start = feishuSource.indexOf('async function generateNaturalFillInContext');
    const end = feishuSource.indexOf('async function generateContextMeaning');
    assert.ok(start >= 0 && end > start);
    const generatorSource = feishuSource.slice(start, end);

    assert.ok(generatorSource.includes('level ='));
    assert.ok(generatorSource.includes('Daily life, school, family, park, playground'));
    assert.ok(generatorSource.includes('No politics, history, academic topics, adult work, idioms'));
    assert.ok(generatorSource.includes('6 to 8 year old child'));

    const rebuildStart = feishuSource.indexOf('async function rebuildQuestionCacheForUser');
    const rebuildEnd = feishuSource.indexOf('async function validateWords');
    const rebuildSource = feishuSource.slice(rebuildStart, rebuildEnd);
    assert.ok(rebuildSource.includes('level') && rebuildSource.includes('await generateNaturalFillInContext'));
});

test('question cache rebuild prioritizes Chinese meaning when generating elementary fill-in contexts', () => {
    const start = feishuSource.indexOf('async function rebuildQuestionCacheForUser');
    const end = feishuSource.indexOf('async function validateWords');
    assert.ok(start >= 0 && end > start);
    const rebuildSource = feishuSource.slice(start, end);

    assert.ok(
        rebuildSource.includes('contextEnhancedInfo.CN_Meaning || contextEnhancedInfo.meaning'),
        'natural fill-in generation should use CN_Meaning before broad English Meaning to keep the intended sense'
    );
});

test('question cache rebuild retries elementary fill-in contexts rejected by quality gates', () => {
    const start = feishuSource.indexOf('async function rebuildQuestionCacheForUser');
    const end = feishuSource.indexOf('async function validateWords');
    assert.ok(start >= 0 && end > start);
    const rebuildSource = feishuSource.slice(start, end);

    assert.ok(feishuSource.includes('getQuestionQualityIssues'));
    assert.ok(feishuSource.includes('function retryElementaryFillInContext'));
    assert.ok(feishuSource.includes('sense_mismatch'));
    assert.ok(feishuSource.includes('not_elementary_context'));
    assert.ok(rebuildSource.includes('retryElementaryFillInContext(primaryQuestion)'));
});


test('question cache append writes each ready row independently', () => {
    const start = feishuSource.indexOf('function appendReadyCacheRows');
    const end = feishuSource.indexOf('async function rebuildQuestionCacheForUser', start);
    assert.ok(start >= 0 && end > start);
    const appendSource = feishuSource.slice(start, end);

    assert.ok(appendSource.includes('for (const row of candidateRows)'));
    assert.ok(appendSource.includes('rows.push(row)'));
    assert.ok(!appendSource.includes('primaryIssues.length === 0 && reviewIssues.length === 0'));
});

test('question cache rebuild retries alternate primary types when preferred type cannot be built', () => {
    const start = feishuSource.indexOf('async function rebuildQuestionCacheForUser');
    const end = feishuSource.indexOf('async function validateWords');
    assert.ok(start >= 0 && end > start);
    const rebuildSource = feishuSource.slice(start, end);

    assert.ok(rebuildSource.includes('for (const alternateType of availableTypes.filter'));
    assert.ok(rebuildSource.includes('primaryQuestion = buildQuizQuestion'));
    assert.ok(rebuildSource.includes('if (primaryQuestion) primaryQuestion.level = level'));
});
test('quiz submit returns the score before post-submit learning updates', () => {
    const settleStart = feishuSource.indexOf('async function settleAnswers');
    const loadStart = feishuSource.indexOf('async function loadQuizRecords', settleStart);
    assert.ok(settleStart >= 0 && loadStart > settleStart, 'settleAnswers should exist before loadQuizRecords');
    const settleSource = feishuSource.slice(settleStart, loadStart);

    const resultBuild = settleSource.indexOf('const submitResult = buildSubmitResult');
    const backgroundSchedule = settleSource.indexOf('schedulePostSubmitLearningUpdate');
    const returnResult = settleSource.indexOf('return submitResult');
    const wordTableRead = settleSource.indexOf('getRecords(WORD_TABLE)');

    assert.ok(resultBuild >= 0, 'settleAnswers should build the response before background work');
    assert.ok(backgroundSchedule > resultBuild, 'post-submit learning update should be scheduled after score is known');
    assert.ok(returnResult > backgroundSchedule, 'settleAnswers should return the prebuilt score result');
    assert.ok(wordTableRead === -1 || returnResult < wordTableRead, 'word table reads must not block the submit response');
    assert.ok(!settleSource.includes('await schedulePostSubmitLearningUpdate'), 'background learning update must not be awaited');
});
test('post-submit learning update does not write derived stats table fields', () => {
    const updateStart = feishuSource.indexOf('async function applyPostSubmitLearningUpdate');
    const settleStart = feishuSource.indexOf('async function settleAnswers', updateStart);
    assert.ok(updateStart >= 0 && settleStart > updateStart, 'applyPostSubmitLearningUpdate should exist before settleAnswers');
    const updateSource = feishuSource.slice(updateStart, settleStart);

    assert.doesNotMatch(updateSource, /mastered_words|pending_words|total_words|total_tests|correct_count/);
    assert.doesNotMatch(updateSource, /updateRecord\(STATS_TABLE/);
    assert.doesNotMatch(updateSource, /addRecord\(STATS_TABLE/);
});
