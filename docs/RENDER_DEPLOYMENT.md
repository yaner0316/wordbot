# Render Deployment

This repository is configured for a Render backend service through a GitHub
Actions deploy hook.

## Render service settings

- Service type: Web Service
- Repository: `yaner0316/wordbot`
- Branch: `codex/reliability-engineering`
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`

The root `package.json` starts the backend with `node backend/server.js`. The
server already listens on `process.env.PORT`, which Render provides at runtime.

## Required Render environment variables

Set these in the Render dashboard for the backend service:

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_APP_TOKEN`
- `FEISHU_WORD_TABLE_ID`
- `FEISHU_TEST_TABLE_ID`
- `MINIMAX_API_KEY`

Add any optional table or option-id overrides that your Feishu base needs.

## GitHub Actions deploy hook

In Render, open the backend service and copy its Deploy Hook URL. In GitHub,
add it as a repository secret:

- Repository: `yaner0316/wordbot`
- Secret name: `RENDER_DEPLOY_HOOK_URL`
- Secret value: the Render Deploy Hook URL

After that, every push to `codex/reliability-engineering` or `main` triggers a
Render deploy. You can also run the workflow manually from GitHub Actions.
