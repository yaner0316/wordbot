const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..', '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'render-deploy.yml');
const backendLockPath = path.join(repoRoot, 'backend', 'package-lock.json');
const gitignorePath = path.join(repoRoot, '.gitignore');

test('deploy workflow keeps the backend npm lockfile available for cache and npm ci', () => {
    const workflow = fs.readFileSync(workflowPath, 'utf8');
    const gitignore = fs.readFileSync(gitignorePath, 'utf8');

    assert.match(workflow, /node-version:\s*24/);
    assert.match(workflow, /cache-dependency-path:\s*backend\/package-lock\.json/);
    assert.match(workflow, /working-directory:\s*backend/);
    assert.match(workflow, /run:\s*npm ci/);
    assert.match(workflow, /SUPABASE_URL:\s*https:\/\/wordbot-ci\.invalid/);
    assert.match(workflow, /SUPABASE_SERVICE_ROLE_KEY:\s*wordbot-ci-service-role/);
    assert.match(workflow, /WORDBOT_WEB_CONTRACT_PATH:.*web-contract\/src\/quiz-logic\.js/);
    assert.match(workflow, /WORDBOT_WEB_APP_PATH:.*web-contract\/src\/app\.js/);
    assert.equal(
        fs.existsSync(backendLockPath),
        true,
        'backend/package-lock.json must exist when the deploy workflow uses npm ci and npm caching'
    );
    assert.match(gitignore, /!backend\/package-lock\.json/);
});

test('cross-repository word input contract uses the workflow-provided Web path', () => {
    const source = fs.readFileSync(
        path.join(repoRoot, 'backend', 'test', 'word-input-parsing.test.js'),
        'utf8'
    );

    assert.match(
        source,
        /process\.env\.WORDBOT_WEB_APP_PATH/,
        'word input contract must not depend only on a sibling checkout existing locally'
    );
});
