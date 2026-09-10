# WordBot Agent Rules

## Scope and authority

- This file governs engineering work in this repository. Product truth belongs in `PROJECT.md`; production and data procedures belong in `docs/OPERATIONS.md`.
- Precedence is: current explicit user instruction, `PROJECT.md`, this file, active subsystem specifications, then dated plans and handoffs.
- Do not copy product rules into several files. Update the authoritative file and link to it.

## Working method

- Protect uncommitted user work. Use an isolated worktree for multi-file changes and start from the current `origin/main` unless the user names another base.
- Diagnose before changing behavior. For a bug or behavior change, add a focused failing test, observe the expected failure, make the smallest implementation change, then run affected and full regression suites.
- Keep changes scoped. Directly related low-risk defects may be repaired; unrelated findings are recorded instead of bundled.
- Prefer existing modules, migrations, scripts, and runbooks. Do not add frameworks, dependencies, abstraction layers, or monitoring for hypothetical needs.
- Preserve durable partial work. A retry resumes from the earliest invalid or missing generation stage and invalidates only dependent downstream stages.

## Repository boundaries

- `backend/` is the authoritative Node.js service and Supabase integration.
- Frontend behavior lives in the separately versioned WordBot web repository. If a change affects API shape, question rendering, quiz state, level display, parent access, or result semantics, inspect and verify both repositories. State explicitly when no frontend change is required.
- Dated plans, audit reports, migration notes, and handoffs are evidence, not standing product authority.

## Safety and data

- Production storage is Supabase. Do not introduce a second production source of truth or silently fall back to legacy Feishu data.
- Never hard-code or print credentials, tokens, provider responses, or raw child data.
- Schema changes use versioned SQL migrations and the existing migration verifier. Applying a migration, backfill, bulk rewrite, cache deletion, or mastery reconciliation is an explicit operator action; code preparation alone does not authorize it.
- Preserve immutable assessment evidence. Corrections use versioned/reconcilable projections rather than editing historical answers.
- Parent-only mutations must remain server-authorized. Child-facing responses expose safe status codes, not internal diagnostics.

## Verification and release

- Supported runtime: Node.js `>=22 <25`.
- Install: `npm install`; backend tests: `npm --prefix backend test`; syntax: `node --check <file>`.
- Run focused tests first, then the full backend suite. Database migrations additionally require migration contract tests and schema verification against an explicitly selected environment.
- A change is not released because tests pass or GitHub accepted a commit. Release proof requires the intended `main` SHA, successful CI/deploy, the live backend SHA, and the affected real production flow.
- The product definition of done is in `PROJECT.md`. A health endpoint alone is never proof that the learning flow works.

## Documentation maintenance

- Product or policy changes update `PROJECT.md` before or with code.
- Operational changes update `docs/OPERATIONS.md` before or with scripts/migrations.
- Record temporary execution state in one dated plan or handoff; do not create a new top-level rules file.
- Do not modify Claude configuration or shared skills as part of WordBot project work.
