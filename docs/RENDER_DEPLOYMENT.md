# Render Deployment

This repository deploys the backend to Render through a GitHub Actions deploy hook. Database migrations are a release prerequisite; never use a backend deploy to discover that production schema is missing.

## Release order

1. Run the safe backend test command from `backend`: `npm.cmd test` (or `npm test` on Linux).
2. Apply and verify both Supabase migrations, in this order:
   - `backend/migrations/20260803_question_generation_jobs.sql`
   - `backend/migrations/20260803_question_generation_claim_rpc.sql`
3. Run and review the question-generation backfill dry-run.
4. Apply only the exact reviewed plan fingerprint and require `failed: 0`.
5. Push the reviewed code and allow GitHub Actions to trigger Render.
6. Verify `/api/health`, worker health, lease behavior, and cache diagnostics.

Do not deploy the new worker before both migrations pass verification.

## Render service settings

- Service type: Web Service
- Repository: `yaner0316/wordbot`
- Branch: `codex/reliability-engineering` or the reviewed production branch
- Runtime: Node
- Node version: 22.x (`package.json` declares the supported major-version range)
- Build Command: `npm run build`
- Start Command: `npm start`

The root build installs the locked backend dependencies with `npm --prefix backend ci`. The root start command runs `node backend/server.js`; the server listens on `process.env.PORT`, which Render supplies.

## Required Render environment variables

Set the Supabase service credentials and the AI credentials used by this deployment. At minimum, verify:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `MINIMAX_API_KEY` when AI context generation is enabled

For the question-generation worker, use a unique worker ID per instance and explicitly review:

- `WORDBOT_QUESTION_WORKER_ID`
- `WORDBOT_QUESTION_WORKER_BATCH_SIZE` (production target: `1`)
- `WORDBOT_QUESTION_WORKER_LEASE_MS` (production target: at least `900000`)
- `WORDBOT_QUESTION_WORKER_POLL_MS`
- `WORDBOT_QUESTION_WORKER_MAX_ATTEMPTS`

A lease must comfortably exceed one generation-and-validation cycle. Before release, confirm that expired or foreign-owned leases cannot publish or complete cache work.

## Database verification gate

After `20260803_question_generation_jobs.sql`, verify all of the following:

- `public.question_generation_jobs` exists and row-level security is enabled.
- `anon` and `authenticated` have no table access; `service_role` has the required CRUD grants.
- `words_enqueue_question_generation_job` exists on `public.words`.
- `question_cache_fingerprint_upsert_unique_idx` exists and supports the runtime upsert conflict target.
- Existing ready cache rows remain present; the migration and backfill must not delete them.

After `20260803_question_generation_claim_rpc.sql`, verify:

- `public.claim_question_generation_jobs(...)` exists.
- `public`, `anon`, and `authenticated` cannot execute it.
- `service_role` can execute it and claim at most the requested due jobs.
- Concurrent claims do not return the same job, and an expired lease is the only in-progress lease that can be reclaimed.

## Backfill gate

From the app repository root, first run the dry-run and review `summary`, every `jobs` entry, and `planFingerprint`:

```powershell
node backend/scripts/backfill-question-generation-jobs.js
```

Apply exactly that reviewed plan:

```powershell
node backend/scripts/backfill-question-generation-jobs.js --apply --plan-fingerprint <REVIEWED_SHA256>
```

Use the same `--user-id <USER_UUID>` on both commands when scoping a plan. A changed plan is rejected. Treat a nonzero process exit code or `failed > 0` as a failed release; retain the reported `applied`, `failed`, `progress`, and `failures` values for the release record.

## GitHub Actions deploy hook

In Render, copy the backend service Deploy Hook URL. In GitHub, create repository secret `RENDER_DEPLOY_HOOK_URL` with that URL.

The workflow checks out the reviewed source, selects Node 24, runs `npm ci` and the safe `npm test` command in `backend`, and only then calls the Render hook. Never replace the scoped backend test command with bare `node --test`, because that can collect operational scripts outside `backend/test/**/*.test.js`.

After a `main` deployment, GitHub Actions polls the public `GET /api/health` endpoint for up to ten minutes. The release is successful only when that endpoint is healthy and reports the exact GitHub commit SHA that triggered the deployment. This verification uses no credentials and makes no application, database, cache, or migration request.

## Rollback and lease checks

If the worker or lease behavior is unhealthy, stop the new service before starting an older build. Inspect all `generating`, `validating`, and `repairing` jobs: record `lease_owner` and `lease_expires_at`, and wait for or deliberately recover valid leases rather than running two versions against the same jobs.

Keep both additive migrations in place during a code rollback. After rollback, verify that only one intended worker owns new leases, stale jobs become reclaimable only after expiry, no ready cache rows were retired by a stale owner, and `/api/health` no longer reports a worker error.
