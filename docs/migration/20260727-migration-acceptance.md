# WordBot migration acceptance baseline - 2026-07-27

This document records the read-only audit baseline. No production write, schema apply, cutover, or deployment was performed.

## Completed

- Supabase stats adapter now provides `getStats` and `getAllStats`.
- Supabase mode no longer uses Feishu stats fallback.
- Relevant backend tests and `server-contract.test.js` pass.
- Current production tables: `users`, `words`, `assessments`, `question_cache`, `quiz_sessions`.

## Current data baseline

- Feishu users: 8 raw user keys; DB users: 5.
- Feishu words: 455; DB words: 514.
- Feishu assessments: 2615; DB assessments: 2740.
- Feishu question cache: 745; DB question cache: 290.
- Feishu-only user keys requiring classification: `test_user1`, `explorer_user_01`, `create`.
- DB-native words: 66; DB-native assessments: 155.
- Feishu word records absent from DB by record id: 7.
- Feishu assessment records absent from DB by record id: 30.

The counts are not an automatic merge instruction. The Feishu-only rows must be classified before import; `create` is a likely malformed source value. DB-native rows may be valid post-migration writes and must not be deleted.

## Cache decision gate

The cache gap is expected to include disposable DB-generated variants. Do not import all 745 Feishu rows blindly. Before any cache write, classify source rows by cache shape, compare by user/level/round/status, and choose either a controlled merge or regeneration. Keep `WORDBOT_CACHE_SOURCE=db` unchanged until the comparison is approved.

## Schema gaps

The proposed idempotent SQL is in `20260727-schema-gaps.sql`:

- `quiz_sessions.updated_at`
- `assessments.parent_review_id`
- parent-review lookup index
- quiz-session timestamp trigger
- PostgREST schema reload notification

It is not applied. Production application requires explicit approval, backup evidence, service-role-only execution, schema-cache verification, and rollback instructions.

## Required next acceptance evidence

1. Classify the three Feishu-only user keys and seven missing word records.
2. Explain the 30 Feishu assessment records absent from DB.
3. Reconcile the 745 versus 290 question cache rows without delete/truncate/drop.
4. Apply schema gaps only after approval, then verify columns, RLS, grants, and API smoke tests.
5. Deploy only after the database evidence and app regression suite are reviewed.