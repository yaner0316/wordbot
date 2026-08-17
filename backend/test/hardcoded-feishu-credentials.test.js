const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const LEGACY_SCRIPTS = [
    'add_cn_field.js',
    'add_field.js',
    'add_test_words.js',
    'check_cn.js',
    'check_fields.js',
    'fetch_quality_examples.js',
    'fill_contexts.js',
    'fill_distractors.js',
    'fill_meanings.js',
    'generate_distractors.js',
    'get_field.js',
    'merge_distractors.js',
    'test_accept.js',
    'translate_cn.js',
];

test('legacy Feishu scripts read the app secret only from the environment and fail closed', () => {
    for (const filename of LEGACY_SCRIPTS) {
        const source = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');

        assert.ok(
            /const APP_SECRET = process\.env\.FEISHU_APP_SECRET;/.test(source),
            `${filename} must read FEISHU_APP_SECRET without a fallback`,
        );
        assert.ok(
            !/(?:APP_SECRET|FEISHU_APP_SECRET)\s*=\s*['"`]/.test(source),
            `${filename} must not contain a literal Feishu app secret`,
        );
        assert.ok(
            /if\s*\(\s*!APP_SECRET\s*\)\s*\{?\s*throw new Error\(['"]FEISHU_APP_SECRET is required['"]\);?\s*\}?/.test(source),
            `${filename} must stop before making requests when the secret is missing`,
        );
    }
});
