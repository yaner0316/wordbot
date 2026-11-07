# Current question-chain repair — 2026-11-07

Baseline: backend GitHub main and live Render SHA both `13ea099ecc56dc1b19f7eb5e7ab89b996e9f1889`, verified before implementation. This branch starts at that commit and preserves PR59's English-stem generation admission fix.

The live path is server → question-generation-bootstrap → question-generation-runtime → buildCacheQuestionRowsForWord → auditUniqueAnswer. Actual Chinese translations were absent from all review requests and existing fingerprints, grammar exclusions could approve malformed distractors, and the second review received the first review's reasons. Reproductions use this current commit, not archived source. Surface-overwrite and content-policy-forwarding defects belonged to the unpublished candidate and are not described as pre-existing live fields.

Changes bind exact printed options, meanings and translation to evidence; pass that evidence requirement through both generation entry points and checkpoint reuse; retain valid stages after a translation/gloss failure; and remove first-review hints from the second review. Existing compatible published caches retain compatibility. The paired frontend preserves reviewed capitalization.

Validation: five targeted current-main regressions failed before integration. After integration, 69 affected tests passed. An additional normalized-cache canonical-meaning regression failed, was fixed, and its 11 affected tests passed. The frontend country-name regression failed on current frontend main and its 34-test file passed after the one-line fix. Earlier full-suite results and bounded model examples remain in the existing local task artifacts; no repeated full data audit was started. Required PR CI remains the release gate.

Data repair is separately authorized and tracked outside Git under `artifacts/question-chain-20261105/`. Do not commit private question snapshots. Published replacement rows preserve originals and historical assessments, with per-batch rehearsal, commit and readback receipts. Model rate limits stop batches without blind retries. Six lexical corrections and the remaining questions still require their own receipts.

Release verification must record backend/frontend main commits, successful CI/deploy, public release SHAs and an affected authorized test-account flow. Passing local tests is not deployment completion. This task does not modify the cleanup conversation's credential handling, old PR, branch retirement or workflow triggers.
