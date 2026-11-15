# Scheduled worker wake-up

Goal: let the existing Render worker continue preparing questions without an open browser.

Scope: one GitHub Actions workflow and its operations instructions. Use the existing public health endpoint and durable generation queue. No model, prompt, retry, database, frontend or learning-policy change. No new paid service or credential.

Design: GitHub cron at minutes 7/17/27/37/47/57 of every hour plus manual dispatch. A bounded HTTPS request wakes the backend; validate the service identity and worker configured/running state. Log only safe operational counters. A successful wake does not prove question generation succeeded. Do not reset attempts or bypass provider backoff.

Execution:
- [ ] Create the workflow with read-only permissions, one concurrent run and a five-minute timeout.
- [ ] Validate YAML and embedded JavaScript; check healthy, stopped-worker and invalid-service responses with disposable fixtures.
- [ ] Publish only workflow/docs changes to main, suppressing unrelated push CI/deployment for this configuration-only commit. Dispatch the workflow manually and inspect its result.
- [ ] Record workflow activation and actual worker observation. Stop after the manual run; GitHub owns future scheduling.

Limits: schedule events may be delayed/dropped. Public-repository schedules can be disabled after 60 days without repository activity. Render free-instance quotas still apply; provider rate limiting is unchanged. Standard hosted runners for this public repository are free under GitHub's current billing rules.

Evidence: project-root artifacts/worker-wakeup-20261115/.
