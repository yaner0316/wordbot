# Mandatory selected-sense entry

User-approved scope: every new-word entry, including batches, must select actual offered senses; remove handwritten gloss entry. The subsequent explicit instruction authorizes deployment and one separate 10-word experiment. No data rewrite or production question-generation change is authorized.

Design: reuse the dictionary sense list and selection UI. Query each distinct spelling, preserve selections on failures, require at least one selection per word, and submit only after all words are resolved. The backend issues a signed, user/word/sense-bound receipt with each offered sense and verifies the whole batch before calling storage. Client-supplied meanings cannot override the receipt. Both plural entry routes and the legacy singular route enforce this contract. Existing administrative meaning editing must not become a bypass. Native client entry follows the same contract.

No database migration, extra provider, or new dependency. Reuse the existing session signing configuration. A receipt proves an option was offered; it does not certify the model-generated dictionary definition itself.

Implementation plan (writing-plans, executed directly within the authorized scope):
- [x] Add failing behavior checks for batch/manual bypass and API rejection.
- [x] Add signed dictionary selection receipts and enforce all public entry routes; preserve ownership and parent-role checks.
- [x] Make web batch selection mandatory; preserve input and selected choices across failed lookups/submission; remove handwritten prompts.
- [x] Update native entry and disallow handwritten meaning edits.
- [x] Run focused tests, then repository-required regression suites and build/syntax checks. Record results and limitations here.
- [x] Update PROJECT.md and operations notes; stop after reviewable code and verification, without modifying production data or generation policy.

Bases: backend 38242741a8473e0b072dac6cb9ace1b7de9223b9; web fc0525582bad17bac621887509c69a6a511eaef0. Isolated branches: fix/required-senses-20261113 in both repositories.

Verification, 2026-11-13:
- Observed original failures: web batch and handwritten inputs saved directly; server accepted an unselected payload (200 instead of 422).
- Backend full suite after installing lockfile dependencies and setting the two existing cross-repo contract paths: 1405 passed, 7 conditionally skipped, 0 failed (1412 total). No production database used. Final API/receipt changes additionally receive focused reruns.
- Web full suite: 327 passed, 2 obsolete assertions failed (they required manual gloss entry/client-selectedSenseFlow). Updated those contracts and ran their full affected files: 125 passed. Subsequent entry-state regression: 22 passed. All previously failing cases resolved; no unexamined failures.
- Native logic: 7 passed; App.js parsed successfully with the existing Babel JSX parser. No emulator/device run.
- Web static build and syntax/diff checks passed. Local build used the base SHA solely to satisfy the build contract; it is not release evidence and must be rebuilt with the eventual published SHA.
- Receipts cannot use the public development signing key in production; the existing session/admin secret must be configured. Dictionary meanings are still provider-generated; signing attests the offered selection, not factual correctness.
- Signed batches validate before storage. A selected-entry retry skips saved meanings and repairs a missing generation job, with regression coverage. No schema changes or production writes.

Evidence logs: `D:/Projects/04-Wordbot-开发任务/artifacts/context-comparison-20261113/required-senses-*.log`. Pending: deployment and actual authenticated production flow verification, plus native device verification. No automatic changes to existing words or question-generation policy.
