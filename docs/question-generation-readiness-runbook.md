# Question Generation Readiness Runbook

## Purpose

Use the backend health response and the authenticated question-cache status response to distinguish a healthy service from a child who cannot yet start a formal quiz.

## Thresholds

- A formal quiz is ready only when `canStartFormalQuiz` is true. The current threshold is 10 eligible questions for the user's selected level.
- `oldestPendingOverThreshold` becomes true when the oldest `pending` generation job is at least 30 minutes old.
- The worker health endpoint reports `stalled` after 15 minutes without required polling or claim progress while eligible work remains.

## Operator Checks

1. Check `GET /api/health`.
   - `questionGenerationWorker.status: healthy` or `idle` means the worker is running.
   - Inspect `questionGenerationQueue.counts` and `oldestPendingAgeMs` for a growing backlog.
   - `questionGenerationQueue.lastErrorCode` is intentionally a safe code, not raw provider output.
2. Ask the authenticated child or parent session to load `GET /api/admin/questionCache/status?userId=<current-user>`.
   - `readiness.canStartFormalQuiz: true` means a formal ten-question challenge can start.
   - `readiness.status: building` or `waiting_retry` means generation is still progressing or retrying.
   - `readiness.status: needs_attention` means one or more jobs require operator investigation.
   - `readiness.alerts.belowReadyThreshold` with `oldestPendingOverThreshold` means the child has waited beyond the normal queue threshold.
3. When the worker is stalled, inspect the safe health fields and deployment logs, then restore normal worker operation through the supported deployment path.

## Safety Boundaries

- Do not expose raw job errors, provider responses, credentials, or user job rows to the child UI.
- Do not clear caches, run backfills, apply migrations, or rewrite mastery data as a response to these alerts.
- A `202 Accepted` rebuild request indicates durable job acceptance; use status fields to observe eventual readiness.
