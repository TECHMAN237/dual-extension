# Deployment

Two modes are supported. Local mode is enough to develop, test and demo; cloud mode is for sharing the backend with other users of the extension.

## Local mode (no cloud account needed)

```bash
pnpm install
cp .env.example apps/backend/.env       # keep AI_PROVIDER=mock, or set a real provider + key
pnpm dev:backend                         # http://localhost:8787 (hot reload)
pnpm build:extension                     # apps/extension/dist → load unpacked in Chrome
```

- Storage: in-memory + `apps/backend/data/local-knowledge.json`.
- Mock provider: no key, placeholder output, full UI flow.
- Real provider: set `AI_PROVIDER` + `AI_API_KEY`, run `pnpm ai:test-connection`.
- Admin page: http://localhost:8787/admin/ (no token needed on localhost unless `ADMIN_API_TOKEN` is set).

## Cloud mode

### 1. Supabase

Follow `docs/DATABASE.md`: run `supabase/migrations/0001_initial.sql`, copy `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

### 2. Backend on Render

Option A — Blueprint: push the repository to GitHub, then Render → *New* → *Blueprint* → pick the repo. `render.yaml` defines the service. Fill `AI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` in the dashboard (they are marked `sync: false`). `ADMIN_API_TOKEN` and `EXTENSION_ACCESS_TOKEN` are generated.

Option B — manual Web Service:

| Setting | Value |
| --- | --- |
| Runtime | Node 20+ |
| Build command | `corepack enable && corepack prepare pnpm@10.28.0 --activate && pnpm install --frozen-lockfile && pnpm --filter @douala-ai/backend... build` |
| Start command | `pnpm --filter @douala-ai/backend start` |
| Health check | `/api/health` |
| Env vars | everything from `.env.example`; `NODE_ENV=production`, `PORT=10000` (Render's default) |

Production rules enforced by `loadConfig`: `AI_PROVIDER` must not be `mock`, `ADMIN_API_TOKEN` must be set. Render provides HTTPS automatically.

After deployment:

```bash
curl https://<your-service>.onrender.com/api/health
```

Seed the source registry once: open a Render shell (or run locally with the cloud `.env`) and execute `pnpm --filter @douala-ai/backend seed`.

### 3. Point the extension at the cloud backend

Extension → Settings (gear icon) → *Backend URL* = `https://<your-service>.onrender.com`, *Access token* = the value of `EXTENSION_ACCESS_TOKEN`, then *Test connection*.

### 4. Harden

- Set `CORS_ALLOWED_ORIGINS=chrome-extension://<your-extension-id>` (the id is shown on `chrome://extensions`).
- Keep `RATE_LIMIT_MAX` conservative; monitor `/api/admin/usage`.
- Rotate `ADMIN_API_TOKEN` / `EXTENSION_ACCESS_TOKEN` from the Render dashboard; the service restarts automatically.

## Other hosts

Any Node 20+ host works: build with `pnpm --filter @douala-ai/backend... build`, deploy `apps/backend/dist` together with `node_modules`, run `node dist/index.js`. A `Dockerfile` is not included; a minimal one would copy the workspace, run `pnpm install --prod=false && pnpm build:backend` and start `node apps/backend/dist/index.js`.

## Publishing the extension

`pnpm build:extension` produces `apps/extension/dist`. Zip that folder for the Chrome Web Store. Before publishing, set the default backend URL in the extension settings to your cloud URL (users can still change it), and pin CORS on the backend.
