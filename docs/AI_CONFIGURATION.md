# AI configuration

The extension never talks to an AI provider directly. The backend (`apps/backend`) holds the only API key and exposes `/api/translate/*`. Provider and model are chosen with environment variables: **no source code changes are needed**.

## 1. Where to put the key

1. Copy `.env.example` to `apps/backend/.env`.
2. Edit these lines:

```ini
AI_PROVIDER=anthropic        # anthropic | openai | openrouter | mock
AI_API_KEY=sk-ant-...        # your secret key (backend only)
AI_MODEL=                    # optional override of the capable model
AI_FAST_MODEL=               # optional override of the fast model
AI_FALLBACK_MODEL=           # optional fallback model
AI_BASE_URL=                 # optional custom endpoint / gateway
```

`apps/backend/.env` is git-ignored. Never paste the key in the extension, in `CORS_ALLOWED_ORIGINS`, in logs or in Supabase.

## 2. Where to obtain a key

| Provider | Console | Notes |
| --- | --- | --- |
| Anthropic | https://console.anthropic.com/ → API keys | Default provider. Keys start with `sk-ant-`. |
| OpenAI | https://platform.openai.com/api-keys | Keys start with `sk-`. Verify the current model ids at https://platform.openai.com/docs/models before setting `AI_MODEL`. |
| OpenRouter | https://openrouter.ai/keys | Keys start with `sk-or-`. Use `AI_PROVIDER=openrouter` (dedicated adapter, free models by default). See [OpenRouter](#10-openrouter-free-models). |
| Other OpenAI-compatible gateways (Azure OpenAI, local servers) | Provider-specific | Set `AI_PROVIDER=openai` and `AI_BASE_URL=https://…/v1`. |

## 3. Default models (verified November 2026)

| Provider | `AI_MODEL` (capable, ambiguous/long segments) | `AI_FAST_MODEL` (ordinary UI strings) | `AI_FALLBACK_MODEL` |
| --- | --- | --- | --- |
| anthropic | `claude-opus-5-5` | `claude-sonnet-5-5` | `claude-sonnet-5-5` |
| openai | `gpt-5` (**verify** in the OpenAI model list) | `gpt-5-mini` (**verify**) | none |
| openrouter | `google/gemma-4-31b-it:free` | `google/gemma-4-31b-it:free` | `google/gemma-4-26b-a4b-it:free` |
| mock | `mock-model` | `mock-model` | none |

Anthropic ids were checked against the Claude API reference available during development. OpenAI ids are placeholders taken from the provider's naming scheme and must be confirmed in the OpenAI documentation; if a model id is wrong, the backend returns a clear `model not found` error for each item and the test-connection script fails.

## 4. Model selection strategy

Implemented in `packages/translation-engine/src/router.ts`:

- Segments are grouped per request. Each segment is classified **fast** or **capable**:
  - capable when it has more than 25 words, two or more sentences, more than 6 words with no supporting reference, or long body text;
  - fast otherwise.
- Exact **verified** knowledge-base matches never call a model at all.
- Batches of up to `AI_BATCH_SIZE` fast items (default 20) and half that many capable items are sent concurrently (`AI_CONCURRENCY`, default 3).
- Every provider call has a timeout (`AI_TIMEOUT_MS`) and retries with exponential backoff and jitter on retryable errors only (429, 5xx, network): `AI_MAX_RETRIES`.
- Malformed JSON is retried once; a failing primary model is retried on `AI_FALLBACK_MODEL`; authentication errors are never retried.
- Results are cached in memory for `AI_CACHE_TTL_SECONDS`; identical texts inside one request are de-duplicated before any call.
- `AI_EFFORT=low|medium|high` maps to Anthropic's `output_config.effort`. Translation of short UI strings works well at `low`, which is also the cheapest.
- `AI_ANTHROPIC_SERVER_FALLBACK=true` enables Anthropic's server-side refusal fallback (beta header `server-side-fallback-2026-07-01`, `fallbacks: "default"`), so a safety-declined request is re-run on Anthropic's default fallback model inside the same call. Set it to `false` if your account or gateway rejects beta headers.

## 5. Structured output and validation

The engine asks for JSON matching a fixed schema (Anthropic: `output_config.format` with a JSON schema; OpenAI: `response_format: json_schema`; OpenRouter: `response_format: json_object` only, because free models do not reliably enforce schemas). The response is still validated with Zod (`llmOutputSchema`) and each translation passes `validateTranslationText` (non-empty, plausible length, protected tokens such as `{name}`, `%s`, URLs preserved). Invalid output is never inserted into a page.

## 6. Testing the connection

```bash
pnpm ai:test-connection
```

Prints the configuration summary (secrets masked), sends one tiny translation request and reports the latency, model and result. Exit code `2` means the provider rejected the call (wrong key, wrong model id, no network).

You can also check the live server: `curl http://localhost:8787/api/health` shows `provider`, `model` and `mock`.

## 7. Changing models later

Edit `AI_MODEL` / `AI_FAST_MODEL` / `AI_FALLBACK_MODEL` in `apps/backend/.env` and restart the backend (`pnpm dev:backend` restarts automatically in watch mode). The translation cache is per process, so a restart also clears it. Nothing else needs to change.

## 8. Mock mode

`AI_PROVIDER=mock` runs the full pipeline without a key. The mock provider returns a **verified knowledge-base translation when an exact match exists**, otherwise the visibly fake placeholder `[MOCK dua] <original text>` marked `unverified`. The popup shows a "Mock mode" banner. Mock mode is refused when `NODE_ENV=production`.

## 9. Cost notes

- Short UI strings are batched (default 20 per request) so a typical page costs a handful of requests, not hundreds.
- Verified knowledge entries and the cache eliminate repeated calls for common strings (navigation, buttons).
- The stable system prompt is marked for Anthropic prompt caching (`cache_control: ephemeral`).
- Watch usage in the admin page (`/admin/`, "Translation usage") or `GET /api/admin/usage`.

## 10. OpenRouter (free models)

[OpenRouter](https://openrouter.ai) gives access to many models with one key, including free `:free` variants. DOUALA AI has a dedicated `openrouter` provider (`packages/translation-engine/src/providers/openrouter.ts`).

### Get a key

1. Create an account at https://openrouter.ai and open https://openrouter.ai/keys.
2. Create a key (it starts with `sk-or-`). It is shown only once.
3. Put it in `apps/backend/.env` (git-ignored), never in the extension:

```ini
AI_PROVIDER=openrouter
AI_API_KEY=sk-or-...
AI_MODEL=google/gemma-4-31b-it:free
AI_FAST_MODEL=google/gemma-4-31b-it:free
AI_FALLBACK_MODEL=google/gemma-4-26b-a4b-it:free
AI_BASE_URL=https://openrouter.ai/api/v1
```

`AI_MODEL`, `AI_FAST_MODEL`, `AI_FALLBACK_MODEL` and `AI_BASE_URL` can be left empty: the values above are the defaults.

### Default models

| Role | Model | Notes |
| --- | --- | --- |
| Capable + fast | `google/gemma-4-31b-it:free` | Gemma 4, 31B instruction-tuned, free variant. |
| Fallback | `google/gemma-4-26b-a4b-it:free` | Gemma 4, 26B mixture-of-experts (4B active), free variant. Used when the primary model fails. |

Both ids were checked against the public model list (`GET https://openrouter.ai/api/v1/models`) in November 2026. `meta-llama/llama-3.3-70b-instruct:free` was considered as fallback but is **no longer offered as a free variant**, so it is not used. Free variants come and go: if `pnpm ai:test-connection` reports `OpenRouter model not found`, pick another id from that list.

### Free model limits

OpenRouter limits `:free` variants per account (from https://openrouter.ai/docs/api/reference/limits, November 2026):

| Credits purchased (all time) | Requests per minute | Requests per day |
| --- | --- | --- |
| Less than 10 | 20 | 50 |
| At least 10 | 20 | 1000 |

Free models can also be slower, temporarily unavailable, or log prompts depending on the upstream provider. Do not send private data through them.

To stay within these limits, when `AI_PROVIDER=openrouter` and the variables are not set the backend uses:

- `AI_CONCURRENCY=1` (one request at a time),
- `AI_BATCH_SIZE=30` (more segments per request, so fewer requests per page).

Setting `AI_CONCURRENCY` / `AI_BATCH_SIZE` explicitly overrides these defaults. A `429` (rate limit) or `5xx` is retried with exponential backoff (`AI_MAX_RETRIES`); `401` (bad key) and `404` (unknown model) are not retried. With 50 requests per day, a few pages per day is a realistic budget; verified knowledge-base matches and the cache do not count because they never reach OpenRouter.

### Request details

- Endpoint: `https://openrouter.ai/api/v1` (override with `AI_BASE_URL`, e.g. for a proxy).
- Attribution headers sent: `HTTP-Referer: https://github.com/TECHMAN237/dual-extension` and `X-Title: DOUALA AI`.
- `max_tokens` (not `max_completion_tokens`) and `response_format: { "type": "json_object" }`. The output is still validated with Zod and JSON wrapped in extra text is recovered.

### Changing model

Set `AI_MODEL` (and optionally `AI_FAST_MODEL` / `AI_FALLBACK_MODEL`) to any OpenRouter model id, for example a paid variant without the `:free` suffix, which has no platform request cap:

```ini
AI_MODEL=google/gemma-4-31b-it
```

Restart the backend, then run `pnpm ai:test-connection` to confirm the model answers.
