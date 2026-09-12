# WordBot Operations

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

## Question-supply operations

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

Before release, record branch/base and intended SHA, focused and full test counts, migration apply state, CI/deploy result, live backend SHA, and the affected real-user persistence/readback result.

Rollback code through the normal repository/deploy path. Database rollback is a separate reviewed operation: prefer forward-compatible corrective migrations and preserve evidence. Do not claim a release complete until the live SHA and affected production flow match `PROJECT.md`'s definition of done.
