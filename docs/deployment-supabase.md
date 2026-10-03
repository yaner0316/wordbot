# Supabase Render Deployment

This page records a legacy deployment proposal. For the current release and data procedures, follow [`docs/OPERATIONS.md`](OPERATIONS.md) and the repository's release workflow. Supabase is the production source of truth; legacy Feishu utilities are not part of production runtime.

## Render Environment Variables

Add these variables in the Render service environment:

```bash
SUPABASE_URL=https://...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
DATABASE_URL=postgresql://...
```

Keep `SUPABASE_SERVICE_ROLE_KEY` server-side only. Do not expose it in frontend code.

## Current deployment boundary

Deploy through the approved `main` release workflow after its checks pass. Do not use the old Gate 5 branch-push sequence below as current release instructions. Apply and verify database migrations only through the registered release process in `docs/OPERATIONS.md`.

## Rollback Plan

Rollback means restoring the previous Supabase-backed application build. Feishu is not a production rollback target. Keep migration evidence and offline tools separately if historical recovery is required.

## Isolated smoke test

Use a local backend connected to a disposable Supabase environment and a synthetic account with no real learner data. Register and explicitly log in to that account, then run the smoke check against the local endpoint. Keep the base URL fixed to `http://127.0.0.1:5000`; do not point this procedure at Render or substitute a real child's identifier.

Use the local web build to verify quiz load, submit, result, and history. Production user-flow validation follows the authorization and evidence requirements in `PROJECT.md` and `docs/OPERATIONS.md`.
