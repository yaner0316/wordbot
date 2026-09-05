# Learning audit review and execution — 2026-09-05

## Evidence and adjudication

Reviewed task “审计”, backend cf6c9b479f85ba4c7d98c8f64fb824ef7c88a97a, frontend 446251d, the historical PROJECT.md, current handoff documents and docs/selected-sense-staged-review-plan.md.

- Accept: the queue is overdue and requires intervention. Correct the claim that the worker has never produced questions: never_succeeded is process-local batch telemetry, set only when a whole batch returns; it does not prove that a running batch has never claimed work. A bounded read-only database sample contains completed jobs. The public queue reports an oldest age above six days.
- Accept: old approved rows do not attest current semantic policy. Incorporate PR #33, its unpushed fixture repair, and additionally select source_version in the actual database backfill reader. No cache rows are rewritten.
- Accept: parent-only mutations lacked role checks. Protect settings, word entry/edit/delete, test cleanup and review-flag writes; preserve child reads and the existing durable preparation request, which the child UI legitimately uses. Admin-token-only global operations remain protected.
- Accept: logout did not clear the browser HttpOnly cookie. Add a POST logout endpoint and wait for its successful response before clearing local state. This removes the browser credential; it is not a distributed revocation list for previously copied signed tokens.
- Reject as implementation defects: selected-sense review unlock after submission and preservation of earlier evidence after a wrong context. The current selected-sense design explicitly requires both. Keep that behavior.
- Reclassify: 18-hour/cross-day criteria, guessing semantics and 1/3/7/30-day retention are learning-policy decisions. Current tests explicitly count guesses, and selected-sense design requires two correct contexts without specifying intervals. Historical handoff rules differ. Do not silently change established behavior or recalculate learning records. The stale handoff is not evidence that production retention is implemented.
- Accept with evidence boundary: production has no demonstrated 7-day retention workflow. This is a product capability gap, not a confirmed regression in the selected-sense release. The historical permanent-mastery policy also conflicts with the audit's proposed perpetual review schedule.
- Accept: a disabled start button hid the reason and recovery action. Show them immediately whenever readiness disables the button.
- Accept: a complete candidate builder discarded one independently approved candidate. Preserve partial candidates only for the durable service, which still checks distinctness, distractor overlap and a minimum of two before publishing. Direct callers retain all-or-nothing behavior.
- Accept: backend CI pinned an old frontend. Update to the verified current main commit.

## Remaining scope and limits

Question reporting from the result screen, retrospective score reversal and a manual semantic-review workflow are not implemented by this patch. Existing invalidation RPCs operate on active challenges only; exposing them for submitted history would be incorrect. A durable report workflow and an explicitly scoped correction policy are required before changing historical learning data.

No evidence of completed secret rotation, backup restoration drills, privacy/export/deletion workflows or external alert delivery was found. Absence of a checked-in record does not prove provider backups or private operational controls are absent. These require provider/account evidence and separate product/operations work; no credentials are printed and no destructive operation is performed here.

## Validation contract

Run backend tests against the current frontend contract, frontend tests, syntax and diff checks. Publish via PR, then verify Actions and actual public SHAs. Record deployment results separately. HTTP health success alone is not a learning-flow acceptance. learningSupply reports overdue backlog independently of server liveness so a restart cannot erase the warning.

Final local verification: 1065 backend tests, 1058 passed, 0 failed, 7 skipped; 185 frontend tests passed. Synthetic bank example using the configured live model produced two current-attested candidates, rejecting one candidate; no production data was read and no database write was made. Full-chain regressions cover adapter projection, readiness query and replacement-cache attestation.
