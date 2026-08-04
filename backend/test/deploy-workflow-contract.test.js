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

    assert.match(workflow, /cache-dependency-path:\s*backend\/package-lock\.json/);
    assert.match(workflow, /working-directory:\s*backend/);
    assert.match(workflow, /run:\s*npm ci/);
    assert.equal(
        fs.existsSync(backendLockPath),
        true,
        'backend/package-lock.json must exist when the deploy workflow uses npm ci and npm caching'
    );
    assert.match(gitignore, /!backend\/package-lock\.json/);
});
