# Architecture

## Overview

```
┌──────────────────────────── Browser ────────────────────────────┐    ┌──────────────── Backend (Node/Fastify) ────────────────┐
│ Popup (React)  ──msg──►  Background service worker  ──HTTPS──►  │    │  /api/translate/batch                                   │
│   scan / translate /      • injects content script (activeTab)   │    │     │                                                   │
│   restore / corrections   • batches & sends API requests         │    │     ▼  Translation orchestrator (packages/translation-engine)
│   history / settings      • relays progress                      │    │   1 language detection   5 retrieval (RAG)              │
│        ▲                         │                               │    │   2 normalisation        6 model routing (fast/capable) │
│        │                         ▼ msg                           │    │   3 untranslatable skip  7 LLM call (provider adapter)  │
│ Options page (React)    Content script                            │    │   4 dedupe + cache       8 Zod validation + evidence     │
│                          • TreeWalker scanner                     │    │     ▼                                                   │
│                          • registry of original values            │    │  Knowledge store (packages/linguistic-knowledge)          │
│                          • MutationObserver (dynamic content)     │    │   memory+JSON  |  Supabase (pgvector optional)            │
│                          • restore                                │    │  Repositories: corrections, history, usage               │
└──────────────────────────────────────────────────────────────────┘    └──────────────────────────────────────────────────────────┘
                                                                                     │ adapters: Anthropic | OpenAI | Mock
```

## Monorepo

| Path | Package | Role |
| --- | --- | --- |
| `packages/shared` | `@douala-ai/shared` | Language registry, evidence levels, **Zod schemas = API contract**, text utilities, EN/FR detection. Used by both the extension and the backend. |
| `packages/linguistic-knowledge` | `@douala-ai/linguistic-knowledge` | `KnowledgeStore` interface, in-memory (JSON-persisted) and Supabase stores, retrieval/ranking, evidence derivation, ingestion pipeline (HTML/PDF/CSV/JSON/text, polite fetch), seed registry. |
| `packages/translation-engine` | `@douala-ai/translation-engine` | Engine config, provider adapters (Anthropic, OpenAI, Mock), prompt builder, structured output validation, cache, retry/backoff, concurrency limiter, model router, orchestrator. |
| `apps/backend` | `@douala-ai/backend` | Fastify API, env validation, security plugins, repositories, admin page, CLIs (`ingest`, `seed`, `ai:test-connection`). Bundled with tsup for Render. |
| `apps/extension` | `@douala-ai/extension` | Chrome MV3 extension (Vite + React + crxjs): popup, options, background worker, content script. |
| `supabase/migrations` | — | SQL schema, RLS policies, optional pgvector. |
| `docs/` | — | This documentation. |

Dependency direction: `extension → shared`, `backend → engine → knowledge → shared`. The extension never imports provider SDKs.

## Translation pipeline (backend)

1. **Validate** the request (`translateBatchRequestSchema`): ≤60 items, ≤20k chars, unique ids.
2. **Resolve the source language**: explicit, or stop-word detection over the whole batch (`detectSourceLanguage`).
3. **Normalise** whitespace and **skip** untranslatable items (URLs, emails, numbers, identifiers) → `status: skipped`.
4. **De-duplicate** identical `(text, context)` pairs and check the **cache** (LRU + TTL).
5. **Retrieve references** for each remaining item (`retrieveReferences`): candidates from the store → lexical scoring (exact / sub-phrase / overlap) × quality (validation status, origin, reliability) → top-N.
6. **Short-circuit**: an exact, *verified* reference with a target is applied directly (case-matched) with evidence `high`, no model call.
7. **Route**: remaining items are partitioned into `fast` and `capable` batches (`router.ts`) and sent concurrently through the provider adapter with timeout, retry/backoff, malformed-output retry and fallback model.
8. **Validate** the structured output (Zod) and each translation (`validateTranslationText`).
9. **Derive evidence**: the model's claimed level is capped by what the references actually support (`deriveEvidenceLevel`); `needsReview` is set for `low`/`unverified`; declined items become `uncertain` and keep the original text.
10. **Assemble** results in request order, fan out duplicates, cache successes, record history/usage.

## Knowledge model

A single `linguistic_knowledge` entity (category-discriminated) keeps vocabulary, expressions, grammar rules, conjugation rules, sentence examples, translation pairs, contextual meanings and language variants together with full provenance (`source_id`, `source_name`, `source_url`, `reference`, `extracted_at`) and trust metadata (`origin`, `validation_status`, `reliability`). `linguistic_sources` is the registry of resources. Corrections live in their own tables and are promoted into knowledge only on approval.

## Extension design

- **Permissions**: `activeTab`, `scripting`, `storage` only. The content script is injected on demand when the user clicks *Scan page*, so no site is touched without a user action.
- **Scanner**: `TreeWalker` over text nodes + an allow-list of attributes (`placeholder`, `title`, `alt`, `aria-label`), strict exclusions (scripts, styles, code, editable/password fields, hidden/`aria-hidden`, `notranslate`), context inference from ancestors (heading, button, navigation, link, …), stable ids per segment.
- **Apply/restore**: text nodes are updated via `nodeValue`, attributes via `setAttribute`; a registry keeps the original value for each segment; restore only reverts values still equal to what the extension wrote; multiple cycles supported; disconnected nodes are pruned.
- **Dynamic content**: a `MutationObserver` (debounced 400 ms, self-mutation suppressed) queues new eligible segments; identical text in the same interface context reuses the local result with no request; incremental batches go through the same backend endpoint. SPA navigation is detected on `popstate` and at each observer flush (content scripts cannot reliably wrap `history.pushState` from the isolated world): the session prunes detached nodes and the popup asks for a rescan.
- **Batching**: the content script's `PageSession` builds requests of ≤60 items / ≤20,000 characters, collapses identical `(text, context)` pairs, and runs two requests concurrently. The background worker is a thin, authenticated fetch proxy (it adds the client id and optional access token) and writes local history entries (domain, languages, counts, status only).
- **State & messaging**: popup → background (`SCAN`, `TRANSLATE`, `RESTORE`, `GET_STATE`, `LIST_TRANSLATIONS`, `OPEN_OPTIONS`, `API_HEALTH`, `API_SUBMIT_CORRECTION`, `API_CORRECTION_STATUS`) → content script (`CS_PING`, `CS_SCAN`, `CS_TRANSLATE`, `CS_RESTORE`, `CS_GET_STATE`, `CS_LIST_TRANSLATIONS`); content → background (`API_TRANSLATE_BATCH`, `API_SCAN_ANALYZE`, `SESSION_COMPLETE`, `GET_SETTINGS`); content → popup broadcast `PROGRESS` with a `SessionSnapshot` (counts and status, never page text). Replies use `{ ok: true, data } | { ok: false, error, code }`. Settings, client id, history and submitted correction ids live in `chrome.storage.local`.

## Extensibility: adding a language

1. Add the entry to `LANGUAGES` in `packages/shared/src/languages.ts` (and to `TARGET_LANGUAGE_CODES` / `SOURCE_LANGUAGE_CODES`).
2. Insert the row in `languages` (SQL) and seed sources for it.
3. Extend `buildSystemPrompt` with language-specific grammar guidance if needed.
4. The schemas, stores, retrieval, UI selects and API accept the new code automatically.

## Key decisions

- **Categorical evidence instead of fake probabilities**: evidence is derived from reference support and capped, never from a model's self-reported confidence alone.
- **Declining is a feature**: with an empty knowledge base, a real model is told to return `null` rather than invent Douala. The UI keeps the original text and flags it.
- **Provider adapters + env config**: swapping Anthropic/OpenAI/mock or changing models is configuration, not code.
- **Memory mode first**: everything works without Supabase; the cloud path is additive.
- **Single knowledge table with views** instead of eight near-identical tables: simpler retrieval and provenance, same conceptual entities exposed as views.
