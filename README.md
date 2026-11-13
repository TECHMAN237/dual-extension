# DOUALA AI

**AI-powered browser extension that translates website interfaces from English or French into Douala (Duálá, `dua`), grounded in real linguistic resources.**

DOUALA AI is a working prototype, not a mock-up: a Chrome (Manifest V3) extension scans a page, sends the translatable text to a secure backend, and the backend translates it with a retrieval-augmented pipeline that consults a provenance-tracked Douala knowledge base before asking an AI model. Every translation carries a categorical evidence level, the references that supported it, and can be corrected by users from inside the extension. Original page content can always be restored.

The long-term vision is to make the internet accessible in African languages; version 1 focuses on Douala and is architected so other Cameroonian languages can be added.

## Principles

- **No invented Douala.** The knowledge base (`data/knowledge/douala.json`, versioned in Git) contains only entries imported from real dictionary pages (Wiktionary, Mboa Sawa), each with the exact URL of its page, and *zero* fabricated translations. All of them are *pending* until a Duala speaker reviews them. Where no evidence exists the model is instructed to decline rather than guess; declined segments keep their original text and are flagged for review.
- **Evidence, not fake confidence.** Results are labelled *High / Moderate / Low / Unverified evidence*, derived from the references actually used.
- **Secrets stay on the server.** The extension never holds an AI key. The backend validates its configuration on startup, rate-limits, validates every input and output, and talks to Anthropic/OpenAI through swappable adapters.
- **Humans in the loop.** Extracted entries and user corrections are *pending* until a linguist approves them in the admin page.

## Using it (online server)

The backend runs on Render (`render.yaml`, `docs/DEPLOYMENT.md`) and loads the knowledge base from the versioned file `data/knowledge/douala.json` (no database). The extension uses that server by default, so no local server is needed:

```bash
pnpm install
cp apps/extension/.env.production.example apps/extension/.env.production   # VITE_DEFAULT_BACKEND_URL = Render URL
pnpm build:extension                                                       # → apps/extension/dist
```

Load `apps/extension/dist` in Chrome (below). On Render's free plan the first request after 15 minutes of inactivity wakes the server (≈ 30–60 s); the popup shows *Réveil du serveur…* meanwhile.

## Quick start for development (5 minutes, no API key)

`pnpm dev:backend` is only for development: it runs the backend on your machine.

```bash
pnpm install
cp .env.example apps/backend/.env       # AI_PROVIDER=mock by default
pnpm dev:backend                         # backend on http://localhost:8787
pnpm build:extension                     # → apps/extension/dist
```

Then in Chrome: `chrome://extensions` → *Developer mode* → *Load unpacked* → select `apps/extension/dist`. Open a website, click the DOUALA AI icon, **Scan page**, **Translate page**. In mock mode translations are visibly labelled `[MOCK dua] …`; set `AI_PROVIDER` and `AI_API_KEY` in `apps/backend/.env` for real AI translation (see `docs/AI_CONFIGURATION.md`).

Full, non-developer instructions: **`docs/INSTALLATION.md`**.

## Repository layout

```
douala-ai/
├── apps/
│   ├── extension/          Chrome MV3 extension (Vite + React + TypeScript)
│   └── backend/            Fastify API, admin page, CLIs (ingest, seed, ai:test-connection)
├── packages/
│   ├── shared/             Language registry, Zod API contracts, text utils, EN/FR detection
│   ├── linguistic-knowledge/  Knowledge stores (memory/Supabase), retrieval, ingestion, seed registry
│   └── translation-engine/ Provider adapters (Anthropic/OpenAI/mock), RAG prompt, router, orchestrator
├── data/knowledge/         douala.json: the knowledge base, versioned in Git (+ README: licences)
├── supabase/migrations/    Optional future storage (not used): PostgreSQL schema + RLS
├── docs/                   Architecture, research, configuration, API, security, testing, deployment
├── scripts/                verify.sh (full check), dev.sh
├── render.yaml             Render blueprint for the backend
└── .env.example            Backend environment template (placeholders only)
```

## Documentation

| Document | Content |
| --- | --- |
| `docs/INSTALLATION.md` | Step-by-step setup and Chrome loading |
| `docs/AI_CONFIGURATION.md` | Providers, keys, models, routing strategy, testing the connection |
| `docs/LINGUISTIC_RESEARCH.md` | Gmail investigation, every discovered resource, reliability, licensing, next steps |
| `docs/ARCHITECTURE.md` | Monorepo, pipeline, knowledge model, extension design |
| `docs/DATABASE.md` | Schema, RLS, setup, retrieval |
| `docs/API.md` | REST endpoints and payloads |
| `docs/SECURITY.md` | Trust boundaries and controls |
| `docs/TESTING.md` | What is tested and how to run it |
| `docs/DEPLOYMENT.md` | Production (Render, knowledge base in Git, extension default URL) and development modes |
| `data/knowledge/README.md` | The versioned knowledge base: format, licences, attribution |

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev:backend` | Development only: local backend with hot reload (reads `apps/backend/.env`). Not needed with the Render server |
| `pnpm build:extension` / `pnpm dev:extension` | Build (or watch-build) the extension into `apps/extension/dist` |
| `pnpm typecheck` · `pnpm test` · `pnpm build` | Workspace-wide checks |
| `pnpm ai:test-connection` | Verify the configured AI provider |
| `pnpm ingest --source <id> --url <url> --lang fr` | Ingest a linguistic resource (see `docs/LINGUISTIC_RESEARCH.md`) |
| `pnpm ingest:site --site mboasawa\|wiktionary-fr\|wiktionary-en [--dry-run]` | Crawl a dictionary with its dedicated, rate-limited extractor into `data/knowledge/douala.json` |
| `pnpm ingest --source manual-linguist-entries --file <glossaire.csv> --lang fr --format csv --verified` | Import a glossary filled in by a Duala speaker as verified entries (`data/knowledge/README.md`) |
| `pnpm coverage:check [--file texts.txt] [--mode assisted\|strict]` | Show how each text would be translated (dictionary / assisted / original kept), without calling the model |
| `pnpm --filter @douala-ai/backend seed` | Seed the source registry into the configured store |
| `pnpm e2e:live` | Live end-to-end check (built content script + backend, needs Playwright Chromium) |
| `pnpm e2e:extension` | Loads the real unpacked extension in Chromium and runs Scan, Translate, Restore |
| `scripts/verify.sh` | Install + typecheck + test + build + live e2e |

## Status and limitations

See the *Known limitations* section of `docs/TESTING.md` and the end of `docs/LINGUISTIC_RESEARCH.md`. In short: the linguistic resources shared by email could not be fetched from the build environment, so the knowledge base contains no Douala translations yet; the pipeline, ingestion tools and review workflow are ready for them.

## License

MIT — see `LICENSE`. Third-party linguistic resources keep their own licences; check them before ingesting.
