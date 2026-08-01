# Question Cache Source Policy Implementation Plan

> For agentic workers: execute each task in order with a test checkpoint.

Goal: Add a safe question-cache source policy to the Supabase-backed data source without changing production behavior by default.

Architecture: Keep all policy logic at the data-source boundary. The existing Supabase adapter remains the DB implementation; the existing Feishu adapter supplies the Feishu implementation. Compare mode returns Feishu rows and emits bounded metadata only.

Tech Stack: Node.js CommonJS, node:test, existing Feishu and Supabase adapters.

## Global Constraints

- Default and invalid WORDBOT_CACHE_SOURCE values must preserve the current DB-backed behavior.
- compare mode must return Feishu rows.
- No writes, deletes, truncates, schema changes, or secret logging.
- DB comparison failures must not replace the Feishu result in compare mode.
- Run backend tests before commit and do not change Render variables in this phase.

---

### Task 1: Add failing source-policy tests

Files:
- Modify: backend/test/data-source.test.js
- Modify: backend/data-source.js

Interfaces:
- Add a test helper that sets and restores WORDBOT_CACHE_SOURCE.
- Test the exported Supabase data source getQuestionCache behavior through loadDataSource.

- [ ] Write tests for default/db, feishu, compare, invalid, and compare failure behavior.
- [ ] Run node --test backend/test/data-source.test.js.
- [ ] Confirm the new tests fail because the source variable is not consumed.

### Task 2: Implement source selection

Files:
- Modify: backend/data-source.js

Interfaces:
- Add normalizeCacheSource(value) returning db, feishu, or compare; invalid values become db.
- In loadSupabaseDataSource, wrap the existing Supabase getQuestionCache.
- In db mode return the existing Supabase rows.
- In feishu mode return loadFeishuDataSource().getQuestionCache(username, level, roundType).
- In compare mode read both, return Feishu rows, and emit only counts plus missing IDs in a bounded warning.

- [ ] Implement the smallest adapter-level change.
- [ ] Run the focused data-source tests and confirm they pass.
- [ ] Run backend syntax checks.

### Task 3: Regression verification

Files:
- No additional production files.

- [ ] Run node --test backend/test/data-source.test.js backend/test/supabase-data.test.js backend/test/server-contract.test.js.
- [ ] Run node --test backend/test/*.test.js.
- [ ] Run git diff --check.
- [ ] Commit with feat: add question cache source policy.

### Task 4: Push and deployment verification

Files:
- No source changes.

- [ ] Push codex/reliability-engineering.
- [ ] Verify GitHub Actions Deploy backend to Render.
- [ ] Verify /api/health.
- [ ] Do not set WORDBOT_CACHE_SOURCE in Render during this phase.