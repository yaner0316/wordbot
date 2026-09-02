# Runtime Tooling Inventory

This inventory describes tracked backend executables as reviewed on 2026-09-02.
It is a classification only: this change does not run, move, or delete any tool.

## Production Runtime

- `backend/server.js`: the only application entry point (`npm start`).
- `backend/http-app.js`, `backend/data-source.js`, and `backend/supabase-*.js`:
  production request and persistence path.
- `backend/question-generation-*.js`: durable question-generation worker path.

Production code must remain Supabase-only. `backend/test/production-runtime-contract.test.js`
enforces that `server.js` and `data-source.js` do not import Feishu runtime modules.

## Supported Operator Tools

- `scripts/apply-question-generation-migrations.js`: explicit operator-only
  migration command; never called by normal startup.
- `scripts/verify-question-generation-schema.js`: read-only schema verification.
- `scripts/audit-question-generation-backlog.js` and
  `scripts/audit-question-cache-semantics.js`: read-only diagnostics.
- `scripts/audit-legacy-question-cache-ai.js`,
  `scripts/backfill-question-generation-jobs.js`, and
  `scripts/reconcile-mastery-status.js`: guarded maintenance tools; require
  explicit operator review and are not deployment actions.
- `scripts/verify-public-health-release.js`: public, read-only release check.

## Compatibility And Historical Tools

- `feishu.js`, `config.js`, `data/feishu-client.js`,
  `data/feishu-repositories.js`, and `data/repository-factory.js` are retained
  compatibility code, not production imports.
- Root-level `add_*`, `fill_*`, `fix_*`, `merge_*`, `setup-*`, `test_*`,
  `debug_*`, `batch_fix.js`, and `delete-yusi-words.js` are historical or
  manual tools. They are archive candidates only after a separate, path-by-path
  review; this PR deliberately leaves them untouched.
- `backfill*.js`, `smoke-test*.js`, and `reset-parent-credentials.js` can alter
  external data or credentials. They are never deployment steps.

## Review Rule

Before moving or archiving any listed file, confirm its callers with `rg`, add
or update a focused contract test, and obtain an explicit path-by-path review.
