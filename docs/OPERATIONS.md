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
5. Apply only after explicit operator authorization. Do not apply migrations from ordinary server startup.
6. Run `npm run verify:question-generation-schema` against the same environment and retain its summarized evidence without credentials.

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

## Incident boundaries

- Preserve the last valid active cache pair while repairing a replacement.
- Do not expose raw model/provider errors to children; retain safe codes and aggregate rejection reasons for operators.
- A stale lease must fail closed. Another worker may resume after lease expiry from persisted checkpoints.
- If current policy or user level changes, invalidate incompatible stage outputs and cache rows while preserving unrelated upstream artifacts when safe.
- If Supabase is unavailable, return a controlled unavailable state. Do not fall back to legacy Feishu writes or generate an untracked live quiz.

## Release and rollback evidence

Before release, record branch/base and intended SHA, focused and full test counts, migration apply state, CI/deploy result, live backend SHA, and the affected real-user persistence/readback result.

Rollback code through the normal repository/deploy path. Database rollback is a separate reviewed operation: prefer forward-compatible corrective migrations and preserve evidence. Do not claim a release complete until the live SHA and affected production flow match `PROJECT.md`'s definition of done.
