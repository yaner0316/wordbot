# WordBot Release Checklist

Use this checklist before publishing the current staged release.

## 1. Environment

Create `backend/.env` from `backend/.env.example` and fill the required Feishu values:

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_WORD_APP_TOKEN`
- `FEISHU_WORD_TABLE_ID`
- `FEISHU_TEST_APP_TOKEN`
- `FEISHU_TEST_TABLE_ID`
- `FEISHU_STATS_APP_TOKEN`
- `FEISHU_STATS_TABLE_ID`

Optional:

- `FEISHU_DIST_APP_TOKEN`
- `FEISHU_DIST_TABLE_ID`
- `MINIMAX_API_KEY`
- `WORDBOT_GAME_REWARD_EXCELLENT_MINUTES`
- `WORDBOT_GAME_REWARD_PERFECT_MINUTES`

Then verify the local environment before starting the server:

```powershell
cd D:\Projects\04-Wordbot-开发任务\app\backend
npm.cmd run check:env
```

The command exits with code `1` and prints `missing` when required values are absent.

## 2. Feishu Schema

Run the review-field setup once before release:

```powershell
cd D:\Projects\04-Wordbot-开发任务\app\backend
npm.cmd run setup:review-fields
```

Expected result on a configured table:

```text
已存在: assessment_kind
已存在: source_test_id
已存在: parent_review_id
已存在: review_round
已存在: review_status
已存在: source_question_id
```

## 3. Automated Verification

Backend:

```powershell
cd D:\Projects\04-Wordbot-开发任务\app\backend
npm.cmd test
node --check server.js
node --check http-app.js
node --check feishu.js
node --check runtime-health.js
node --check game-reward.js
```

Frontend:

```powershell
cd D:\Projects\04-Wordbot-开发任务\web
node --test test/*.test.cjs
node --check src/app.js
node --check src/quiz-logic.js
node --check src/review-flow.js
```

Repository checks:

```powershell
cd D:\Projects\04-Wordbot-开发任务\app
git diff --check

cd D:\Projects\04-Wordbot-开发任务\web
git diff --check
```

## 4. Health Check

After starting the backend, open:

```text
http://localhost:5000/api/health
```

Release only when:

- `ok` is `true`
- `missing` is an empty array
- all required `env` values are `true`

## 5. Manual Smoke Test

Use `file:///D:/Projects/04-Wordbot-开发任务/web/index.html?demo=1` for local preview, then repeat on the published URL.

Check:

- Start a formal quiz.
- Select question-language difficulty.
- Answer all questions and select confidence on every question.
- Confirm answer explanations list all four Chinese meanings.
- Confirm wrong answers require viewing explanations before review.
- Start review and confirm the review question differs from the source question.
- Submit review and choose continue or defer.
- Confirm first score stays unchanged in the final summary.
- Confirm 9/10 or 10/10 first score shows the game-time reward card.
- Switch to test mode, answer a quiz, then clean test-mode records.

## 6. Data Safety

- Formal learning data updates mastery and statistics.
- Test mode writes isolated records and can be cleaned.
- Review records keep real/test mode.
- Review rounds do not increment first-quiz statistics.
- Game rewards are calculated from the first quiz score only.

## 7. Rollback Notes

If release has to be rolled back:

- Stop the new backend process.
- Restore the previous backend and frontend build.
- Do not delete Feishu review fields; they are additive and harmless to older code.
- Test-mode rows can be removed with the admin cleanup action.

