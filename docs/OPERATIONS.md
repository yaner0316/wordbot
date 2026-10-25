# WordBot Operations

## Independent completion audit (2026-10-19)

New audits use `blind-completion-v1` in addition to the compatible existing policy tags. MiniMax receives the four completed sentences and numbered original context fragments, without an expected answer. The server derives the fitting set, validates each exclusion and its cited original fragment, requires one answer matching the internal key, and persists the existing teaching JSON with method/input fingerprint metadata. Letter shuffling preserves word-based binding; context/option/answer drift invalidates it. No migration is needed and old approved supply is not globally purged.

Default generation requires the current method at both checkpoint restoration and candidate validation. Old audit/row artifacts resume at semantic review while retaining context, options, meanings and translation. A confirmed non-unique context invalidates its dependent stages and remains excluded in the durable checkpoint; replacement contexts must contain a distinguishing stated clue. Formatting failures retain their upstream work. Existing lease, edit/archive, pair and atomic publisher guards remain authoritative.

For an authorized stored-question repair, back up exact rows and original history hashes locally, record per-row model results and conditional-update receipts, preserve passing siblings, retire only failed supply without deleting referenced rows, and request the existing durable replacement path. Do not rewrite historical answers, scores, teaching snapshots, mastery, cooldown or game state. Large cross-account external-model batches require approval for that concrete scope; a local heuristic screening lead is not a semantic failure or a completed full audit. Local learner data and repair plans must not be committed to this repository.

## Teaching snapshots and history review (2026-10-13)

Apply `20261013_teaching_analysis_snapshots.sql` through the existing migration runner before this backend. It adds nullable `teaching_analysis` JSONB to cache and assessments, extends the installed atomic publisher while retaining lease/archive/edit fences and ACLs, and validates tagged cache rows and challenge snapshots. The change is repeatable; an otherwise current schema applies only this migration. No startup-time DDL, data backfill, cache purge or history rewrite occurs.

Newly audited rows carry `teaching-analysis-v1`. The semantic audit must supply all four contextual judgments and grounded reasons; missing, conflicting or ungrounded output fails closed and remains in the existing durable retry/checkpoint flow. A legacy partial audit without analysis resumes at the audit only, reusing saved context, layout, meanings and translation. Old complete `unique-answer-v2` rows stay compatible and are not mass-enqueued merely for missing analysis. Normal display replacement gradually supplies the new snapshots; old history explicitly reports absent teaching fields. This compatibility does not certify the semantic correctness of any particular legacy question.

History review uses the existing `/api/reviews` chain. Restoration/submission apply the same active-meaning filter and stable ordering; a word set changed since display is rejected for reload rather than assigning answers to another row. Original formal assessments and game minutes are preserved. Completed chains are not restarted; archived-only and no-wrong-answer responses are explicit.

The initial-context selected-sense branch uses four genuine Chinese meanings when available. If fewer than four distinct active meanings remain (including after parent archival), it uses the already supported type-4 Chinese meaning-recall round with the saved target meaning. It never invents distractors or restores archived meanings. The preparation/recognition stage, formal evidence gates, first score and game-time rules remain the same; no migration or data repair is needed for this fallback.

The reported legacy `shiny red` apple/grape question remains original historical evidence. Its scoring is not changed by this release. Any stored-question repair must first be a separately reviewed plan matching exact owner/meaning/stem/options/fingerprint and current cache version, with a per-row receipt. Do not run a bulk production export, retroactive analysis generation or answer rewrite. Local tests, Edge fixtures and model probes are preparation evidence; release completion still requires main CI, migration verification, live SHA and the authorized production readback.

## Parent library archive (2026-10-12)

Follow-up `20261012_parent_word_archive_legacy_ids.sql` repairs legacy Feishu ID lookup: the old table alias `word` collided with the `word` text column inside `to_jsonb(word)`, so legacy IDs were rejected. It replaces only the archive RPC using the unambiguous `owned_word` row alias, retaining ownership, locking, history and permissions. The verifier detects this repair; an otherwise current deployment applies only this follow-up. No data backfill or automatic user deletion is performed. UUID and legacy IDs may be mixed in one batch.

`20261012_parent_word_archive.sql` must be applied by the existing migration runner before deploying this backend and its paired frontend. It adds `words.deleted_at`, a service-only `active_words` invoker view, and `archive_words(uuid,text[])`. Existing live eligibility RPC definitions now read the active view; historical reads retain `words`. The migration preserves existing function ACLs, explicitly restricts the new RPC to service_role, and never changes historical assessments. When later migrations add word columns used by these RPCs, refresh `active_words` in the same migration.

Archival locks all owned meanings in a stable order, advances the generation version, retires every cache row and cancels jobs in one transaction. Retired caches remain available for legacy history hydration; archival never physically deletes them. It is repeatable and rejects any foreign/missing ID before changing anything. The verifier detects the added column, active view, RPC ACL/search path and challenge/claim guards; when only this contract is missing, it applies only this migration. Do not remove `deleted_at` or deploy old live-query code as a rollback: that would make archived meanings reappear. Use a forward corrective migration while retaining historical rows.

Development validation uses local synthetic data and PGlite. Production application/deployment and real-account deletion require their existing explicit authorization; local test success does not establish that the feature is live.

## Supported environment

- Node.js: `>=22 <25`
- Backend: Node.js/Express
- Production data: Supabase only
- Backend deploy: Render through the repository's release workflow

Local setup and verification:

```powershell
npm install
npm --prefix backend test
node --check backend/server.js
```

Use a focused `node --test` command while developing, then run the full backend suite before handoff. Frontend-affecting changes also require the separately versioned web repository's suite and contract checks.

## Database change procedure

1. Add an ordered, idempotent SQL file under `backend/migrations/`.
2. Register it in `backend/scripts/apply-question-generation-migrations.js` and extend migration contract/verification tests.
3. Run the local migration tests, preferably against the project's disposable PGlite fixture where supported.
4. Review the exact target environment and dry-run/read-only evidence.
5. Apply only after explicit operator authorization. For a `main` release, the repository workflow uses the encrypted `DATABASE_URL` secret to apply and verify the ordered migrations before it triggers Render; any migration or verification failure blocks deployment. Do not apply migrations from ordinary server startup.
6. Retain the workflow's summarized migration and verification evidence without credentials.

Never use startup-time implicit DDL. Never delete caches, rewrite assessments, reset mastery, or run bulk backfills merely because an alert fired.

## Unserved challenge demand (2026-10-25)

Apply `20261025_unserved_challenge_demand.sql` through the existing migration runner. It replaces only the claim RPC, retaining its signature, service-role ACL, active-word/version/mastery guards, due-time/lease fences and user rotation. Existing requests whose demand timestamp follows the last job update are prioritized even after the legacy two-minute window. A claim clears the short-window marker and updates the job timestamp, consuming that request. Failed work keeps normal retry timing; the existing request throttle remains in force. No cache, checkpoint, word or historical assessment rewrite is required. Verify actual missing meanings become published before reporting supply restored.

## Question-supply operations

The 20261009_display_replenishment migration adds an AFTER INSERT trigger on quiz_display_events. It requests the existing idempotent durable generation RPC in the display transaction, without changing assessment history or granting child roles access to generation tables. The verifier checks the trigger and applies only this migration when it is the sole missing contract. Coverage reconciliation also compares ready cache stems to each user's meaning-specific unexpired display history; health readiness no longer counts consumed stems as reserve. A newly mastered word is still excluded by the existing enqueue/claim guards.

The normal path is automatic:

1. The coverage controller scans existing non-mastered meanings against the user's current learning level and current quality policy.
2. It creates or revives one durable job for each missing target.
3. Workers lease jobs fairly across users, checkpoint valid stages, publish a complete pair atomically, and retry failures with bounded backoff.
4. A target leaves automatic work only when it is ready, mastered, or deleted.

Operational checks:

- `GET /api/health` confirms service, worker, queue, and learning-supply state.
- Authenticated `GET /api/admin/questionCache/status?userId=<user>` confirms whether that user's formal quiz can start.
- `canStartFormalQuiz: true` is the supply gate for a ten-question formal challenge.
- A growing oldest-pending age, no worker progress while eligible jobs exist, or repeated safe error codes requires investigation. It does not authorize destructive repair.

Coverage reconciliation diagnostics:

- `questionCoverage.lastError` is a bounded safe cause, never a raw message: `snapshot_load_failed`, `snapshot_cursor_invalid`, `enqueue_failed`, `enqueue_not_confirmed`, `not_configured`, or `reconciliation_failed`.
- `lastSuccessAt: null` while `lastAttemptAt` advances means no pass has ever completed. Read `lastError` before investigating anything else.
- `lastSummary.skippedMissingLevel` counts existing non-mastered meanings withheld from generation because their user has no current learning level. The generator derives every formal question from that level, so these meanings cannot be actioned until the level is set; they are reported rather than retried.
- `lastSummary.blockedInvalidWord` counts coverage targets that fail the same spelling eligibility check used by the generation worker. They remain visible targets, but are not ready, executable jobs, or ordinary generation retries. Have the parent review the affected entry in the vocabulary list; the current editor does not rename a spelling. Resolve existing malformed data only through an explicitly authorized correction plan, without deleting history or lowering question-quality gates to clear this count.
- Queue `counts.blockedInvalidWord` reports existing invalid-word jobs separately from pending/retrying work. Their row age is excluded from the ordinary pending-age metric, while `learningSupply.status: invalid_data_blocked` continues to report the unresolved data issue. If the queue cannot be read, `learningSupply.status: queue_unavailable` reports unavailable supply status instead of ready. Valid retrying work remains visible independently; fixing this classification does not certify all questions are ready or prove completion within 18 hours.
- A refused enqueue (`enqueue` answered `false`) is an already-handled target: the meaning became mastered or deleted, its word version already has an executable job, or its user has no current level. It is counted in `lastSkipped` and does not fail the pass. Only a missing enqueue answer fails closed.

For a one-time reconciliation or backfill, run the existing planner in dry-run mode, review its deterministic fingerprint and target count, then apply that exact plan. If the plan changes or a partial apply fails, generate and review a new plan. Automatic coverage reconciliation must be idempotent and must not require this manual approval loop.

For the user-authorized September 2026 progress recovery, retain mastery at the 2026-09-05 23:00 Asia/Shanghai cutoff under the exact preceding evaluator (`6458663^:backend/mastery-evidence.js`). Use `planMasteryStatusReconciliation` with the explicit recovery cutoff and that evaluator, merge later strict mastery and currently saved stages without downgrades, and retain original assessment rows. Normal reconciliation also must not revoke saved mastery.

Before applying a recovery, save the source word/assessment snapshot, reviewed plan/fingerprint, and affected cache/job rows locally; do not commit learner data to the public repository. Apply through the existing `reconcile_word_mastery_status` compare-and-swap RPC, which fences generation and retires/removes obsolete supply when a meaning becomes mastered. Save per-row receipts so interrupted execution is recoverable. Read back changed rows and confirm restored mastered meanings are excluded from formal selection; verify that scores and assessment history were not rewritten. Reverse status fields only against matching post-recovery state if rollback is needed; do not replay stale worker leases or overwrite intervening learner progress.

## Incident boundaries

- Preserve the last valid active cache pair while repairing a replacement.
- Do not expose raw model/provider errors to children; retain safe codes and aggregate rejection reasons for operators.
- A stale lease must fail closed. Another worker may resume after lease expiry from persisted checkpoints.
- If current policy or user level changes, invalidate incompatible stage outputs and cache rows while preserving unrelated upstream artifacts when safe.
- If Supabase is unavailable, return a controlled unavailable state. Do not fall back to legacy Feishu writes or generate an untracked live quiz.

## Release and rollback evidence

### Self-selected challenges (2026-10-05)

Prepare and review `backend/migrations/20261005_custom_challenges.sql` before releasing the paired frontend/backend change. Execution remains an explicitly authorized operator action. The existing verifier checks `rpc_custom_challenge_count_contract`; when this is the only missing contract, the migration runner applies only this new file. It permits complete 1–10-question challenges with a stored count marker and retains the 18-hour entry-age cooldown for first challenges, as well as ownership, saved mastery, current level, display cooldown and AI audit checks. It does not rewrite historical answers.

Publish the frontend branch before backend CI resolves its pinned web-contract revision; apply the authorized migration, deploy the backend, then the frontend. Verify the affected real flow with an explicitly selected account: exact chosen meanings, random fill, short challenge submission, persisted progress/history and no short-quiz game-time change. Local synthetic browser/database tests are not production acceptance. An old backend/frontend may reject new short sessions, so rollback needs paired code and preservation of those stored sessions; do not remove their count markers or historical evidence.

Before release, record branch/base and intended SHA, focused and full test counts, migration apply state, CI/deploy result, live backend SHA, and the affected real-user persistence/readback result.

Rollback code through the normal repository/deploy path. Database rollback is a separate reviewed operation: prefer forward-compatible corrective migrations and preserve evidence. Do not claim a release complete until the live SHA and affected production flow match `PROJECT.md`'s definition of done.


## Custom practice and authorized historical correction (2026-10-13)

Apply `20261013_custom_practice.sql` with the existing migration runner and verifier. It permits durable practice challenges and excludes their displays from formal cooldown while retaining stem history and question quality gates. Publish the paired frontend contract before backend CI; deploy the backend before exposing the new frontend behavior.

Historical correction requires an explicit operator-selected cutoff and a local source backup. Preserve question snapshots, answers and scores. Reclassify affected challenge/assessment projections as practice, clear their formal cooldown flags, recompute only affected mastery using prior valid evidence and the earliest submission baseline, and retain independently earned mastery. Revoke only claimed positive rewards, floor balances at zero, preserve claim IDs, advance game revisions and store an idempotent correction receipt. Lock/check current rows before updating and roll back the entire correction on drift. Fresh generation uses the existing word fence/finalizer, retiring referenced caches instead of deleting evidence. Verify changed projections, immutable answers and fresh current-version supply; do not repeat an unrelated full-data audit.

## Selected challenge demand (2026-10-10)

Apply `20261010_challenge_demand_priority.sql` through the existing question-generation migration runner before deploying its API adapter. An otherwise current schema applies only this migration; the verifier checks columns, RPC ACL/search path, bounded demand and claim priority. `request_challenge_question_supply(uuid, uuid[])` is service-role-only and accepts up to ten unique owned IDs. It advances pending/retry backoff once per five minutes, prioritizes within that user for two minutes, and preserves leases/checkpoints/attempt counts/edit fences. Other users retain fair claim rotation. No answer history or mastery rewrite is required. The UI stops automatic waiting after two minutes; background retries continue under their normal quality gates.

### Account defaults and historical cache references

New account registration persists the existing default learning level so coverage reconciliation and display replenishment have a canonical level. It does not start the level-change cooldown or overwrite existing account settings. Learning-level changes retire cached rows instead of deleting them because formal challenges retain foreign-key references to the original cache; historical question snapshots remain readable. No schema migration or existing-user backfill is required for this code change.



### Concise Chinese label normalization (2026-10-13)

The user explicitly authorized shortening legacy Chinese label prose while retaining each concept. This cleanup uses a fixed locally reviewed plan, an original-row snapshot and per-row receipts. Conditional updates require the same word ID, owner, old Chinese label, English definition, edit timestamp and active state. Only meaning_zh and updated_at change. English definitions, saved mastery, entry time, meaning identities, immutable assessments and generation versions are preserved. This semantics-preserving label-only operation does not invalidate caches or request new model generation. Ordinary parent meaning changes continue to use the existing generation fence. Keep learner plans and snapshots local; they are not release artifacts.
# Semantic proof revision (2026-10-20)

New approvals use `blind-completion-v2`: a proposed unique answer must also survive a critical exclusion check with the existing MiniMax provider. Both requests omit the intended answer; the second response is validated independently. Failure does not reuse the first approval. Do not relabel v1 cache/checkpoint evidence as v2. This changes neither submitted assessment snapshots nor scoring/mastery/reward rules.

