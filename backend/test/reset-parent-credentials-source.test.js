'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'reset-parent-credentials.js'), 'utf8');

test('parent credential reset follows the configured data source without a direct Feishu import', () => {
    assert.match(source, /require\(['\"]\.\/data-source['\"]\)/);
    assert.doesNotMatch(source, /require\(['\"]\.\/feishu['\"]\)/);
    assert.doesNotMatch(source, /No Feishu records/);
});
