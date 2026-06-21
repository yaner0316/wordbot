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
        feishuSource.includes('return resolveLearningSettings(userId, userRecord || null);'),
        'getUserLearningSettings should read through the overlay'
    );
    assert.ok(
        feishuSource.includes('learningSettingsOverlay.set(userId, settings);'),
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
