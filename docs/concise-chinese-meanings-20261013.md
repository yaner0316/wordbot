# Concise Chinese meanings — 2026-10-13

User approved the short-phrase examples and authorized implementation, historical cleanup and publication.

Design: Chinese meaning labels use short translation words/phrases, usually 2–8 characters and at most 20 per saved label. Preserve every existing concept, including qualified uncommon meanings; remove explanatory prose and examples. Do not mechanically truncate, split meaning identities, or rewrite historical answers.

Plan:
- [x] Observe focused failing regressions for provider output, record creation/editing, and maintenance backfill.
- [x] Add one shared length policy to enforce the 20-character cap at all persistence boundaries; strengthen the translation prompt. Existing sense lookup already has this cap.
- [x] Normalize the 58 current historical labels from the reviewed fixed local plan. Start with chief/citizen samples, read back, then process the remaining same-scope records. Use exact owner, old label, English meaning, edit timestamp and active-row conditions; store original snapshots and per-row receipts. This is a semantics-preserving label cleanup: retain English definitions, mastery, assessment history and generation versions, and do not initiate a cache rebuild.
- [x] Run affected tests, one complete backend suite, and incremental readbacks only. Inspect existing frontend rendering; no API shape or frontend code change is expected.
- [ ] Push focused PR, verify CI, merge and deploy. Read public SHA and authenticated word-query flow. Stop when the cleanup and release are verified.

Private evidence and rewrite plan remain in the calling workspace tmp/concise-meanings-20261013; no learner data in GitHub. No external model calls for historical cleanup.

Validation: six focused regressions initially had five expected failures; all six now pass. Affected data/translation/maintenance/dictionary tests: 171 passed, 4 existing skips. One complete backend run: 1252 passed, 7 existing skips, 0 failures. Two live cleanup samples and the remaining 56 labels were read back successfully; their English definitions, identity, mastery, timestamps of entry, generation versions and stored assessment rows remain unchanged. Normalization used no external model request and did not enqueue a cache rebuild. Frontend rendering and error handling already consume the saved label/message; no frontend code change.
