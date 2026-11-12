# Installation guide

This guide is written for someone who is comfortable opening a terminal but not necessarily a developer. Every command is run from the project folder (the one containing `package.json`).

## What you need

- **Node.js 20 or newer** — https://nodejs.org (LTS). Check with `node --version`.
- **pnpm** — after installing Node run `corepack enable` (included with Node) or `npm install -g pnpm`. Check with `pnpm --version`.
- **Google Chrome** (or Edge/Brave; the instructions below are for Chrome).
- Optional: an **AI API key** (Anthropic or OpenAI). Without one, the project runs in *mock mode*, which exercises the whole interface with clearly labelled placeholders.

## Step 1 — Install dependencies

```bash
pnpm install
```

## Step 2 — Configure the backend

```bash
cp .env.example apps/backend/.env
```

Open `apps/backend/.env` in a text editor.

- To try the interface without a key, leave `AI_PROVIDER=mock`.
- For real translations, set `AI_PROVIDER=anthropic` (or `openai`) and paste your key into `AI_API_KEY=`. See `docs/AI_CONFIGURATION.md` for models and options.
- Leave the Supabase lines empty for now (local mode). See `docs/DATABASE.md` when you want cloud storage.

Test the AI connection (optional, only with a real provider):

```bash
pnpm ai:test-connection
```

## Step 3 — Start the backend

```bash
pnpm dev:backend
```

You should see `Server listening at http://0.0.0.0:8787`. Check it in a browser: http://localhost:8787/api/health. Leave this terminal open.

The administration page is at http://localhost:8787/admin/ (lists linguistic sources, pending vocabulary, community corrections and usage).

## Step 4 — Build the extension

In a second terminal:

```bash
pnpm build:extension
```

This creates the folder `apps/extension/dist`.

## Step 5 — Load the extension in Chrome

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the folder `apps/extension/dist` (inside the project folder).
5. "DOUALA AI" appears in the list. Click the puzzle-piece icon in Chrome's toolbar and pin **DOUALA AI** so its icon stays visible.

## Step 6 — Translate a website

1. Open any English or French website (for example a news site).
2. Click the **DOUALA AI** icon. The status dot shows *Connected* (or *Mock mode*). If it shows *Offline*, check that the backend from Step 3 is still running.
3. Click **Scan page**: the popup shows the domain, the detected language and the number of translatable elements.
4. Choose the source language if auto-detection got it wrong, then click **Translate page**. A progress bar shows translated elements; "kept original" counts segments where there was not enough linguistic evidence.
5. Click **Restore original** to put the page back exactly as it was.
6. Open the **Corrections** tab to view each translation, its evidence level and references, and to suggest a better Douala translation. Submitted corrections show *pending* until a reviewer approves or rejects them on the admin page.
7. The **History** tab lists past translations (domain, languages, date, counts). No page text is stored.

Because the extension uses the `activeTab` permission, it only accesses a page after you click the icon on that tab. Some pages (Chrome's own pages, the Web Store, PDFs) do not allow extensions.

## Reloading after a rebuild

Whenever you run `pnpm build:extension` again:

1. Go to `chrome://extensions`.
2. Click the circular **reload** arrow on the DOUALA AI card (or press the reload icon next to "Developer mode" to reload all).
3. Reload the web page you are testing (press F5) so the new content script is used.

If the popup looks stale, close and reopen it.

## Settings

Click the gear icon in the popup (or right-click the extension icon → *Options*) to change:

- Backend URL (default `http://localhost:8787`) and an optional access token — use these after deploying the backend to the cloud.
- Default source language, auto-detection, dynamic-content translation, corrections, history retention.
- "Clear local data" removes history, settings and the anonymous client id.

AI provider keys are **never** entered in the extension; they live only in `apps/backend/.env`.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Popup shows *Offline* | Backend not running, or wrong Backend URL in Settings. Run `pnpm dev:backend`. |
| Backend exits with "Configuration problems" | Read the message: usually `AI_API_KEY` is missing for the chosen provider, or Supabase variables are incomplete. |
| Translations are `[MOCK dua] …` | You are in mock mode. Set `AI_PROVIDER` and `AI_API_KEY`, restart the backend. |
| Most segments say "kept original" with a real provider | Expected while the knowledge base is empty: the model is told not to invent Douala. Import verified vocabulary via the admin page or `pnpm ingest`. |
| `429 Too many requests` | Rate limit reached; wait a minute or raise `RATE_LIMIT_MAX`. |
| CORS error in the extension console | Add your extension id to `CORS_ALLOWED_ORIGINS` (default `chrome-extension://*` allows all). |
| Chrome says "Manifest file is missing" | You selected the wrong folder; pick `apps/extension/dist`, not `apps/extension`. |
