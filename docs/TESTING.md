# Testing

All results below were produced by actually running the commands in the build environment (Node 22, pnpm 10, Chromium via Playwright) on 2026-11-12.

## Commands

```bash
pnpm typecheck            # tsc in every package/app
pnpm test                 # vitest in every package/app
pnpm build                # backend bundle (tsup) + extension (vite/crxjs)
node scripts/e2e-live.mjs # live end-to-end: built content script + real backend (mock provider)
scripts/verify.sh         # all of the above in sequence
```

## Results

| Suite | Files | Tests | Result |
| --- | --- | --- | --- |
| `packages/shared` | 1 | 8 | passed |
| `packages/linguistic-knowledge` | 2 | 16 | passed |
| `packages/translation-engine` | 1 | 13 | passed |
| `apps/backend` | 2 | 22 | passed |
| `apps/extension` (vitest + jsdom, `chrome` stubbed) | 5 | 20 | passed |
| **Unit / integration total** | **11** | **79** | **all passed** |
| Live end-to-end (`scripts/e2e-live.mjs`, headless Chromium + backend) | 1 | 21 checks | **21/21 passed** |

Typecheck: clean in all five projects. Builds: `apps/backend/dist` (tsup, ~110 KB bundle + admin page + seed) and `apps/extension/dist` (crxjs, manifest + popup + options + service worker + IIFE content script) both succeed.

## What is covered

### Shared (`packages/shared/test`)
- Untranslatable detection (URLs, emails, numbers, identifiers), lookup normalisation (accents, punctuation).
- EN/FR detection including the `html lang` hint.
- Batch schema: duplicate ids rejected, defaults applied.

### Linguistic knowledge (`packages/linguistic-knowledge/test`)
- Ranking: exact > sub-phrase > overlap; verified > pending; de-duplication; language filter; rejected entries excluded.
- Evidence derivation: high (exact verified), moderate (exact, established unverified), unverified (no target).
- Ingestion: CSV with empty targets, HTML tables / definition lists / custom selectors (scripts ignored), JSON arrays and `{entries}`, "word — gloss" lines, provenance + pending status + duplicate removal, robots.txt evaluation.
- Seed data: the four resources from the research email are registered; **every seeded term has a null target** (no invented Douala).

### Translation engine (`packages/translation-engine/test`)
- Verified exact references short-circuit the model with high evidence and references attached.
- Skips untranslatable items, de-duplicates identical texts, caches results (second call makes no provider request).
- Auto-detects French.
- Recovers from one malformed output by retrying; reports provider errors per item; retries only retryable errors (429) up to `maxRetries`; uses the fallback model when the primary fails.
- Caps model-claimed evidence by actual reference support.
- Output parser (fences, missing ids), translation validator (placeholders preserved), router tiers, case matching, retry policy.

### Backend (`apps/backend/test`)
- Config: defaults, missing-key error, verified Anthropic model ids and overrides, Supabase pairing, production rules, **no secrets in the config summary**.
- API: health, languages, scan analysis, batch validation (empty, duplicate ids, oversize item), batch translation with references / skipped items / history recording (history contains no page text), single translate, knowledge search, correction submit → status → admin approve → promoted to verified knowledge → reused deterministically, manual ingest + knowledge review flow, 404 envelope, 413 for oversized bodies.
- Security: extension access token (401 without, health exempt), admin token (401 wrong/missing), per-client rate limiting (429 envelope), CORS allow-list (extension origin allowed, arbitrary site denied).
- Provider failures: per-item `error` status with a safe message, partial results still returned with HTTP 200.

### Extension (`apps/extension/test`)
- Scanner: headings, paragraphs, buttons, links, placeholders, alt, title; exclusions (script, style, code, pre, hidden, password, contenteditable, notranslate, URLs, numbers); context inference; unique ids.
- Translator: applies `translated` results only, preserves whitespace and DOM structure (child counts, listeners), exact restore, restore skips nodes changed by the site, multiple cycles.
- Observer: new nodes detected once (fake timers), own mutations ignored, identical text reuses cached translation without a request, disconnect stops detection.
- Popup: brand renders, source-language select persists, Scan sends `SCAN`, counts shown, Translate sends `TRANSLATE`, Restore enabled when translated, mock banner.
- Storage: client id generated once, history capped at 50 and free of page text.

### Live end-to-end (`scripts/e2e-live.mjs`)
Starts the bundled backend (mock provider), loads a test page in headless Chromium, injects the **built** content script and drives it with the same messages the background worker sends. Verifies: scan count and language detection, translation of headings / nested inline elements / buttons / placeholders / alt text, exclusion of `notranslate`, `code`, URLs and numbers, DOM structure and event listeners intact, dynamic content inserted after translation is translated with exactly one extra request and identical text reused, corrections list populated, exact restoration, second translate/restore cycle, no page errors.

This check found a real bug the jsdom tests missed (`setTimeout` invoked with the wrong `this` in the MutationObserver debounce threw "Illegal invocation" in Chrome). It is fixed and the check now passes 21/21.

## Not tested (honest gaps)

- **Real AI providers**: no API key was available in the build environment, so Anthropic/OpenAI adapters are exercised only through typed SDK calls and error mapping; run `pnpm ai:test-connection` with your key.
- **Supabase**: the Supabase store and repositories are implemented against the migration schema but were not executed against a live database (no credentials). The memory backend, which shares the ranking and API layers, is fully tested.
- **Chrome extension runtime** (popup ↔ service worker ↔ tab messaging, `chrome.scripting` injection): covered by unit tests with a `chrome` stub and by the live content-script check, not by an automated test that loads the unpacked extension in a persistent Chromium profile. Manual steps are in `docs/INSTALLATION.md`.
- The four linguistic websites from the research email were unreachable from the build environment; the ingestion pipeline is tested on synthetic HTML/CSV/JSON/text only.
