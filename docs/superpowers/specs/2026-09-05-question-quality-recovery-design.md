# Question Quality Recovery Design

## Problem

Two qiuqiu feedback examples show that a formal vocabulary question can still be
ambiguous or have an incorrect configured answer. The formal-challenge gate
currently requires only `ai_audit_status = approved`. That marker has no audit
policy version or evidence, so rows approved under an earlier weaker prompt
remain eligible after the audit policy becomes stricter.

The public health response on 2026-09-04 also showed the generation worker had
never completed successfully and its backlog was dominated by
`INSUFFICIENT_DISTINCT_READY_VARIANTS`. A bad question cannot be replaced
reliably while the supplier is unhealthy.

## Goals

- A formal challenge must not use a type-1 row that lacks the current semantic
  audit attestation.
- Ambiguous questions and questions whose expected answer is semantically wrong
  must be regression-tested.
- A child can flag a displayed formal question as invalid; it is not scored and
  an available replacement is shown only when the authoritative backend accepts
  the report.
- Question-generation failures must expose actionable rejection evidence and
  must not treat a transient lack of acceptable variants as a successful run.
- No cache wipe, data rewrite, mastery rewrite, migration, backfill, or data
  repair is part of this work.

## Non-goals

- Changing game rewards, scoring policy, the selected-sense staged-review flow,
  or historical assessment records.
- Automatically modifying the two reported live rows from screenshots.
- Lowering the requirement for two distinct quality-approved primary variants.

## Design

### PR A: Recover generation observability

Keep the two-variant requirement. When the generator cannot obtain both
variants, record a bounded, structured rejection summary for the job and
surface it in the existing readiness/health response. The worker retains the
existing retry behavior; this PR makes the exact bottleneck visible and adds
tests for the failure path. It does not retry jobs manually or modify queued
rows.

### PR B: Versioned semantic attestation and child report

Define one current semantic-audit policy version in code. A newly generated
type-1 cache row carries that version alongside its `approved` audit status.
Formal selection and formal-challenge persistence require both values. Rows
without the current version are simply ineligible; they are neither deleted nor
edited.

The semantic-audit test suite includes the reported sports sentence (reject:
multiple natural sports completions) and the haircut sentence (reject: `joke`
is the only natural completion, not `quiz`).

The formal quiz UI adds a small `这题有问题` action for a displayed question.
It submits a constrained reason to the existing authoritative invalidation and
replacement path. The backend validates the reason, invalidates the challenge
question, and returns a replacement only from current-attested ready cache
rows. The reported item is not scored. If no replacement is ready, the UI says
the question is being replaced instead of fabricating a score or fallback.

## Safety and Failure Handling

- All current audit/model failures fail closed: the row is not publishable.
- New selection requirements make old rows unavailable rather than mutating
  them.
- A report is scoped to the authenticated user, active formal challenge, and
  displayed challenge-question ID.
- The user cannot select a replacement or alter an answer through the report
  payload.
- The two screenshot examples become deterministic tests, independent of a
  live model response.

## Verification

- Unit tests for audit policy-version parsing, ambiguity rejection, and wrong
  expected-answer rejection.
- Data-source and HTTP contract tests for report/invalidate/replace behavior.
- Worker tests for structured insufficient-variant diagnostics.
- Focused backend and frontend suites, PR diff review, GitHub Actions success,
  deployed SHA match, public backend health, and isolated public smoke test.
