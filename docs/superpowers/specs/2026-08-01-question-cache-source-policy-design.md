# Question Cache Source Policy

## Goal

Add an explicit, testable policy for question-cache reads in the Supabase-backed application. Production behavior must remain unchanged until an operator deliberately changes the environment variable.

## Design

The policy is implemented at the data-source boundary, where quiz generation already calls dataSource.getQuestionCache.

- WORDBOT_CACHE_SOURCE=db reads the existing Supabase question cache.
- WORDBOT_CACHE_SOURCE=feishu reads the existing Feishu question cache.
- WORDBOT_CACHE_SOURCE=compare reads both sources, returns Feishu rows as the user-visible result, and emits a bounded reconciliation summary without logging secrets or full row payloads.
- When the variable is absent or invalid, preserve the current Supabase-backed behavior by using db.

The rest of the Supabase data source remains unchanged. Cache source failures in compare mode do not replace the Feishu result; a missing comparison side is recorded in diagnostics. DB mode remains strict and returns its existing error behavior.

## Safety

The implementation does not write to either source, does not delete or truncate rows, and does not change production environment variables. The first deployment only makes the policy available and defaults to the current DB behavior.

## Verification

Unit tests cover db, feishu, compare, invalid/default values, bounded diff summaries, and compare-mode failure behavior. Existing backend contract and reliability tests must remain green.