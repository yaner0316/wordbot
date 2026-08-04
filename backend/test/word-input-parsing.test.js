const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rnApp = fs.readFileSync(
    path.join(__dirname, '..', '..', 'WordBot', 'App.js'),
    'utf8'
);
const webAppPath = process.env.WORDBOT_WEB_APP_PATH
    || path.join(__dirname, '..', '..', '..', 'web', 'src', 'app.js');
const webApp = fs.readFileSync(webAppPath, 'utf8');

const rnWordSeparatorPattern = /split\(\/\[\\n,，;；\\s\]\+\//;

test('word entry accepts newline, comma, and semicolon separators in RN and Web', () => {
    assert.match(rnApp, rnWordSeparatorPattern);
    assert.match(webApp, /split\(\/\\n\+\//);
    assert.match(webApp, /flatMap\(line => line\.includes\('\|'\) \? \[line\] : line\.split\(\/\[,，;；\\s\]\+\//);
});