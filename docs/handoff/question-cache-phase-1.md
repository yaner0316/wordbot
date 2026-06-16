# Question Cache Design

## Goal

Move expensive quiz preparation out of the child-facing quiz request path. The child quiz endpoint should prefer ready cached questions and fall back to live generation when the cache is not configured or does not have enough questions.

## Product Rules

- Learning level is managed in the parent console.
- A user defaults to `中学` when no setting exists.
- A parent can change the level at most once every 30 days.
- Changing the level marks question cache status as `building`.
- Each meaning record should have two cached questions:
  - `primary`: normal quiz question
  - `review`: backup question for wrong-answer review

## User Setting Fields

Phase 1 stores these fields on the user's word records to avoid introducing a new required table immediately:

- `Learning_Level`: `小学` / `中学` / `高中` / `CET4_6_TOEFL`
- `Level_Changed_At`: timestamp in milliseconds
- `Question_Cache_Status`: `not_started` / `building` / `partial` / `ready` / `failed`

Future migration target: a dedicated user settings table.

## QUESTION_CACHE Table

Configured by optional environment variables:

- `FEISHU_QUESTION_CACHE_APP_TOKEN`
- `FEISHU_QUESTION_CACHE_TABLE_ID`

Recommended fields:

- `user`
- `word_record_id`
- `word`
- `question_type`: `1` / `2` / `3`
- `level`: `小学` / `中学` / `高中` / `CET4_6_TOEFL`
- `round_type`: `primary` / `review`
- `question_text`
- `suffix`
- `options`
- `answer`
- `option_meanings`
- `correct_meaning`
- `quality_status`: `pending` / `ready` / `failed` / `stale`
- `ai_audit_status`: `pending` / `passed` / `failed` / `skipped`
- `used_count`
- `last_used_at`
- `generated_at`
- `source_version`

## Current Implementation

- `GET /api/admin/questionCache/status` reports cache counts for a user.
- `POST /api/admin/questionCache/rebuild` creates primary/review rows when the cache table is configured.
- `POST /api/quiz` prefers 10 ready primary cached questions for the user's current learning level.
- If the cache table is missing or fewer than 10 ready questions exist, `/api/quiz` falls back to the existing live generation path.
