# Mandatory Question Semantic Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make type-one contextual-question semantic review reject any plausible alternate answer before a row can be published.

**Architecture:** `question-semantic-audit.js` remains the model boundary. Candidate generation already refuses every non-approved audit result; this plan tightens the model rubric and pins ambiguity regressions. Existing durable retry and database publication gates remain unchanged.

**Tech Stack:** Node.js built-in test runner, CommonJS, MiniMax-compatible chat completion.

## Global Constraints

- Do not read or echo environment-file values or secrets.
- Do not run migrations, backfills, cache wipes, or mastery/data rewrites.
- Type-one publication remains fail-closed unless the audit is certain and approves exactly the configured answer.
- This PR does not implement selected senses or staged review.

---

### Task 1: Lock Down Ambiguity Regressions

**Files:**
- Modify: `backend/test/question-semantic-audit.test.js`
- Modify: `backend/question-semantic-audit.js`

**Interfaces:**
- Consumes: `auditUniqueAnswer(question, { callModel })`.
- Produces: a rejected audit result when the reviewer reports multiple plausible letters.

- [ ] Write a failing test which captures the sent prompt and requires the phrase `plausibly complete the sentence`.
- [ ] Run `node --test backend/test/question-semantic-audit.test.js`; it must fail before the prompt change.
- [ ] Add the two explicit fail-closed rubric lines: reject any alternate option that can plausibly complete the sentence, and do not accept a merely better answer.
- [ ] Re-run the test and require it to pass.

### Task 2: Verify the Durable Publish Contract

**Files:**
- Test: `backend/test/question-semantic-audit.test.js`
- Test: `backend/test/question-generation-runtime.test.js`

**Interfaces:**
- Consumes: type-one candidates with `ai_audit_status`.
- Produces: no ready variants when audit status is not `approved`.

- [ ] Run `node --test backend/test/question-semantic-audit.test.js backend/test/question-generation-runtime.test.js`.
- [ ] Run the full backend suite with `WORDBOT_WEB_CONTRACT_PATH` set to the checked-out frontend source.
- [ ] Review `git diff origin/main...HEAD --check` and `git diff --stat origin/main...HEAD` before committing.
