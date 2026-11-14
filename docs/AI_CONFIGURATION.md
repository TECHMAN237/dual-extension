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

## 11. Translation pipeline: word-by-word lookup, then composition

The engine translates any French or English text from the Duala **documentation** in `data/knowledge/` (dictionary `douala.json` + grammar sheet `grammaire-douala.md`), not from translations prepared for specific pages. There is no translation mode to configure any more (`TRANSLATION_MODE` was removed).

For every batch of segments sent by the extension:

1. **Word-by-word lookup** (`packages/linguistic-knowledge/src/lookup.ts`), with one dictionary query for the whole batch.
   - **Splitting:** each segment is split into words. Elisions (l', d', qu', j', n', s', c', jusqu'…) are separate words, and punctuation is dropped.
   - **Expressions first:** multi-word expressions of up to 5 words are matched first, the longest first ("s'il te plaît", "le compte rendu").
   - **Dictionary forms:** each remaining word is reduced to its dictionary form without any dependency (`lemma.ts`). French conjugated verbs become infinitives (consultez → consulter, effectué → effectuer), plurals and feminines become the masculine singular (comptes → compte, chevaux → cheval). English handles -s, -es, -ies, -ing, -ed and common irregular forms. Several candidates are tried; only those that exist in the dictionary are kept.
   - **Words that are not looked up:**
     - function words (le, la, de, un, votre, the, of… and the auxiliaries ont, été, was…) stay in the sentence but are not looked up on their own;
     - numbers stay as they are;
     - capitalised words inside a sentence and acronyms are treated as names when they are not in the dictionary.
   - **Entries used:** pending entries are used, since they are the available documentation; the status only affects evidence. Definitions (`contextual_meaning`) are never used as translations.
2. **Routing** of each segment:
   - **no content word found** → the original text is kept, **without calling the model**;
   - **the segment is exactly one dictionary entry** ("Solde", "Ajouter au panier" if it were an entry) → that entry is applied directly, without the model;
   - **otherwise** → composition by the model.
3. **Composition** (`packages/translation-engine/src/prompt.ts`).
   - **System prompt (stable, cacheable):** the instructions, followed by the whole grammar sheet `grammaire-douala.md`.
   - **Per batch:** one lexicon shared by all segments (each entry once, with short ids `L1`, `L2`…), 2–3 sentence examples from the documentation that contain the words found (they show word order), and each segment with its words and the lexicon ids of each word (none when not found).
   - **Instructions, in order:**
     - a) gloss word by word with the lexicon;
     - b) compose the Duala sentence with the grammar (order, agreement, negation, tense when documented);
     - c) keep every NOT FOUND word as written, as a loan, and never invent a Duala word;
     - d) keep names, brands, numbers, amounts and addresses intact.
   - **No refusal:** the model does not refuse because the documentation is incomplete.
   - **Output (JSON):** the translation, the glosses (source word, Duala word or null, lexicon id) and the words not found.
4. **Anti-invention check** (`output.ts`, `checkComposition`). Every word of the translation must be one of:
   - a Duala word of the lexicon or of the examples sent;
   - a Duala form of the grammar sheet (the Duala side of its examples and quoted forms with non-French letters);
   - a word of the source text kept as is.

   Otherwise, or when the translation contains no Duala word at all, it is rejected: the segment keeps its original text, with a note.
5. **Evidence from coverage:** coverage is the share of the segment's content words found in the dictionary.

   | Evidence | Coverage |
   | --- | --- |
   | `high` | ≥ 80 % with verified entries only |
   | `moderate` | ≥ 80 % |
   | `low` | ≥ 30 % |
   | `unverified` | below 30 % |

   `needsReview` is true except for `high`. Each result carries `glosses` (word → Duala text, entry id, status, source page; or not found), `notFound` and `coverage`. The extension shows them.

**Mock provider:** `[MOCK dua] …` placeholders, evidence `unverified`, no anti-invention check.

**Reasoning models:** some free models (e.g. Nvidia Nemotron) think before answering. The engine therefore reserves a large output budget (≥ 8,000 tokens) and asks OpenRouter for `reasoning: { effort: "low" }`, which non-reasoning models ignore. With such models, smaller batches (`AI_BATCH_SIZE=4`) are more reliable.

### Measuring coverage and testing a real translation

```bash
pnpm coverage:check                                   # every data/knowledge/samples/*.txt (no model call)
pnpm coverage:check --file my-texts.txt --details     # one text per line, word-by-word detail
pnpm translate:sample                                 # 10 varied sentences with the configured model (uses the free quota)
```

`coverage:check` prints, for each file, the share of content words found in the dictionary and how the segments would be handled (direct entry / composed / original kept). It then lists the 30 most frequent words not found, which are what to add to the documentation first. The sample files are real sentences: Wikinews (news), Wikipédia (encyclopedia), the bank page, generic shop labels, and English sentences.

Results on 2026-11-14 (8,940 entries):

| File | Words found | Segments composed or translated |
| --- | --- | --- |
| actualites.txt | 43.2 % | 19/20 |
| wikipedia.txt | 38.2 % | 17/20 |
| boutique.txt | 41.0 % | 11/20 |
| banque.txt | 23.5 % | 6/20 |
| anglais.txt | 2.4 % | 2/20 (the English dictionary has only 73 entries) |
| **total** | **30.7 %** | **55/100** |

Most frequent words not found: solde, frais, paiement, transfert, sécurité, gouvernement, centrale, occidentale, colonisation, indépendance, commande, stock…
