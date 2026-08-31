# Release SHA and Public Smoke Design

## Goal

Make a deployed backend identify the reviewed Git commit it is running, and
make the deployment workflow prove that the public health endpoint reports
that exact commit. The verification must use only public, read-only HTTP
requests.

## Scope

This is PR5A, the backend half of the release-verification work. A follow-up
frontend PR will publish its own static release marker and verify it with the
same read-only smoke helper.

## Design

Render provides `RENDER_GIT_COMMIT` at runtime. The backend will expose a
`release` object in its existing public health response:

```json
{
  "release": {
    "commit": "<40 lowercase hexadecimal characters>",
    "source": "render"
  }
}
```

Only a full Git SHA is accepted. Missing, malformed, or non-Render values are
reported as `commit: null` and `source: "unknown"`; no environment value is
echoed. Release identity is informational and does not change health status.

A small Node CLI will request one supplied public health URL with `GET`. It
requires an HTTP 200 response, `ok: true`, and an exact match between the
expected SHA and `release.commit`. It uses no credentials, sends no request
body, does not perform login, and makes no database or cache calls.

The backend deployment workflow will run the existing tests first, trigger the
existing Render deploy hook only for `main`, then poll the public health URL
with the current GitHub commit SHA for a bounded period. A green deployment job
therefore means the public backend, rather than merely GitHub, acknowledged
the reviewed release.

## Alternatives Considered

1. Put the GitHub SHA in a Render secret: rejected because release provenance
   should be supplied by the deployment platform, not manually maintained.
2. Trust a successful deploy-hook response: rejected because it only confirms
   that Render accepted the request, not that the new revision is live.
3. Use authenticated application endpoints for smoke tests: rejected because
   they can affect rate limits and application state.

## Tests

Tests will cover SHA sanitization, health response shape, successful and
failed public-smoke responses, and the workflow contract for bounded
post-deploy verification. No migration, backfill, repair, cache action, or
user-data mutation is part of this PR.
