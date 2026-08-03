# WordBot Meaning Cache and Quiz Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every newly entered meaning durably produce at least two quality-approved cached questions before it becomes quiz-eligible, while enforcing meaning-level cooldown, daily exclusion, and mastery rules.

**Architecture:** Persist one generation job per `words.id`, process jobs with a lease-based worker, and publish questions only after shared quality validation. Formal quiz selection consumes ready cache rows by `word_id`; mastery is calculated by one authoritative service over submitted formal assessments.

**Tech Stack:** Node.js 22+, Express, `node:test`, Supabase/Postgres, vanilla JavaScript frontend.

## Global Constraints

- The learning identity is `user_id + word_id`; never exclude or deduplicate solely by normalized English spelling.
- Cache generation starts immediately after input; formal quiz eligibility starts exactly 18 hours after `entered_at`.
- Missing or invalid timestamps fail closed.
- Each meaning has at least two ready primary variants with distinct question fingerprints.
- Learning days use `Asia/Shanghai`.
- Two correct formal assessments on different learning days establish mastery only when no intervening wrong formal assessment exists.
- A correct assessment excludes only that `word_id` for the rest of the learning day.
- No live-generation fallback may bypass cache quality or cooldown gates.
- Production schema changes are additive, idempotent, RLS-enabled, and explicitly granted only to `service_role`.

---

### Task 1: Lock the product contract with failing tests

**Files:**
- Modify: `backend/test/supabase-data.test.js`
- Modify: `backend/test/data-source.test.js`
- Modify: `backend/test/quiz-adapter.test.js`
- Modify: `backend/test/quiz-word-queue.test.js`
- Modify: `backend/test/mastery-service.test.js`
- Create: `backend/test/word-entry-cache-contract.test.js`

**Interfaces:**
- Consumes: existing `createSupabaseDataAdapter`, `generateQuizWithDataSource`, queue and mastery APIs.
- Produces: executable acceptance contract for Tasks 2-5.

- [ ] Add a failing integration test that enters one meaning and expects a persisted generation job instead of merely observing a rebuild callback.
- [ ] Add a failing worker test expecting two ready rows with different normalized question fingerprints for one `word_id`.
- [ ] Correct the misleading “creates two variants” test so it asserts `count === 2` and `rows.length === 2`.
- [ ] Add boundary tests proving `17:59:59` is excluded, `18:00:00` is eligible, and a missing timestamp is excluded.
- [ ] Add queue tests with two `bank` rows: answering `bank（银行）` correctly excludes only its `word_id`, while `bank（河岸）` remains eligible in the same or later 10-question batch.
- [ ] Add mastery tests for Monday-correct/Thursday-correct, Monday-correct/Tuesday-wrong/Wednesday-correct, and same-day duplicate correct answers.
- [ ] Run each focused test and record the expected failures before production changes: `node --test test/word-entry-cache-contract.test.js test/quiz-word-queue.test.js test/mastery-service.test.js`.
- [ ] Commit tests with `test: lock meaning-level quiz cache contract`.

### Task 2: Add durable generation job storage

**Files:**
- Create: `backend/migrations/20260803_question_generation_jobs.sql`
- Create: `backend/question-generation-job.js`
- Create: `backend/test/question-generation-job.test.js`
- Modify: `backend/supabase-data.js`
- Modify: `backend/test/supabase-data.test.js`

**Interfaces:**
- Produces: `enqueueQuestionGeneration({ userId, wordId, reason })`, `claimQuestionGenerationJobs({ workerId, limit, now })`, `completeQuestionGeneration(...)`, and `failQuestionGeneration(...)`.
- Consumes: Supabase client and existing `users`, `words`, and `question_cache` tables.

- [ ] Write failing pure-state tests for enqueue idempotency, lease recovery, retry backoff, ready completion, and manual-review transition.
- [ ] Run `node --test test/question-generation-job.test.js` and verify failures are caused by the missing module.
- [ ] Implement the pure job state machine without database access.
- [ ] Add an additive migration for `question_generation_jobs`, required indexes, RLS, and explicit `service_role` grants; do not grant `anon` or `authenticated`.
- [ ] Add Supabase repository methods that filter every query by `user_id` or claimed job IDs.
- [ ] Re-run focused tests and Supabase fake-client tests until green.
- [ ] Commit with `feat: persist question generation jobs`.

### Task 3: Generate and repair two quality-approved variants per meaning

**Files:**
- Create: `backend/question-generation-service.js`
- Create: `backend/question-generation-worker.js`
- Create: `backend/test/question-generation-service.test.js`
- Create: `backend/test/question-generation-worker.test.js`
- Modify: `backend/question-quality.js`
- Modify: `backend/question-cache.js`
- Modify: `backend/supabase-data.js`

**Interfaces:**
- Consumes: claimed job, `words.id`, context/distractor generators, translator, shared quality validator.
- Produces: `generateReadyVariantsForWord({ wordId, requiredReadyCount: 2 })` and `runQuestionGenerationBatch({ workerId, limit })`.

- [ ] Write failing tests for two distinct contexts, duplicate fingerprint rejection, invalid distractor repair, bounded retries, and persisted failure diagnostics.
- [ ] Verify RED with `node --test test/question-generation-service.test.js test/question-generation-worker.test.js`.
- [ ] Extract a deterministic question fingerprint based on normalized question text, target `word_id`, type, and normalized options.
- [ ] Generate or repair until two variants pass the existing structural and semantic quality gates; never mark partial rows ready.
- [ ] Insert new variants before retiring stale rows so a failed refresh cannot empty a usable cache.
- [ ] Implement worker leases, bounded batches, exponential retry scheduling, and graceful startup/shutdown hooks.
- [ ] Re-run focused tests and `node --test test/question-cache.test.js test/question-quality.test.js test/supabase-data.test.js`.
- [ ] Commit with `feat: build two verified cache variants per meaning`.

### Task 4: Enqueue on entry and expose truthful generation status

**Files:**
- Modify: `backend/data-source.js`
- Modify: `backend/supabase-data.js`
- Modify: `backend/server.js`
- Modify: `backend/http-app.js`
- Modify: `backend/test/data-source.test.js`
- Modify: `backend/test/server-contract.test.js`
- Modify: `backend/test/word-entry-cache-contract.test.js`

**Interfaces:**
- Consumes: Task 2 enqueue API and Task 3 worker runner.
- Produces: entry responses containing `wordId` and `generationStatus`; diagnostics containing per-status and per-rejection counts.

- [ ] Add failing API contract tests that `/api/admin/addWord` and `/api/admin/addWords` enqueue every inserted `word_id` and never report cache-ready before two valid variants exist.
- [ ] Remove `rebuildCacheAfterWordWrite` as the product mechanism; keep whole-user rebuild only as an explicit admin recovery command.
- [ ] Enqueue within the same service operation after each successful insert, with idempotent recovery if enqueue initially fails.
- [ ] Start the worker from the backend lifecycle and expose health fields for pending, retrying, manual-review, and ready meanings.
- [ ] Return structured per-meaning diagnostics without leaking prompt content or secrets.
- [ ] Run `node --test test/data-source.test.js test/server-contract.test.js test/word-entry-cache-contract.test.js`.
- [ ] Commit with `feat: enqueue cache generation on word entry`.

### Task 5: Enforce cooldown, daily meaning exclusion, and mastery

**Files:**
- Modify: `backend/quiz-cooldown.js`
- Modify: `backend/quiz-word-queue.js`
- Modify: `backend/quiz-adapter.js`
- Modify: `backend/data-source.js`
- Modify: `backend/mastery-service.js`
- Modify: `backend/mastery-evidence.js`
- Modify: `backend/test/quiz-cooldown-service.test.js`
- Modify: `backend/test/quiz-word-queue.test.js`
- Modify: `backend/test/quiz-adapter.test.js`
- Modify: `backend/test/mastery-service.test.js`

**Interfaces:**
- Produces: one authoritative eligibility result keyed by `word_id` and one authoritative mastery evaluation keyed by `word_id`.
- Consumes: submitted formal assessments and ready active cache rows.

- [ ] Make the new boundary and multi-meaning tests fail against the current production call chain, not only pure helpers.
- [ ] Route every Supabase `/api/quiz` path through the shared 18-hour cooldown with no `minAgeMs=0` default for formal quizzes.
- [ ] Fail closed on missing, invalid, future, or negative timestamps.
- [ ] Replace normalized-spelling daily exclusion with exact `word_id` exclusion from submitted correct formal assessments.
- [ ] Make `mastery-service` authoritative and migrate production callers away from direct legacy evaluators.
- [ ] Implement wrong-answer reset and two different `Asia/Shanghai` learning-day progression; exclude review/test/unsubmitted evidence.
- [ ] Run all cooldown, queue, adapter, submit, mastery, stats, and source-integrity tests.
- [ ] Commit with `fix: enforce meaning-level quiz and mastery rules`.

### Task 6: Repair frontend cache readiness UX

**Files:**
- Modify in web repository: `src/app.js`
- Modify in web repository: `src/styles.css`
- Modify in web repository: `test/stage2-behavior.test.cjs`
- Modify in web repository: `test/quiz-logic.test.cjs`

**Interfaces:**
- Consumes: structured backend generation/cache status.
- Produces: non-overlapping CTA states and actionable parent diagnostics.

- [ ] Write failing tests for ready, building, partial, retrying, and manual-review states.
- [ ] Replace the fixed “0/10” toast flow with button state/copy and an inline status panel.
- [ ] Keep the start CTA disabled only when fewer than 10 eligible ready meanings exist; show current eligible count and a retry action where appropriate.
- [ ] Preserve multi-set behavior and never deduplicate different `word_id` values sharing the same spelling.
- [ ] Run `node --test test/quiz-logic.test.cjs test/stage2-behavior.test.cjs` and syntax checks.
- [ ] Commit in the web repository with `fix: show actionable quiz cache readiness`.

### Task 7: Backfill, full verification, and deployment

**Files:**
- Create: `backend/scripts/backfill-question-generation-jobs.js`
- Create: `backend/test/backfill-question-generation-jobs.test.js`
- Modify: `docs/RELEASE_CHECKLIST.md`
- Modify: `.github/workflows/render-deploy.yml` only if Node 22 is not already guaranteed.

**Interfaces:**
- Consumes: Tasks 2-5 APIs.
- Produces: idempotent backfill and release evidence.

- [ ] Write a failing backfill test proving only unmastered meanings with fewer than two ready variants receive jobs.
- [ ] Implement dry-run by default and an explicit apply flag; never delete existing ready questions.
- [ ] Verify migration SQL against current production schema read-only before applying; then apply the additive migration once and verify table grants/RLS.
- [ ] Run the full backend suite with `npm.cmd test`, all frontend tests, syntax checks, and `git diff --check` in both repositories.
- [ ] Run a local/fake end-to-end flow: enter meaning, process worker, verify two ready rows, confirm 18-hour boundary, quiz selection, submission, daily exclusion, and mastery progression.
- [ ] Commit backend/app changes, push the reviewed app commit to `origin/main`, and push the reviewed web commit to its deployment branch/target.
- [ ] Verify `origin/main`, the GitHub Actions `Deploy backend to Render` run, Render health, cache diagnostics, and a production test-account quiz.
- [ ] Record exact commit hashes, workflow URL, test counts, migration result, and any deliberately unpushed changes.

