# WordBot Stage 3 acceptance record

Date: 2026-08-11

## Completed in code

- Login sessions are signed, stateless cookies. A second backend instance can verify the same session without the process-local Map.
- `/api/health` probes the Supabase `users` and `question_generation_jobs` tables when Supabase is authoritative.
- Health output reports whether a shared session secret is configured without exposing the secret.
- The tracked legacy Supabase JSON backup was removed from the current tree and added to `.gitignore`. It contained a `cron_secret` field and must be treated as compromised.

## Required production operator action

1. Rotate the Render `WORDBOT_ADMIN_TOKEN` and set a dedicated random `WORDBOT_SESSION_SECRET`.
2. Redeploy after the environment change and verify `/api/health` reports `database.ok=true` and `session.sharedSecretConfigured=true`.
3. Review Git history and repository clones for the old backup; history rewriting is a separate coordinated operation and is not performed by this change.

## Data boundary

The cache repair on this date only changed `question_cache.cache_state` to `replace_pending` for the exact dry-run set and requeued generation jobs. It did not delete or modify `words`, `assessments`, or learning history.
