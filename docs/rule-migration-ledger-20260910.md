# Rule migration ledger — 2026-09-10

## Decision

Exactly three files govern the project:

| Authority | Owns | Must not own |
|---|---|---|
| `PROJECT.md` | Product purpose, domain invariants, authorization semantics, definition of done | Shell/tool preferences and step-by-step operations |
| `AGENTS.md` | Engineering execution, scope, safety, testing, repository boundaries | Duplicate product policy |
| `docs/OPERATIONS.md` | Runtime, migration, recovery, release and production evidence | Product-learning decisions |

Subsystem designs remain supporting specifications. Dated audits, plans, handoffs, and test reports remain historical evidence. A thin pointer in another repository is allowed but is not a fourth authority.

## Existing-file disposition

| Existing file or group | Classification | Disposition |
|---|---|---|
| Previous `AGENTS.md`, `user_rules.md`, root `CLAUDE.md`, `.trae/rules/project_rules.md` | Overlapping/stale execution rules | Applicable rules are absorbed into the new `AGENTS.md`; do not edit Claude configuration in this work. Retire duplicates in separately reviewed cleanup. |
| Recovered untracked historical `PROJECT.md` | Useful product/release skeleton | Product flow and release proof are absorbed into the authoritative tracked `PROJECT.md`; the historical file remains evidence. |
| `docs/learning-audit-review-20260905.md`, `docs/mastery-principle-correction-20260905.md` | Current evidence/supporting policy record | Keep; authoritative invariants now live in `PROJECT.md`. |
| Semantic-audit, selected-sense and reward specifications | Active subsystem specifications | Keep and link to `PROJECT.md` when next edited. |
| `docs/quiz-generation-policy.md` | Corrupted/stale | Superseded by `PROJECT.md`; retain until separate cleanup confirms no unique recoverable content. |
| Dated schema plans, migration acceptance, generation plans and handoffs | Historical evidence | Keep out of the authority chain; archive or prune only after a uniqueness review. |
| Duplicate root/app handoff copies | Byte-identical duplicates | Eligible for later cleanup, not deleted in this repair. |
| Release/deployment/checklist/runbook documents | Operational support with overlap | Standing rules move to `docs/OPERATIONS.md`; retain provider-specific detail until merged incrementally. |

## Current repair ledger

| Requirement | Baseline defect | Evidence target | Status |
|---|---|---|---|
| All non-mastered, non-deleted meanings are targets | Quiz queue filters on historical meaning Level | Queue regression test | Implemented; locally verified |
| Current user level controls supply | Loader uses current level, but queue/readiness can exclude old-Level meanings | Runtime, queue and controller tests | Implemented; locally verified |
| At least two current-policy AI-approved variants | Manual backfill and some SQL checks do not fully enforce attestation | Coverage policy/controller and migration tests | Implemented; locally verified |
| No terminal generation failure | JS and SQL move jobs to `needs_manual_review` | Job and migration regression tests | Implemented; locally verified |
| Persist and resume partial/stage work | Valid candidates and expensive stage outputs exist only in memory | Checkpoint, stage and lease-guard tests | Implemented; locally verified |
| Continuous coverage | Existing backfill is operator-triggered | Idempotent periodic controller and health evidence | Implemented; locally verified |

Production apply/deploy status is recorded separately because local code completion does not authorize live changes.

## Encapsulation decision

Keep this workflow project-local for now. The reusable boundary is the coverage policy + controller, durable checkpoint module/RPC, ordered migration verifier, and this operations runbook. A global Codex Skill would encode WordBot-specific schema and product semantics, create a second rule surface, and has no proven second consumer. Reconsider only after another project needs the same staged-generation protocol with materially shared inputs and lifecycle rules.

## Local verification evidence

- Branch/worktree: `codex/coverage-controller-repair-20260910` in the isolated coverage-controller worktree; the pre-existing dirty application worktree was not modified.
- Coverage, retry, checkpoint, migration, queue, lifecycle, and integration focused group: 175/175 passed. After the final meaning-identity correction, the affected checkpoint/service/runtime/cache group passed 46/46.
- Modified production JavaScript syntax checks: 12/12 passed.
- Full backend command: 1133 tests total; 1123 passed, 7 skipped, and 3 failed before running product assertions because old cross-repository tests reference absent hard-coded frontend worktree paths (`.worktrees/web` and `.worktrees/qiuqiu-parent-repair-web-20260811`). No new or affected product/database test failed.
- Production migrations, deployment, live SHA verification, and real-user flow were not run; they remain explicit operator/release actions under `docs/OPERATIONS.md`.
