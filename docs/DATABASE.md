# Database

DOUALA AI normally stores its knowledge base **in Git**: no database is used.

| Mode | When | Where data lives |
| --- | --- | --- |
| **memory + versioned file** (normal) | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` not set | The knowledge base is `data/knowledge/douala.json` at the repository root, committed to Git and loaded at startup (locally and on Render). Local changes are written back to the file (commit them); on Render they last until the next restart, because the free disk is wiped (`ALLOW_EPHEMERAL_STORAGE=true`). Corrections, history and usage are in memory only. See `data/knowledge/README.md`. |
| **supabase** (optional future option, not used) | both variables set | Supabase PostgreSQL via `@supabase/supabase-js` with the service-role key (backend only). Kept so the project can switch later if shared persistent writes are needed. |

The same repository interfaces (`apps/backend/src/repositories/types.ts`, `packages/linguistic-knowledge/src/store.ts`) back both modes, so the API behaves identically. The schema below documents the Supabase option and the shape of the data.

## Setup (Supabase, optional, not used by default)

1. Create a project at https://supabase.com.
2. SQL editor → run `supabase/migrations/0001_initial.sql`. Optionally run `0002_embeddings.sql` (pgvector) if you plan to add semantic retrieval.
   Or: `psql "$DATABASE_URL" -f supabase/migrations/0001_initial.sql`.
3. Project settings → API: copy the **Project URL** into `SUPABASE_URL` and the **service_role** secret into `SUPABASE_SERVICE_ROLE_KEY` (backend `.env` only).
4. Seed the source registry and the empty UI term list: `pnpm --filter @douala-ai/backend seed`.
5. Restart the backend; `GET /api/health` reports `"storage":"supabase"`.

## Schema (`0001_initial.sql`)

| Table | Purpose | Key columns |
| --- | --- | --- |
| `languages` | Language registry (en, fr, dua; extensible) | `code` PK, `iso6393`, `is_source`, `is_target`, `glottocode` |
| `linguistic_sources` | Provenance registry for every dictionary, grammar, site or manual batch | `id` PK, `type`, `reliability`, `accessibility`, `license`, `ingestion_status`, `last_ingested_at` |
| `linguistic_knowledge` | Unified knowledge entities: vocabulary, expressions, grammar/conjugation rules, sentence examples, translation pairs, contextual meanings, language variants (`category`) | `source_text`, `source_text_normalized` (trigger-maintained), `target_text` (nullable), `origin`, `validation_status`, `reliability`, `source_id` FK, `reference`, `tags`, `extracted_at` |
| `vocabulary`, `expressions`, `grammar_rules`, `translation_pairs` | Views over `linguistic_knowledge` filtered by category | — |
| `corrections` | Community corrections submitted from the extension | `client_id`, `source_text`, `ai_translation`, `proposed_translation`, `explanation`, `status`, `review_note`, `knowledge_entry_id` |
| `correction_reviews` | Audit trail of admin decisions | `correction_id` FK, `reviewer`, `decision`, `note` |
| `correction_votes` | Optional community voting (schema only; no API yet) | PK (`correction_id`, `client_id`) |
| `translation_history` | Per-client aggregate history (domain, languages, counts, status). **No page text.** | `client_id`, `domain`, `translated_count`, `uncertain_count`, `status` |
| `user_settings` | Optional server-side settings sync (the extension stores settings locally by default) | `client_id` PK |
| `api_usage` | Provider usage for monitoring and cost control | `provider`, `model`, `tier`, token counts, `ok`, `error` |

Constraints worth knowing:

- `verified_requires_target`: an entry cannot be `verified` without a `target_text`.
- Text length checks mirror the Zod limits in `@douala-ai/shared` (2000 chars per segment, 1000 per explanation).
- `updated_at` triggers on mutable tables; `normalize_source_text` trigger keeps the lookup column consistent even for rows inserted in SQL.
- Indexes: lookup (`target_language, source_language, source_text_normalized`), GIN full-text (`to_tsvector('simple', …)`), trigram (`pg_trgm`) for fuzzy matching, status/origin and source.

## Row Level Security

All tables have RLS **enabled**. Policies:

- `languages`, `linguistic_sources`: public `SELECT` for `anon`/`authenticated`.
- `linguistic_knowledge`: public `SELECT` **only for `validation_status = 'verified'`** rows.
- `corrections`, `correction_reviews`, `correction_votes`, `translation_history`, `user_settings`, `api_usage`: **no policies** → no access for `anon`/`authenticated`.

The backend uses the service-role key, which bypasses RLS; it therefore enforces its own validation, rate limiting, per-client quotas and admin token. The `anon` key is never used by the backend or shipped in the extension. If you later add Supabase Auth, add policies keyed on `auth.uid()` and switch repositories to the anon key with user JWTs.

## Knowledge entry life cycle

```
ingestion (HTML/PDF/CSV/JSON/manual) ──► pending / extracted_unverified
admin review ───────────────────────────► verified  (usable as High evidence)
                                     └──► rejected  (excluded from retrieval)
user correction ──► corrections.pending ──► admin approve ──► linguistic_knowledge (origin user_correction, verified)
                                        └──► admin reject  ──► corrections.rejected (never enters the knowledge base)
```

## Retrieval

`packages/linguistic-knowledge/src/retrieval.ts` ranks candidates by lexical relevance (exact > sub-phrase > overlap) × quality (validation status, origin, reliability) and de-duplicates identical pairs. The Supabase store fetches candidates with an exact normalised match OR websearch full-text (`wfts`) on `source_text_normalized`; the in-memory store uses an inverted token index. Both feed the same ranker, so results are identical across backends.

`0002_embeddings.sql` adds a `vector(1536)` column and a `match_knowledge()` function for future semantic retrieval. The backend does not compute embeddings yet (no embedding provider is wired), so this migration is optional.

## Backups and privacy

- History stores domains and counts only. Corrections store the user's proposed text and the original segment they corrected (necessary for review); no identifiers beyond the random `client_id`.
- Export verified knowledge for sharing with linguists: `select source_language, source_text, target_text, category, source_name, reference from linguistic_knowledge where validation_status = 'verified';`
