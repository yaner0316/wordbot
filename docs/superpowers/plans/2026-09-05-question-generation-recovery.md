# Question Generation Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each durable generation job multiple independent candidate-building passes so a transient rejected candidate set does not leave the queue permanently unreplenished.

**Architecture:** The generation service already requires two distinct ready variants and records structured rejection reasons when it cannot obtain them. The default bootstrap currently configures only one generation pass, even though the runtime default supports three. Promote the bootstrap default to three configurable passes, preserving the existing two-variant quality threshold and durable retry behavior.

**Tech Stack:** Node.js, node:test, Supabase-backed durable question-generation jobs.

## Global Constraints

- Do not read or print environment values.
- Do not apply migrations, backfills, retries, cache wipes, data repairs, or mastery rewrites.
- Keep two distinct AI-approved primary variants mandatory.
- Keep failures fail-closed and preserve existing bounded rejection diagnostics.
- Work only in a fresh worktree from `origin/main` and deliver one focused PR.

---

### Task 1: Make the bootstrap use the runtime's safe retry budget

**Files:**
- Modify: `backend/question-generation-bootstrap.js`
- Modify: `backend/test/question-generation-bootstrap.test.js`

**Interfaces:**
- Consumes: `createQuestionGenerationRuntime({ maxGenerationAttempts })` from `backend/question-generation-runtime.js`.
- Produces: `DEFAULT_QUESTION_GENERATION_ATTEMPTS === 3` and passes that exact value from `createDefaultQuestionGenerationRuntime`.

- [ ] **Step 1: Write the failing regression test**

Add a test that stubs `createQuestionGenerationRuntime`, invokes
`createDefaultQuestionGenerationRuntime()`, and asserts:

```js
assert.equal(captured.maxGenerationAttempts, 3);
assert.equal(DEFAULT_QUESTION_GENERATION_ATTEMPTS, 3);
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test backend/test/question-generation-bootstrap.test.js`

Expected: FAIL because the current default is `1`.

- [ ] **Step 3: Implement the smallest configuration correction**

Change only this constant in `backend/question-generation-bootstrap.js`:

```js
const DEFAULT_QUESTION_GENERATION_ATTEMPTS = 3;
```

Do not change `requiredReadyCount`, job max attempts, or cache lifecycle logic.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `node --test backend/test/question-generation-bootstrap.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/question-generation-bootstrap.js backend/test/question-generation-bootstrap.test.js
git commit -m "fix: retry question variant generation"
```

### Task 2: Prove a second generation pass can recover without weakening quality

**Files:**
- Modify: `backend/test/question-generation-runtime.test.js`

**Interfaces:**
- Consumes: `createQuestionGenerationRuntime` and `createQuestionGenerationService` semantics.
- Produces: regression coverage that a first empty candidate pass followed by a valid two-variant pass completes the durable job.

- [ ] **Step 1: Write the failing recovery test**

Use a fake client/job store already established in the runtime test file. Configure
the candidate builder to return `[]` for `attempt === 1`, then return two
distinct, validation-ready candidates for `attempt === 2`. Assert:

```js
assert.equal(builderAttempts, 2);
assert.equal(summary.completed, 1);
assert.equal(summary.failed, 0);
assert.equal(published.length, 2);
```

- [ ] **Step 2: Run the focused test to verify it fails with one attempt**

Run: `node --test backend/test/question-generation-runtime.test.js`

Expected: the recovery case fails when configured with `maxGenerationAttempts: 1`.

- [ ] **Step 3: Configure the test with the bootstrap's new retry budget**

Use `maxGenerationAttempts: DEFAULT_QUESTION_GENERATION_ATTEMPTS` in the
bootstrap integration test, or explicitly `3` in the runtime behavior test.
Do not change runtime logic: it already repeats candidate building while it has
fewer than two ready variants.

- [ ] **Step 4: Run the focused suites**

Run: `node --test backend/test/question-generation-bootstrap.test.js backend/test/question-generation-runtime.test.js backend/test/question-generation-service.test.js backend/test/question-generation-worker.test.js`

Expected: PASS with the two-variant requirement still enforced.

- [ ] **Step 5: Commit**

```bash
git add backend/test/question-generation-runtime.test.js backend/test/question-generation-bootstrap.test.js
git commit -m "test: cover question generation recovery"
```

### Task 3: Review and release-gate the focused PR

**Files:**
- Review: `backend/question-generation-bootstrap.js`
- Review: `backend/test/question-generation-bootstrap.test.js`
- Review: `backend/test/question-generation-runtime.test.js`

- [ ] **Step 1: Review the staged diff**

Run: `git diff origin/main -- backend/question-generation-bootstrap.js backend/test/question-generation-bootstrap.test.js backend/test/question-generation-runtime.test.js`

Expected: only retry-budget configuration and regression coverage; no schema,
data, cache, mastery, or environment changes.

- [ ] **Step 2: Run backend verification**

Run: `npm test`

Expected: exit code `0`.

- [ ] **Step 3: Create one PR and verify deployment after merge**

Create a PR from the fresh branch. After GitHub Actions succeeds and it is
merged, verify the public health endpoint's release SHA matches the merged
commit and that the worker reports at least one post-deploy attempt. Do not
manually run queued jobs or modify queue rows.
