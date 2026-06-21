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
