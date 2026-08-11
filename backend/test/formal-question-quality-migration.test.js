const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('formal question quality migration installs a fail-closed write trigger', () => {
    const file = path.join(__dirname, '..', 'migrations', '20260811_formal_question_quality_gate.sql');
    const sql = fs.readFileSync(file, 'utf8');
    assert.match(sql, /question_fingerprint/);
    assert.match(sql, /duplicate_option_meanings/);
    assert.match(sql, /create trigger validate_formal_challenge_question_quality/i);
});
