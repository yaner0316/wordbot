# Initial learning status repair — 2026-10-12

Scope: fix submitted initial selected-sense learning being persisted as pending; preserve the separate two-formal-answer mastery rule. No score, answer, reward, cache, or unrelated account changes.

Cause: evaluateMeaningMastery excludes initial_context from evidence, then treats zero evidence attempts as unseen. Submission persists that stage, so an answered meaning looks untouched. Existing tests assert evidence exclusion but miss the initial-only saved state.

Plan and stop conditions:
- [x] Add failing regressions for initial-only learning, exclusions, mastery thresholds and submission persistence/retry.
- [x] Separate learning participation from formal mastery evidence; submitted real initial context yields recognized with zero mastery evidence. Formal evidence continues to control consolidating/mastered.
- [x] Clarify PROJECT.md; verify existing frontend Recognized mapping without changing UI/API shape.
- [x] Run focused regressions, then one backend full suite. Incremental checks only after any fixes; CI remains the release gate.
- [ ] Review focused diff, create PR and deploy via existing pipeline; verify public SHA.
- [ ] Reconcile only the reported account's two affected meanings using the existing planner/RPC with snapshot, fingerprint, compare-and-swap and readback. Preserve immutable assessments.

Evidence stays in the calling workspace tmp/initial-learning-status-20261012; learner data must not be committed.

Validation: regression initially failed 3 of 5 checks (unseen/pending instead of recognized). After the fix, 68 affected tests passed. The one full backend run passed 1244 tests with 7 pre-existing skips and no failures (1251 total). The submission retry fixture passes stored existingAssessments as the real coordinator does. Frontend already maps Recognized to its existing label; no frontend/API change is required. Dry-run recovery is limited to two pending-to-recognized transitions with no remembered-at change.
