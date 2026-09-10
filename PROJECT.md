# WordBot Project Constitution

## Purpose

WordBot is a child-facing English vocabulary learning and formal assessment system. It is usable only when a real production user can log in, obtain a complete formal quiz, answer and submit it, receive grading, persist assessment evidence, and later see consistent results and history.

This file is the authoritative product and domain rule set. `AGENTS.md` governs engineering execution; `docs/OPERATIONS.md` governs production and data operations. Dated plans, handoffs, audits, and subsystem designs provide evidence but cannot override this file.

## Canonical domain model

- The learning and cache unit is one user's one meaning, identified by canonical `user_id + meaning_id` (`words.id`; older code may call it `word_id`). Different meanings of the same spelling remain independent.
- The user account's current selected learning level controls every generated and selected formal question. A meaning's historical entry level is metadata, not an eligibility filter and not a generation level.
- A deleted meaning is absent. Every existing meaning that is not mastered is a coverage target, including unseen, recognized, consolidating, pending, and legacy status variants.
- Production persistence is Supabase. Compatibility adapters may translate legacy shapes at boundaries, but may not become a second source of truth.

## Formal-question supply invariants

- Every coverage target must eventually have at least two distinct, current-policy, AI-approved type-1 formal questions at the user's current learning level.
- Distinctness requires different normalized stems and fingerprints. The approved pair must also satisfy the current distractor-overlap, option, Chinese-meaning, exact context-translation, and semantic single-answer rules.
- A formal quiz is cache-first and fail-closed: it uses only valid cached questions and never silently falls back to live generation or an unapproved/stale row.
- Coverage is continuously reconciled. Missing, stale, wrong-level, invalid, or incomplete supply creates or revives durable generation work without requiring a user or operator to notice it first.
- A target generation failure is never terminal. Retries continue with bounded backoff until the target is ready, mastered, or deleted. Attempt counts and safe diagnostics remain observable but do not remove a target from the executable queue.
- Approved partial work and valid intermediate stage artifacts are durable. Retry resumes at the first missing or invalid stage. A changed input invalidates that stage and its downstream dependents only; it does not rerun unrelated valid upstream work or discard an independently approved variant.
- Publishing is atomic at the selectable-pair boundary. Incomplete artifacts are not selectable, while the last valid active pair remains available until its replacement pair is ready.

## Learning and mastery invariants

- Initial selected-sense context and recognition review are preparation, not formal mastery evidence.
- One meaning becomes mastered only after two consecutive correct formal assessments on two different normalized stored stems, separated by at least 18 hours and no more than 720 hours.
- A formal wrong answer resets that meaning's consecutive sequence. Missing stems, cosmetic duplicates, preview/test/review rows, and duplicate submissions do not prove mastery.
- A spelling is mastered only when all of its meanings for that user are mastered.
- Assessment answers are historical evidence and are not rewritten to force a desired state. Derived status and rewards are reconciled from canonical evidence.
- Rewards are downstream of successful persistence and are based on newly mastered meanings; retries and duplicate submissions must not double-award.

## Authorization and consistency

- The server is authoritative for identity, role, quiz state, grading, mastery, and rewards.
- Parent-only writes include user settings, word/meaning mutation, destructive cleanup, and review-flag changes. Children may perform the explicitly supported learning flow and read their allowed state.
- Cross-device writes use server revisions or compare-and-swap semantics. Duplicate submissions are idempotent.
- Child-facing errors are actionable but do not disclose provider payloads, credentials, internal job rows, or other users' data.

## Definition of done

A product change is complete only when all applicable statements are evidenced:

1. The authoritative rule and affected subsystem documentation agree.
2. Focused regression tests were observed failing before implementation and pass afterward; the relevant full suites pass.
3. Required migrations are versioned, repeatable, permission-checked, and verified without assuming that writing SQL means it was applied.
4. The intended `main` commit passed CI and deployment, and public health reports the same backend revision.
5. A real authorized production user completes the affected end-to-end flow, including durable persistence and readback. Tests, deployment status, or health alone are insufficient.

## Change control

Changes to learning semantics, coverage targets, question quality gates, authorization, production storage, or definition of done require an explicit user decision and a `PROJECT.md` update. Implementation details that preserve these invariants may evolve without duplicating the rules elsewhere.
