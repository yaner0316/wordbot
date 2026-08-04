# WordBot Release Checklist

Use this checklist before publishing the current staged release.

Production runtime requirement: Node.js 22.x. Confirm locally before testing:

```powershell
node --version
```

## 1. Environment

Create `backend/.env` from `backend/.env.example` and fill the required Feishu values:

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_WORD_APP_TOKEN`
- `FEISHU_WORD_TABLE_ID`
- `FEISHU_TEST_APP_TOKEN`
- `FEISHU_TEST_TABLE_ID`
- `FEISHU_STATS_APP_TOKEN`
- `FEISHU_STATS_TABLE_ID`

Optional:

- `FEISHU_DIST_APP_TOKEN`
- `FEISHU_DIST_TABLE_ID`
- `MINIMAX_API_KEY`
- `WORDBOT_GAME_REWARD_EXCELLENT_MINUTES`
- `WORDBOT_GAME_REWARD_PERFECT_MINUTES`

Then verify the local environment before starting the server:

```powershell
cd D:\Projects\04-Wordbot-开发任务\app\backend
npm.cmd run check:env
```

The command exits with code `1` and prints `missing` when required values are absent.

## 2. Feishu Schema

Run the review-field setup once before release:

```powershell
cd D:\Projects\04-Wordbot-开发任务\app\backend
npm.cmd run setup:review-fields
```

Expected result on a configured table:

```text
已存在: assessment_kind
已存在: source_test_id
已存在: parent_review_id
已存在: review_round
已存在: review_status
已存在: source_question_id
```

## 3. Automated Verification

Backend:

```powershell
cd D:\Projects\04-Wordbot-开发任务\app\backend
npm.cmd test
node --check scripts/backfill-question-generation-jobs.js
node --check server.js
node --check http-app.js
node --check feishu.js
node --check runtime-health.js
node --check game-reward.js
```

`npm.cmd test` runs the safe scope `node --test --test-concurrency=1 "test/**/*.test.js"`. Do not use bare `node --test`; it can collect operational scripts.

Frontend:

```powershell
cd D:\Projects\04-Wordbot-开发任务\web
node --test test/*.test.cjs
node --check src/app.js
node --check src/quiz-logic.js
node --check src/review-flow.js
```

Repository checks:

```powershell
cd D:\Projects\04-Wordbot-开发任务\app
git diff --check

cd D:\Projects\04-Wordbot-开发任务\web
git diff --check
```

## 4. Supabase Migration and Question-generation Backfill

The script requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `backend/.env`. Apply these migrations before deploying worker code, in this order:

1. `backend/migrations/20260803_question_generation_jobs.sql`
2. `backend/migrations/20260803_question_generation_claim_rpc.sql`

After the first migration, verify:

- `question_generation_jobs` exists with RLS enabled.
- `anon` and `authenticated` have no table access; `service_role` has CRUD access.
- the `words_enqueue_question_generation_job` trigger exists.
- `question_cache_fingerprint_upsert_unique_idx` exists.
- existing ready cache rows and their counts are unchanged.

After the second migration, verify:

- `claim_question_generation_jobs(...)` exists.
- only `service_role` can execute it.
- two concurrent claims cannot receive the same job.
- an in-progress job is reclaimable only after its lease expires.

Always inspect a dry-run first from the app repository root:

```powershell
node backend/scripts/backfill-question-generation-jobs.js
```

Optionally scope both dry-run and apply to one Supabase user UUID:

```powershell
node backend/scripts/backfill-question-generation-jobs.js --user-id <USER_UUID>
```

Confirm that `mode` is `dry-run`, `enqueued` is `0`, the jobs are deterministically ordered, and every planned row belongs to an unmastered meaning with fewer than two distinct ready primary fingerprints. Save and review the returned `planFingerprint`, then apply that exact plan:

```powershell
node backend/scripts/backfill-question-generation-jobs.js --apply --plan-fingerprint <REVIEWED_SHA256>
```

For a scoped plan, repeat `--user-id <USER_UUID>` on the apply command. Any data change that alters the plan causes `PLAN_FINGERPRINT_MISMATCH` and requires a new reviewed dry-run.

Require all of the following from apply output:

- `failed` is `0`.
- `applied` equals `progress.applied`.
- `progress.attempted` equals `progress.total`.
- `failures` is empty.

If any item fails, keep the report, correct the cause, and dry-run again; do not assume the unattempted or failed jobs were written. Run the dry-run once more after a successful apply. `planned` should be `0` for unchanged data because existing jobs are skipped. The backfill only creates missing generation jobs and never deletes or rewrites ready question-cache rows.

## 5. Health Check

After starting the backend, open:

```text
http://localhost:5000/api/health
```

Release only when:

- `ok` is `true`
- `missing` is an empty array
- all required `env` values are `true`

## 6. Manual Smoke Test

Use `file:///D:/Projects/04-Wordbot-开发任务/web/index.html?demo=1` for local preview, then repeat on the published URL.

Check:

- Start a formal quiz.
- Select question-language difficulty.
- Answer all questions and select confidence on every question.
- Confirm answer explanations list all four Chinese meanings.
- Confirm wrong answers require viewing explanations before review.
- Start review and confirm the review question differs from the source question.
- Submit review and choose continue or defer.
- Confirm first score stays unchanged in the final summary.
- Confirm 9/10 or 10/10 first score shows the game-time reward card.
- Switch to test mode, answer a quiz, then clean test-mode records.

## 7. Data Safety

- Formal learning data updates mastery and statistics.
- Test mode writes isolated records and can be cleaned.
- Review records keep real/test mode.
- Review rounds do not increment first-quiz statistics.
- Game rewards are calculated from the first quiz score only.

## 8. Rollback Notes

If release has to be rolled back:

- Stop the new backend process and its question-generation worker before starting the previous build.
- Inspect jobs in `generating`, `validating`, or `repairing`; record `lease_owner` and `lease_expires_at`.
- Do not allow the old and new backend versions to process the same leases concurrently.
- Wait for valid leases to expire or use the reviewed recovery procedure; do not manually clear active leases blindly.
- Restore the previous backend and frontend build, but keep both additive `20260803` migrations in place.
- Confirm that only the intended worker acquires new leases after rollback.
- Confirm stale jobs are reclaimed only after lease expiry and stale owners cannot publish or complete cache changes.
- Confirm ready cache counts did not decrease during rollback.
- Do not delete Feishu review fields; they are additive and harmless to older code.
- Test-mode rows can be removed with the admin cleanup action.

Release remains blocked if `/api/health` reports a worker error, lease ownership is ambiguous, apply reported failures, or cache readiness decreased unexpectedly.

