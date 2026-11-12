# Security architecture

## Trust boundaries

```
 Web page (untrusted)          Extension (user's browser)            Backend (trusted, holds secrets)        AI provider / Supabase
 ───────────────────   DOM    ──────────────────────────   HTTPS    ────────────────────────────────  HTTPS  ──────────────────────
 text nodes, attributes ───►  content script (read/replace  ───►   Fastify API: validation, rate      ───►   Anthropic / OpenAI
                              text only, never innerHTML)           limits, CORS, admin token,                Supabase (service role)
                              background worker (fetch)             RAG prompt with "data, not
                              popup/options (settings)              instructions" framing
```

- **Web page content is untrusted data.** The scanner reads text nodes and a short allow-list of attributes; it never evaluates page scripts, never follows instructions in page text, and the LLM prompt states that segments and references are untrusted data.
- **The extension holds no server secrets.** It stores only settings, an anonymous client id, local history (domain + counts) and ids of submitted corrections. The optional access token is a client credential, not the AI key.
- **The backend is the only component with `AI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.** They are read from the environment, validated on startup, redacted from logs and never returned by any endpoint (`describeConfig` exposes booleans only).

## Extension

- Manifest V3; permissions limited to `activeTab`, `scripting`, `storage`. **No `host_permissions`**: access to a page is granted per tab when the user clicks the extension, and the content script is injected programmatically. Nothing runs on pages the user did not act on.
- Content script protections: excludes `script`, `style`, `noscript`, `code`, `pre`, `textarea`, SVG, `contenteditable`, password fields, `translate="no"`/`.notranslate`, hidden/`aria-hidden` content; skips URLs, emails, numbers and identifiers; preserves DOM structure, attributes, listeners and node identity (text nodes are updated via `nodeValue`, attributes via `setAttribute` on the same element).
- Restoration only reverts nodes whose current value is still the value the extension set; the registry is cleared and disconnected observers prevent leaks.
- History never stores page text.

## Backend

| Control | Implementation |
| --- | --- |
| Input validation | Every route parses body/query/params with Zod schemas from `@douala-ai/shared` (length limits, enums, unique ids, batch size/character caps). |
| Output validation | LLM output parsed with Zod; per-item `validateTranslationText` guards against empty/implausible/placeholder-breaking output. Invalid output never reaches the page. |
| Secrets | Startup validation (`loadConfig`), `.env` git-ignored, log redaction of auth headers, no secrets in error responses. |
| CORS | Allow-list from `CORS_ALLOWED_ORIGINS` (default `chrome-extension://*`; pin your extension id in production). Methods and headers restricted. |
| Request size | `bodyLimit` (256 KB default) → `413`. |
| Rate limiting | `@fastify/rate-limit`, keyed by IP + client id; `429` envelope. Correction quota of 200/day per client. |
| Authentication | Optional `EXTENSION_ACCESS_TOKEN` (constant-time comparison) for public routes; `ADMIN_API_TOKEN` required for admin routes (localhost-only fallback in development, mandatory in production). |
| Error handling | Uniform envelope; stack traces logged server-side only; `500` message is generic. |
| Security headers | `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Cache-Control: no-store`, restrictive CSP on API responses. |
| Provider calls | Timeouts, bounded retries, concurrency limit; refusals handled; model ids configurable; no provider SDK code in the extension. |
| Ingestion | `politeFetch` honours robots.txt, uses a descriptive User-Agent, refuses non-http(s), caps size, treats 401/403/429 as "restricted — not bypassed". HTML is parsed with cheerio (no script execution). |
| Logging | Pino; request logs exclude bodies; translation text is not logged. |

## Database (Supabase)

- RLS enabled on every table; `anon`/`authenticated` can read only languages, sources and **verified** knowledge. Corrections, history, settings and usage have no public policies.
- The backend uses the service role; the anon key is never shipped.
- Constraints enforce length limits and the "verified requires a translation" invariant.

## Privacy

- Translation requests carry page text segments (necessary to translate) and the domain (for history/context). No URLs with query strings, cookies or user-entered form values are sent; password fields and editable content are excluded at scan time.
- The client id is random and local; clearing extension data rotates it.
- History (local and server) stores domain, languages, counts and status only.

## Known gaps / recommendations before public deployment

1. Pin `CORS_ALLOWED_ORIGINS` to the published extension id.
2. Set `EXTENSION_ACCESS_TOKEN` if the backend is public, or add Supabase Auth and per-user quotas.
3. Replace in-memory rate limiting with a shared store (Redis) when running more than one instance.
4. Add an embedding provider only after reviewing the data-processing terms of that provider.
5. Review third-party resource licences before ingestion (see `docs/LINGUISTIC_RESEARCH.md`).
