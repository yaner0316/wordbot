# Mandatory Question Semantic Audit Design

## Decision

Every newly published type-one contextual question must receive an approved semantic audit.
The audit is fail-closed: rejection, malformed output, or an unavailable model produces no publishable row.
The durable job worker then uses its bounded retry and manual-review path without mutating cache rows or learning history.

## Why This Change

The persistence and formal-quiz gates already require `ai_audit_status = approved`.
The remaining weakness is audit precision.
The auditor must reject a question whenever any distractor can plausibly complete the sentence in ordinary child-facing English.
This covers `quiet` versus `crowded`, and `baseball` versus `softball` in an under-specified throwing sentence.

## Scope

- Type-one contextual fill-in questions only.
- Strengthen the model-facing audit rubric and preserve the approved-status contract.
- Add regression tests for ambiguity and fail-closed behavior.

## Non-Goals

- No migration, backfill, cache deletion, cache rewrite, or mastery rewrite.
- No release of selected-sense and three-stage review in this PR.
- No change to game rewards.

## Runtime Behavior

1. Candidate construction supplies the blanked sentence, options, answer, and Chinese option meanings to the semantic auditor.
2. The audit may approve only when its single valid option exactly matches the configured answer and it is certain.
3. Any other response leaves the candidate unpublished and the durable job keeps its normal retry/manual-review handling.
4. Existing cache data remains untouched.
