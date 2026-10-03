# WordBot Release Checklist

Use this checklist with [`PROJECT.md`](../PROJECT.md) and [`docs/OPERATIONS.md`](OPERATIONS.md) as the authorities for product behavior and production/data operations.

## Runtime and verification

- Supported Node.js range: `>=22 <25`.
- Run the focused regression tests while developing, then the applicable repository suite before handoff. The release workflow runs the main-branch checks; do not treat a local health response as release proof.
- Backend local setup and tests are documented in `docs/OPERATIONS.md`.
- The web repository has its own test and deploy workflow. Only a push to its `main` branch triggers the production Render hook; that workflow verifies the public release marker against the triggering commit.

## Database changes

Follow the ordered migration, verification, and operator-authorization procedure in [`docs/OPERATIONS.md`](OPERATIONS.md). This checklist intentionally does not duplicate the migration inventory: use the current registered migration runner and CI workflow, not a copied list of migration filenames or startup-time DDL.

## Isolated smoke procedure

For a local smoke check, use a disposable Supabase environment and a synthetic test account that contains no real learner data. Keep the backend pointed at that disposable environment and start it locally. Register the account, then immediately open a protected user view without logging in again to confirm registration issued a working child session. Separately log out and log back in, then use the local web build to exercise quiz load, answer, submit, result, and history. Confirm the account and data are synthetic before sending any write request. Never substitute a real child's account or production URL into a copied curl command.

Production user-flow verification is a separate release-evidence step. Follow the authorization and readback requirements in `PROJECT.md` and `docs/OPERATIONS.md`; test-account creation or learning-data writes in production require explicit authorization.

## Rollback

Rollback the application through the normal repository and deployment workflow. Database rollback is a separate reviewed operation; retain additive migration evidence and use a forward-compatible correction where needed. See `docs/OPERATIONS.md` for worker, lease, recovery, and data-safety boundaries.
