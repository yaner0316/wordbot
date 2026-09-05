# Versioned Question Attestation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent type-1 formal questions approved under an older semantic-audit policy from being selected, without editing existing cache rows.

**Architecture:** New audited cache rows encode the current audit policy in their existing `source_version` field. Cache readiness accepts type-1 rows only when `ai_audit_status` is approved and the source version carries the current attestation. Existing rows are ineligible, not deleted or rewritten.

**Tech Stack:** Node.js, node:test, existing Supabase question cache.

## Global Constraints

- Do not read or print environment values.
- No schema migration, cache wipe, backfill, queue mutation, data repair, or mastery rewrite.
- Type-1 questions fail closed when audit status or attestation is absent.
- Preserve the existing two-distinct-variant generation requirement.

---

### Task 1: Define and persist the current semantic-audit attestation

**Files:**
- Modify: `backend/question-semantic-audit.js`
- Modify: `backend/supabase-data.js`
- Test: `backend/test/question-semantic-audit.test.js`
- Test: `backend/test/supabase-data.test.js`

- [ ] **Step 1: Write failing tests**

Add one assertion that `auditUniqueAnswer` returns the current policy version on
approved and rejected results. Add one cache-row test that a newly built,
approved type-1 row stores a source version containing that policy version.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `node --test backend/test/question-semantic-audit.test.js backend/test/supabase-data.test.js`

Expected: FAIL because audit results and generated rows lack an attestation.

- [ ] **Step 3: Implement minimal attestation helpers**

Export `CURRENT_SEMANTIC_AUDIT_POLICY_VERSION` and
`buildAttestedQuestionSourceVersion(baseVersion)`. Return `policyVersion` from
`auditUniqueAnswer`. Set the generated approved row source version with the
helper; no new column is introduced.

- [ ] **Step 4: Verify focused tests pass**

Run: `node --test backend/test/question-semantic-audit.test.js backend/test/supabase-data.test.js`

Expected: PASS.

### Task 2: Require current attestation for strict cache readiness

**Files:**
- Modify: `backend/question-cache.js`
- Test: `backend/test/question-cache.test.js`
- Test: `backend/test/quiz-adapter.test.js`

- [ ] **Step 1: Write failing regressions**

With strict AI audit enabled, assert that a type-1 `approved` row with a legacy
source version has `ai_audit_policy_version_required`, while a current-attested
row is ready. Assert the formal quiz builder excludes legacy rows.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `node --test backend/test/question-cache.test.js backend/test/quiz-adapter.test.js`

Expected: FAIL because readiness currently checks only `approved`.

- [ ] **Step 3: Implement the single readiness gate**

Normalize `source_version` in `normalizeCacheRow`. In the existing strict
type-1 audit branch, require the current source-version attestation and return
the stable issue code `ai_audit_policy_version_required` if absent.

- [ ] **Step 4: Run focused verification**

Run: `node --test backend/test/question-semantic-audit.test.js backend/test/question-cache.test.js backend/test/supabase-data.test.js backend/test/quiz-adapter.test.js`

Expected: PASS.

### Task 3: Freeze the two qiuqiu examples as audit regressions

**Files:**
- Modify: `backend/test/question-semantic-audit.test.js`

- [ ] **Step 1: Add deterministic rejection cases**

Stub the model response for the schoolyard sports sentence with multiple valid
letters and assert rejection. Stub the haircut sentence with `D` (`joke`) valid
while expected answer is `C` (`quiz`) and assert rejection.

- [ ] **Step 2: Run semantic tests**

Run: `node --test backend/test/question-semantic-audit.test.js`

Expected: PASS.

### Task 4: Review and release-gate

- [ ] **Step 1: Review diff**

Run: `git diff origin/main -- backend/question-semantic-audit.js backend/question-cache.js backend/supabase-data.js backend/test/question-semantic-audit.test.js backend/test/question-cache.test.js backend/test/supabase-data.test.js backend/test/quiz-adapter.test.js`

Expected: only attestation/readiness logic and regression tests.

- [ ] **Step 2: Run backend suite**

Run: `npm test`

Expected: exit code `0`.

- [ ] **Step 3: Create and verify a focused PR**

After actions pass and merge completes, verify the public backend health release
SHA. Do not change live cache rows; replacement generation remains durable.
