# Render Deployment

This repository deploys the backend to Render through the GitHub Actions release workflow. Follow [`OPERATIONS.md`](OPERATIONS.md) for the authoritative migration, verification, and operator-authorization procedure; this page keeps the Render-specific service settings and release hook details.

## Render service settings

- Service type: Web Service
- Repository: `yaner0316/wordbot`
- Production branch: `main`
- Runtime: Node.js `>=22 <25` (the release workflow currently selects Node 24)
- Build command: `npm run build`
- Start command: `npm start`

The root build installs the locked backend dependencies with `npm --prefix backend ci`. The root start command runs `node backend/server.js`; Render supplies the listening port through `process.env.PORT`. Service startup must not apply database DDL; migrations are applied and verified by the approved release workflow as described in `OPERATIONS.md`.

## Required Render environment variables

Set the Supabase service credentials and any AI credentials enabled by the deployment. Keep service-role credentials server-side:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL` for the registered migration runner
- `MINIMAX_API_KEY` when AI context generation is enabled

For the question-generation worker, use a unique worker ID per instance and explicitly review:

- `WORDBOT_QUESTION_WORKER_ID`
- `WORDBOT_QUESTION_WORKER_BATCH_SIZE` (production target: `1`)
- `WORDBOT_QUESTION_WORKER_LEASE_MS` (production target: at least `900000`)
- `WORDBOT_QUESTION_WORKER_POLL_MS`
- `WORDBOT_QUESTION_WORKER_MAX_ATTEMPTS`

A lease must comfortably exceed one generation-and-validation cycle. Before release, confirm that expired or foreign-owned leases cannot publish or complete cache work.

## GitHub Actions deploy hook

In Render, copy the backend service Deploy Hook URL. In GitHub, create repository secret `RENDER_DEPLOY_HOOK_URL` with that URL. Only a push to `main` can invoke the production hook, and only after the migration and verification steps and backend checks succeed. Other branch pushes, pull requests, and manual workflow runs do not deploy production.

The workflow uses Node 24 and the safe backend test command. Keep the scoped test command; bare `node --test` can collect operational scripts outside `backend/test/**/*.test.js`.

After a `main` deployment, GitHub Actions polls the public `GET /api/health` endpoint for up to ten minutes. Release verification requires the healthy endpoint to report the exact triggering Git SHA. This public check uses no credentials and makes no application, database, cache, or migration request. Health alone does not replace the affected user-flow persistence and readback evidence required by `PROJECT.md`.

## Rollback and lease checks

If the worker or lease behavior is unhealthy, stop the new service before starting an older build. Inspect `generating`, `validating`, and `repairing` jobs and record lease ownership and expiry; wait for or deliberately recover valid leases rather than running two versions against the same jobs.

Keep additive migrations in place during a code rollback. After rollback, verify that only one intended worker owns new leases, stale jobs become reclaimable only after expiry, stale owners cannot publish or complete cache changes, ready cache rows remain intact, and `/api/health` no longer reports a worker error. Follow `OPERATIONS.md` for any separate database recovery decision.
