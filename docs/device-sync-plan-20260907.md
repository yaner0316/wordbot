# Cross-device synchronization repair — 2026-09-07

Scope: keep the 30-day difficulty policy and expose its existing deadline clearly. Reuse the existing game_states and quiz_challenges tables; no new synchronization infrastructure or schema migration.

Implementation:
- Game state reads include the existing updated_at revision. Writes require the revision and compare it atomically; stale/legacy writes return a visible conflict. Game actions read fresh state and only commit local state after the server accepts. Formal quiz rewards are credited on the server once per test ID, under the same compare-and-swap protection, including submission replays. Scoring/reward amounts stay unchanged.
- Quiz progress carries an incrementing revision inside existing session_state JSON. Updates compare the stored JSON atomically and reject stale revisions. Serialize this device's saves; surface failures. Continue and focus refresh prefer cloud state. Preserve a local draft on failure rather than silently claiming success. Resuming through /quiz must honor returned answers and cursor.
- Refresh settings and game state on page focus/visibility/online and home entry. Display the existing difficulty cooldown deadline; prevent confusing save attempts.

Verification: targeted two-client stale-write tests for both data adapters, reward idempotency/replay, frontend VM behavior tests for remote-first restore, failure messages, serialized saves and focus refresh. Existing CI gates run on the resulting PRs. No repeat whole-project audit. Stop after affected tests, deployment checks and one bounded cross-device acceptance pass.
