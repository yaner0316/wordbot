-- Operator action: use only for the explicitly authorized production wake-up job.
-- Existing pg_cron and pg_net are required; no extensions or secrets are created.
-- This is not part of automatic schema migrations.
select cron.schedule(
  'wordbot-worker-wakeup',
  '*/10 * * * *',
  $$select net.http_get(
    url := 'https://wordbot-1-w9il.onrender.com/api/health',
    timeout_milliseconds := 90000
  );$$
);

-- Disable without deleting its history:
-- select cron.alter_job((select jobid from cron.job where jobname='wordbot-worker-wakeup'), active := false);
