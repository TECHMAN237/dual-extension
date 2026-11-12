# DOUALA AI

**AI-powered browser extension that translates website interfaces from English or French into Douala (Duálá, `dua`), grounded in real linguistic resources.**

DOUALA AI is a working prototype, not a mock-up: a Chrome (Manifest V3) extension scans a page, sends the translatable text to a secure backend, and the backend translates it with a retrieval-augmented pipeline that consults a provenance-tracked Douala knowledge base before asking an AI model. Every translation carries a categorical evidence level, the references that supported it, and can be corrected by users from inside the extension. Original page content can always be restored.

The long-term vision is to make the internet accessible in African languages; version 1 focuses on Douala and is architected so other Cameroonian languages can be added.

## Principles

- **No invented Douala.** The knowledge base ships with sources and term lists but *zero* fabricated translations. With an empty knowledge base the model is instructed to decline rather than guess; declined segments keep their original text and are flagged for review.
- **Evidence, not fake confidence.** Results are labelled *High / Moderate / Low / Unverified evidence*, derived from the references actually used.
- **Secrets stay on the server.** The extension never holds an AI key. The backend validates its configuration on startup, rate-limits, validates every input and output, and talks to Anthropic/OpenAI through swappable adapters.
- **Humans in the loop.** Extracted entries and user corrections are *pending* until a linguist approves them in the admin page.

## Quick start (5 minutes, no API key)

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
├── supabase/migrations/    PostgreSQL schema + RLS (+ optional pgvector)
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
| `docs/DEPLOYMENT.md` | Local and cloud (Render + Supabase) modes |

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev:backend` | Backend with hot reload (reads `apps/backend/.env`) |
| `pnpm build:extension` / `pnpm dev:extension` | Build (or watch-build) the extension into `apps/extension/dist` |
| `pnpm typecheck` · `pnpm test` · `pnpm build` | Workspace-wide checks |
| `pnpm ai:test-connection` | Verify the configured AI provider |
| `pnpm ingest --source <id> --url <url> --lang fr` | Ingest a linguistic resource (see `docs/LINGUISTIC_RESEARCH.md`) |
| `pnpm --filter @douala-ai/backend seed` | Seed the source registry into the configured store |
| `pnpm e2e:live` | Live end-to-end check (built content script + backend, needs Playwright Chromium) |
| `scripts/verify.sh` | Install + typecheck + test + build + live e2e |

## Status and limitations

See the *Known limitations* section of `docs/TESTING.md` and the end of `docs/LINGUISTIC_RESEARCH.md`. In short: the linguistic resources shared by email could not be fetched from the build environment, so the knowledge base contains no Douala translations yet; the pipeline, ingestion tools and review workflow are ready for them.

## License

MIT — see `LICENSE`. Third-party linguistic resources keep their own licences; check them before ingesting.
