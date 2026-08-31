# Backend Release SHA Verification Implementation Plan

**Goal:** Prove that the public backend running on Render is the exact reviewed Git commit that GitHub Actions deployed.

**Architecture:** `runtime-health.js` derives a sanitized release descriptor from Render's documented `RENDER_GIT_COMMIT`. `server.js` includes it in the existing public health response. A dependency-free Node CLI performs a read-only health request and validates the expected SHA; the main-branch deploy workflow calls that CLI after the deploy hook with bounded retry settings.

**Tech Stack:** Node.js 22+, Express, node:test, GitHub Actions, Render.

## Global Constraints

- Use only `GET` requests in public smoke verification.
- Do not read, print, or add secrets.
- Do not run migrations, backfills, repairs, cache operations, or data mutations.
- Do not alter game rewards or authentication behavior.
- A missing or malformed release SHA is observable but does not change application health.

## File Structure

- `backend/release-info.js`: validates and exposes the safe release descriptor.
- `backend/runtime-health.js`: adds the descriptor to health output.
- `backend/scripts/verify-public-health-release.js`: read-only CLI for expected-SHA polling.
- `backend/test/release-info.test.js`: unit tests for safe release metadata.
- `backend/test/verify-public-health-release.test.js`: local HTTP tests for smoke success and rejection paths.
- `backend/test/deploy-workflow-contract.test.js`: asserts post-deploy smoke wiring and bounded polling.
- `.github/workflows/render-deploy.yml`: invokes the verifier after the deploy hook on `main`.
- `docs/RENDER_DEPLOYMENT.md`: documents the release verification gate.

## Tasks

1. Write failing release-info tests for a full SHA, missing SHA, and malformed values.
2. Run the release-info test and confirm it fails before implementation.
3. Add the smallest release-info module and append its safe output to runtime health.
4. Run the release-info and runtime-health tests.
5. Write failing CLI tests using local HTTP servers for matching, unhealthy, and mismatched release responses.
6. Run the CLI tests and confirm they fail before implementation.
7. Add the dependency-free CLI with fixed request timeout and bounded retry controls supplied by the workflow.
8. Run the CLI tests.
9. Extend the deploy-workflow contract test first, asserting the main-only post-hook verifier and current `${{ github.sha }}`.
10. Update the workflow and deployment documentation, without changing the deploy hook or deployment scope.
11. Run focused tests, then the full backend suite with its checked-out frontend contract inputs.
12. Review the PR diff for scope and secret exposure, commit, push the branch, and create the PR.

## Verification

Run from `backend`:

```powershell
node --test test/release-info.test.js test/verify-public-health-release.test.js test/deploy-workflow-contract.test.js test/runtime-health.test.js
```

Then run the existing full backend suite with the reviewed frontend contract paths. The deployed verification is complete only after GitHub Actions succeeds and the public `/api/health` reports the merged SHA.
