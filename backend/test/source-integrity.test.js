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

test('live quiz generation prefers seven fill-in questions per ten-question quiz', () => {
    assert.ok(
        feishuSource.includes('const typeSlots = secureRandom([...Array(7).fill(1), ...Array(2).fill(2), ...Array(1).fill(3)], 10)'),
        'live quiz generation should prefer 7 fill-in, 2 English definition, and 1 translation question'
    );
});
test('live quiz generation tries fallback question types to fill ten questions', () => {
    assert.ok(
        feishuSource.includes('const fallbackTypeSlots = [1, 2, 3]'),
        'live quiz generation should retry alternate question types when the planned slot cannot build'
    );
    assert.ok(
        feishuSource.includes('for (const slot of [...typeSlots, ...fallbackTypeSlots])'),
        'fallback slots should run after the preferred question mix'
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

    assert.ok(rebuildSource.includes('QUESTION_CACHE_REBUILD_FLUSH_SIZE'));
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

test('question cache rebuild primary quota favors at least seven fill-in questions', () => {
    const start = feishuSource.indexOf('async function rebuildQuestionCacheForUser');
    const end = feishuSource.indexOf('async function validateWords');
    assert.ok(start >= 0 && end > start);
    const rebuildSource = feishuSource.slice(start, end);

    assert.ok(
        rebuildSource.includes('const PRIMARY_TYPE_QUOTA = [1,1,1,1,1,1,1,2,2,3];'),
        'primary cache rebuild should align with the 7/2/1 selection quota instead of rebuilding 6/3/1'
    );
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
