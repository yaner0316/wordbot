# WordBot Development Workflow

## Branch roles

- `main` is the only production release branch and the only branch tracked by Render.
- Each change starts from the current `origin/main` in a fresh worktree.
- One branch and one PR own one concern. Do not combine frontend, backend, database, and data repair work in one PR.
- A branch that deletes or replaces large parts of the current architecture is treated as an obsolete experiment until reviewed file by file.

## Merge gates

Before merging a PR:

1. Confirm the branch was rebased or merged from current `origin/main`.
2. Review the file list and reject unexpected deletes, generated data, secrets, and unrelated refactors.
3. Run the focused tests, then the relevant backend/frontend suites.
4. For database changes, run idempotence tests and a read-only production schema check.
5. For user-facing changes, verify login, word entry, quiz load, submit, and feedback on the deployed build.
6. Merge through a PR. Do not push a local merge directly to `main` without the checks above.

## Database rules

- Versioned migrations are code; production data repair is a separately reviewed operation.
- Startup migrations must be idempotent, transactional, and fail closed.
- A migration failure must report its migration filename and safe PostgreSQL diagnostics, never credentials or row values.
- Read-only mirror/reconcile tooling stays out of the runtime path until dry-run output, schema reconciliation, and rollback boundaries are accepted.
- Never run a broad delete, truncate, drop, or mastery reconciliation as a deployment side effect.

## Release sequence

```text
fresh branch from origin/main
  -> focused tests
  -> PR review and CI
  -> merge to main
  -> Render deploy from main
  -> health/schema check
  -> one controlled user-flow smoke test
  -> announce release
```

## Branch cleanup

- After a PR is merged or rejected, archive the branch and remove its worktree only after confirming no uncommitted work remains.
- Keep at most one active branch per production issue.
- Historical branches are evidence, not candidates for automatic merge.
