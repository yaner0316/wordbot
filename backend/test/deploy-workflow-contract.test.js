const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REQUIRED_ENV } = require('../runtime-health');

const repoRoot = path.join(__dirname, '..', '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'render-deploy.yml');
const backendLockPath = path.join(repoRoot, 'backend', 'package-lock.json');
const backendPackagePath = path.join(repoRoot, 'backend', 'package.json');
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
    for (const name of REQUIRED_ENV) assert.match(workflow, new RegExp(`${name}:`));
    assert.doesNotMatch(workflow, /FEISHU_[A-Z_]+:/);
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
test('backend test command disables flaky Node test-file isolation', () => {
    const packageJson = JSON.parse(fs.readFileSync(backendPackagePath, 'utf8'));

    assert.match(
        packageJson.scripts.test,
        /--test-isolation=none/,
        'GitHub Actions must avoid Node test-runner child-process serialization failures'
    );
});

test('deploy workflow does not use the retired frontend contract commit', () => {
    const workflow = fs.readFileSync(workflowPath, 'utf8');
    assert.doesNotMatch(workflow, /6a0e92415492f196953559cb1a15a9f74bed5a64/);
    assert.doesNotMatch(workflow, /d0f9988a9b27ee56797329809142ed2e7aa8292b/);
    assert.match(workflow, /446251d30ea5bc7265c1cd19f4e2904d03918e05/);
});

test('pull request tests cannot invoke the Render deployment hook', () => {
    const workflow = fs.readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n');

    assert.match(workflow, /pull_request:/);
    assert.match(workflow, /^  test:$/m);
    assert.match(workflow, /^  deploy:\n    needs: test\n    if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'$/m);
});

test('main deployment verifies the public backend release SHA after the deploy hook', () => {
    const workflow = fs.readFileSync(workflowPath, 'utf8');

    assert.match(workflow, /name: Check out deployment verification source/);
    assert.match(workflow, /name: Use Node\.js 24 for deployment verification/);
    assert.match(workflow, /verify-public-health-release\.js/);
    assert.match(workflow, /--health-url\s+https:\/\/wordbot-1-w9il\.onrender\.com\/api\/health/);
    assert.match(workflow, /--expected-commit\s+\$\{\{ github\.sha \}\}/);
    assert.match(workflow, /--attempts\s+40/);
    assert.match(workflow, /--interval-ms\s+15000/);
});
