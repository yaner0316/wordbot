# Supabase Render Deployment

This prepares WordBot to run with Supabase as the primary backend data source. Do not remove the Feishu environment variables yet if you want rollback and legacy admin/review endpoints to keep working.

## Render Environment Variables

Add these variables in the Render service environment:

```bash
DATA_SOURCE=supabase
SUPABASE_URL=https://...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
DATABASE_URL=postgresql://...
```

Keep `SUPABASE_SERVICE_ROLE_KEY` server-side only. Do not expose it in frontend code.

## Deployment Steps

1. Review and merge the Gate 5 code changes.
2. Push the branch to GitHub.
3. Let Render auto-deploy the updated backend service.
4. Open Render logs and confirm the backend starts without missing environment variable errors.

## Rollback Plan

Set this Render environment variable and redeploy:

```bash
DATA_SOURCE=feishu
```

Leave the existing Feishu variables configured in Render so the rollback path can read Bitable data immediately.

## Post-Deployment Smoke Test

Call the quiz API for `qiuqiu` and verify the response is sourced from Supabase data:

```bash
curl -X POST "$RENDER_BACKEND_URL/api/quiz" \
  -H "Content-Type: application/json" \
  -d "{\"user\":\"qiuqiu\",\"level\":\"中学\",\"mode\":\"real\"}"
```

Expected result:

- HTTP 200 when the Supabase question cache has enough ready rows.
- Response includes `source: "question_cache"` and `diagnostics.dataSource: "supabase"`.
- Questions should match records migrated into Supabase, not newly read Feishu rows.
