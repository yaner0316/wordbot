# WordBot Stage 1: question_cache read-only mirror

This branch only implements a local/manual Feishu-to-Supabase mirror for the existing public.question_cache table and a reconciliation report. It does not change production reads or writes.

## Database decision

public.question_cache is an independent, regenerable cache table. Stage 1 writes its existing typed columns and resolves users/words through their Feishu record IDs before upserting. The unique feishu_record_id constraint is the idempotency key. RLS is enabled and currently has no end-user policy, so the write key must remain local and must never be added to Render.

The vocabulary, tests, reviews, learning settings, mastery, and reward tables remain design-only. They are reported as Feishu-only counts and are not written by this Stage 1 tool.

## Environment

Use local variables only: FEISHU_APP_ID, FEISHU_APP_SECRET, FEISHU_WORD_APP_TOKEN, FEISHU_WORD_TABLE_ID, FEISHU_TEST_APP_TOKEN, FEISHU_TEST_TABLE_ID, FEISHU_STATS_APP_TOKEN, FEISHU_STATS_TABLE_ID, FEISHU_QUESTION_CACHE_APP_TOKEN, FEISHU_QUESTION_CACHE_TABLE_ID, STAGE1_SUPABASE_URL, STAGE1_SUPABASE_SERVICE_ROLE_KEY.

The service-role key is read only by the local mirror client, never logged, committed, or configured in Render.

## Commands

From D:\Projects\04-Wordbot-开发任务\.worktrees\app-db-migration-stage1\backend:

  node scripts/stage1-sync-feishu-to-db.js
  node scripts/stage1-reconcile-db.js > stage1-reconciliation.json

The sync reads Feishu and the users/words lookup tables, then writes only public.question_cache using an upsert on feishu_record_id. It normalizes usernames for lookup and requires a confirmed user_id and word_id. Rows without valid cache shape or confirmed foreign-key mappings are skipped and counted.

The report includes per-user cache counts, cache counts by level and quality/status, Feishu-vs-DB cache diffs, Feishu-only word/test counts, case-variant users, duplicate word/meaning rows, and risks.

## Boundary and next step

Do not cut over, dual-write, deploy, alter Render variables, or modify /api/quiz, /api/submit, addWords, review, question quality, prompts, inflection, or the main Feishu read/write logic. Review several reports first; only then design the disabled DB cache adapter and a controlled DB read with Feishu fallback.

## Latest app audit (c5dfa8f)

The readiness fix keeps the cache row shape unchanged. A future DB reader must reproduce the rule that only submitted real assessments answered incorrectly contribute to the recent exclusion set. Unsubmitted, not-started, and correct answers must not be excluded. The cache table alone cannot determine this; the DB adapter must join the mirrored assessment records.

The current table has typed columns for question_type, last_used_at, source_version, and the cache question fields. Stage 1 does not alter the schema. Existing rows without feishu_record_id are reported as UNTRACKED_DATABASE_CACHE and are excluded from mirror comparison.

Deleting a word in Feishu can leave a database cache row behind because this stage only upserts and never deletes. The reconciliation report emits ORPHAN_CACHE when a tracked database row is absent from the current Feishu snapshot. A later cleanup policy must be approved separately and must use stable word_record_id/feishu_record_id.

## Alignment with app 090e859

The current app treats used_count as a traversal cursor. Selection uses the lowest used_count frontier after readiness and de-duplication; it must not fall back to older used_count tiers just to fill a quiz. QUESTION_POOL_EXHAUSTED means ready questions exist but the current unused frontier cannot fill a set; QUESTION_CACHE_NOT_READY means the ready pool itself is insufficient or not ready. Stage 1 mirrors used_count as observed data only. A future DB write path must use an atomic increment (used_count = used_count + 1), keep Feishu as the read authority during dual-write, and reconcile counts before any cutover.

The app 090e859 review-meaning cleanup affects newly generated type-4 questions. Existing long correct_answer values are not backfilled by Stage 1.

## Source protection

The sync now requires question_text, options, and answer field keys before accepting a Feishu row. If more than 20% of the source rows lack this cache shape, it hard-fails with NOT_QUESTION_CACHE_SOURCE before any Supabase upsert. Individual malformed cache rows are skipped and reported with invalidRecordIds and invalidReasonCounts. used_count is deliberately not used as a source-shape signal because the mapper defaults it to zero.
