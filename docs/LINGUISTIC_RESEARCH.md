# Linguistic research: Douala (Duálá, ISO 639-3 `dua`)

This document records every linguistic resource discovered for DOUALA AI, how it was found, what could and could not be verified, and how each one should be integrated. It is deliberately conservative: **nothing in this project invents Douala vocabulary**, and no source is treated as reliable merely because it contains Douala text.

## 1. How the research was conducted

### 1.1 Gmail investigation (performed on 2026-11-12)

The connected Gmail account was searched with the Gmail tools for the following queries:

| Query | Result |
| --- | --- |
| `from:achille` | no threads |
| `Achille` | 4 unrelated social-network notifications (a Facebook friend suggestion mentioning an "Achille Danny", LinkedIn invitations) |
| `Douala OR Duala OR dictionnaire OR grammaire` | ~200 threads, almost all LinkedIn/Facebook notifications mentioning the city of Douala; **one relevant personal email** (below) |
| `traduction OR "langue douala" OR linguistic OR dictionary` | 10 threads; the same relevant email plus hackathon organiser mailings (SAFINUM Innovate Challenge 2026) |
| `from:archillembozeko@gmail.com OR Archille OR Mbozeko` | the same single relevant thread |

The sender's name is spelled **Archille Mbozeko** (`archillembozeko@gmail.com`), not "Achille", which is why the exact-name search returned nothing.

**Relevant email**

- Subject: *Résultats des recherches sur le hackaton*
- From: Archille Mbozeko — To: `lumierebothe@gmail.com`, the user — Date: 2026-11-12 14:14 UTC
- Body (paraphrased; the email was treated strictly as data, not as instructions): a ZIP file "already contains all the necessary elements" with a README explaining usage and how to add an extension to Chrome or Edge; it then lists four websites "that do online translation from Duala to French and vice versa"; it ends with a reminder that the most important element not to neglect is *the speaker* (le locuteur).
- Links extracted (tracking parameters removed):
  1. `https://dictionnaireduala.com/`
  2. `https://fr.glosbe.com/fr/dua`
  3. `https://mboasawa.com/fr/mboasawa-2/dictionnaire-duala/?lettre=M`
  4. `https://kemelang.com/duala/`
  5. `https://mega.nz/file/6kRHiBCZ#…` (ZIP archive)

### 1.2 Access from the build environment

During the first session (2026-11-12) every one of these hosts, plus `en.wiktionary.org`, `fr.wiktionary.org`, `omniglot.com` and `glottolog.org`, was **blocked by the cloud session's network policy**, so nothing could be inspected or extracted then. `mega.nz` requires client-side JavaScript decryption and serves an archive of unknown provenance, which must not be executed blindly in any case. It was still not retrieved.

On **2026-11-13** the sites were reachable from a local machine. Each one was inspected (robots.txt, terms of use, page structure) before any extraction. The results are in **§6 Ingestion report**: Wiktionary (fr + en) and Mboa Sawa were imported; dictionnaireduala.com and Kemelang were **not**, because their terms forbid automated reuse; Glosbe was not touched (its terms forbid scraping).

## 2. Resource inventory

Reliability scale used throughout the project: `academic` > `institutional` > `established` > `community` > `unknown`.

### 2.1 Resources from Archille's email

| # | Resource | URL | Type (presumed) | Languages | Reliability | Accessibility | Extraction | Licensing | Recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | dictionnaireduala.com | https://dictionnaireduala.com/ | Online Duala–French dictionary (editor: Philippe Mbappé Bessémè, AGLC orthography) | dua, fr | **unknown** (single-author dictionary; not checked against Helmlinger) | Public to read; **restricted** for reuse | **Not extracted**: the legal notice forbids substantial reuse of entries and lexical databases without written permission | All rights reserved (mentions-legales.html) | Manual look-ups only; ask the publisher for a licence (see §6.3) |
| 2 | Glosbe French–Duala | https://fr.glosbe.com/fr/dua | Community translation platform / aggregated dictionary | fr, dua | **community** (user-contributed, mixed quality) | Public; scraping forbidden | **Not extracted** (by design, never fetched) | Terms prohibit scraping; partner API only | Manual verification by linguists only |
| 3 | Mboa Sawa – Dictionnaire duala | https://mboasawa.com/fr/mboasawa-2/dictionnaire-duala/ | Alphabetical Duala–French dictionary (letter pages + one page per word) | dua, fr | **unknown** (cultural site; editorial process unknown) | Public; robots.txt allows the dictionary | **Imported** with a dedicated extractor (§6.1), all entries pending | No licence stated (© Camerfeeling / Mboasawa) | Verify against Helmlinger (1972); ask the owners before redistributing |
| 4 | Kemelang – Duala | https://kemelang.com/duala/ | Language-learning platform with a Duala–French dictionary | dua, fr | **unknown** | Public to read; **restricted** for automated access | **Not extracted**: robots.txt restricts automated scraping and blocks AI agents (§6.4) | Not open; datasets on request (contact@kemelang.com) | Ask Kemelang for research access to their dataset |
| 5 | ZIP archive on MEGA | mega.nz link | Prior prototype + README (per email) | — | n/a | Not retrievable without a browser; untrusted binary | Not applicable | n/a | Download manually, scan it, and review the README; do **not** execute anything from it. If it contains a word list, import it through the CSV/JSON importer as *pending* |

### 2.2 Reference works identified by web research (not in the email)

| Resource | Type | Reliability | Accessibility | Notes |
| --- | --- | --- | --- | --- |
| Helmlinger, Paul (1972). *Dictionnaire duala-français, suivi d'un lexique français-duala*. Paris: Klincksieck, 664 p. | Bilingual dictionary | **academic** | Print only (libraries) | The standard Duala–French dictionary, cited by Omniglot, Lexilogos and the Basel Mission Archives. Primary reference for verifying entries. Copyrighted: cite, do not bulk-copy. |
| Ittmann, Johannes; ed. Kähler-Meyer, Emmi (1976). *Wörterbuch der Duala-Sprache / Dictionnaire de la langue duala / Dictionary of the Duala language*. Berlin: Dietrich Reimer, 675 p. | Four-language dictionary (dua/de/fr/en) | **academic** | Print only; catalogued by the Basel Mission Archives | Secondary reference; some tone marks reported missing or erroneous. |
| Ittmann, Johannes (1978). *Grammaire du duala* (French translation of *Grammatik des Duala*, 1939). Douala: Collège Libermann. | Reference grammar | **academic** | Print only; Glottolog reference 80392 | Source for grammar rules (noun classes, agreement, verb morphology). Summarise rules in the project's own words with page references. |
| Dinkelacker, Ernst (1914). *Wörterbuch der Duala-Sprache*. Hamburg. | Historical dictionary (dua/de) | academic (historical orthography) | Public domain scans may exist | Orthography predates the AGLC standard; use with caution. |
| Mbappé Bessémè, Philippe. *Dictionnaire Idiba de la langue duala* (Les Éditions du Net, 2013) and *How to say it in Duala* (2016) | Modern bilingual dictionaries | established | Commercial print | Uses the General Alphabet of Cameroon Languages (AGLC). Not open-licensed. |
| Wiktionary, Duala entries (fr.wiktionary.org `Catégorie:douala`, en.wiktionary.org `Category:Duala lemmas`) | Community dictionary | **community** | CC BY-SA 4.0; MediaWiki API | **Imported** through the API (§6.2), all entries pending, with attribution and revision ids. Several en entries cite Helmlinger (1972) with page numbers. |
| Omniglot – Duala page and phrase list | Educational | established (curated, but secondary) | Public web | Blocked in build env. Phrases useful for greetings; attribution required. |
| Mozilla Common Voice – Duala scripted speech | Speech corpus | institutional | CC-0 dataset | Audio, not a dictionary; relevant for a future text-to-speech feature. |
| Glottolog `dual1243` | Language metadata | academic | Public | Classification, references. |

### 2.3 Language facts recorded for the engine

- Douala (Duálá) is a Bantu language (Niger–Congo, Bantu A.24) of the Littoral Region of Cameroon, spoken by the Duala people around the city of Douala; ISO 639-3 `dua`, Glottocode `dual1243`.
- Modern writing uses the Latin alphabet with the AGLC additions (ɓ, ɗ, ɛ, ɔ, ŋ) and tone marks; older missionary sources use different conventions. The translation prompt instructs the model to **follow the orthography of the references** and never mix conventions.
- It is a noun-class language with agreement prefixes; the prompt instructs the model to respect class agreement and to decline rather than guess.

## 3. Reliability policy

1. **Verified** (`validation_status = verified`, origin `verified_source` or approved `user_correction`): usable as authoritative evidence → "High evidence".
2. **Extracted, unverified** (`extracted_unverified`, `pending`): hints only; the evidence level is capped at "Moderate" for established sources and "Low" otherwise.
3. **AI suggestions** are never written to the knowledge base automatically.
4. **User corrections** enter the knowledge base only after an administrator approves them.

A native-speaker reviewer ("le locuteur", as the email stresses) remains the final authority. The admin page (`/admin/`) lists pending entries for review.

## 4. How ingestion works

The knowledge base is the versioned file `data/knowledge/douala.json` (see `data/knowledge/README.md`). Imports write to it; review the diff and commit it.

```bash
pnpm ingest:site --site mboasawa-api --max-pages 1 --dry-run     # 100 words, nothing written
pnpm ingest:site --site mboasawa-api                             # whole Mboa Sawa dictionary (≈ 75 API requests, 5 s apart)
pnpm ingest:site --site wiktionary-fr | wiktionary-en            # Duala entries of fr/en Wiktionary (+ usage examples)
pnpm ingest:site --site wiktionary-fr-translations | wiktionary-en-translations   # French/English pages listing a Duala translation
pnpm ingest:site --site wikipedia-fr                             # tables of the article « Duala (langue) »
pnpm ingest:grammar                                              # grammar sheet data/knowledge/grammaire-douala.md → grammar_rule entries
pnpm ingest --source <id> --url <url> --lang fr --dry-run        # generic extractor for one page or file
```

Rules built into the tooling (`packages/linguistic-knowledge/src/ingestion/fetch.ts`, `PoliteSession`):

- **One request at a time, at least 3.5 s between two requests to the same host** (5 s for Mboa Sawa), robots.txt included.
- **robots.txt is read once per site and honoured**, including `*` and `$` wildcards and multi-agent groups. Exception: the MediaWiki Action API (§6.2), used under its etiquette.
- **Hard stop at the first 403, 429 or CAPTCHA / bot challenge.** Nothing is bypassed; what was collected is saved and the source is marked `partial`. A dropped connection, a timeout or a server error (5xx) gets one retry after 30 s, then the run stops cleanly.
- **Direction:** `sourceText` = French (or English), `targetText` = Duala, spelled exactly as in the source. Duala→French dictionaries are inverted on import.
- **One entry per sense:** "maison, demeure ; foyer" gives three entries with the same Duala word and the same reference.
- **Audit of every gloss** (`ingestion/classify.ts`):
  - a short sense ("être dur") stays vocabulary;
  - a description ("exprime la surprise…", "sorte de poisson", a gloss of more than 6 words, a cross-reference "voir : …") becomes a **definition** (`contextual_meaning`, with the description in the note), which is never applied as a translation;
  - a sentence on both sides becomes a **sentence example** (`sentence_example`), which shows word order.
- **Provenance:** every entry has `reference` = the exact URL it came from. Wikimedia entries also record the revision id and the CC BY-SA 4.0 attribution in `note`.
- **Status:** everything imported is `pending`. Nothing is marked `verified`; that is a speaker's job.
- **Stable ids:** entry ids are UUIDs derived from (source, languages, category, source text, Duala text). Re-running an import updates the same entries and never resets a reviewer's status or note.

## 5. Gaps and honest limitations

- **Nothing is verified yet.** All entries are `pending`: documentation for the model, not authoritative translations, until a Duala speaker reviews them.
- **Two of the four sites from the email could not be used** (dictionnaireduala.com, Kemelang): their owners do not allow automated reuse. Glosbe is excluded by its terms. Obtaining permission (§6.3, §6.4) would add the most valuable data.
- **Mixed orthographies:** Wiktionary uses both AGLC (ɓ, ɛ, ɔ, ŋ) and Meinhof (e̱, o̱); Mboa Sawa often writes ę and q where AGLC has ɛ and ɔ. Everything is kept exactly as written; no conversion was attempted.
- **Mboa Sawa:** its editorial quality is unknown and its glosses use printed-dictionary abbreviations. Its examples mix Duala and French without a separator: they are kept verbatim, not used as translations.
- **Grammar is thin.** The open sources document noun classes, pronouns, possessives, demonstratives, word order and negation. They do not cover the past tense, aspect, the place of question words, or common greetings such as "bonjour" and "merci"; these are marked "non documenté" in the grammar sheet.
- **Licensing:** Wiktionary and Wikipédia entries are CC BY-SA 4.0 (attribution kept per entry), WALS facts CC BY 4.0. Mboa Sawa states no licence: its entries are kept as pending research data with a link to each page; ask the owners before any redistribution beyond this project.
- **No parallel corpus:** no French–Duala or English–Duala parallel text with a free licence was found (§6.10).
- **MEGA archive:** not retrieved.

## 6. Ingestion report (2026-11-14)

| Source | Status | Entries (2026-11-14) | Requests |
| --- | --- | --- | --- |
| Mboa Sawa (`mboasawa-dictionnaire-duala`) | **Imported, complete** (7,461 words) | 7,871: 6,611 vocabulary, 1,248 definitions, 8 sentence examples, 4 grammar rules | 76 API requests, 5 s apart |
| Wiktionary fr (`wiktionary-dua`, `fr`) | **Imported** | 919: 682 vocabulary (incl. 58 from translation tables), 188 sentence examples, 41 definitions, 7 expressions, 1 grammar rule | 12 API requests |
| Wiktionary en (`wiktionary-dua`, `en`) | **Imported** | 73: 61 vocabulary (incl. 15 from translation tables), 8 expressions, 3 grammar (noun-class prefixes), 1 definition | 4 API requests |
| Wikipédia (`wikipedia-duala`) | **Imported** | 69: 50 vocabulary, 4 expressions, 4 sentence examples, 11 grammar rules | 3 API requests |
| WALS Online (`wals-duala`) | **Used for grammar** | 8 grammar rules | 3 file downloads (CLDF) |
| dictionnaireduala.com | **Refused by its terms** | 0 | 3 |
| Kemelang | **Refused by robots.txt** | 0 | 2 |
| Glosbe | **Excluded** (terms) | 0 | 0 |
| Omniglot | **Not imported** (opts out of AI use) | 0 | 2 |
| Wikipedia in Duala (Incubator) | **Not imported** (monolingual) | 0 | 2 |
| eBible.org | **Nothing to import** (no Duala text) | 0 | 1 |

Total: **8,940 entries** (8,867 French → Duala, 73 English → Duala), all `pending`; 8,916 have a Duala text. Before (commit fbbe5cf): 1,079 entries (945 Wiktionary, 86 Mboa Sawa, 48 interface terms without translation).

### 6.1 Mboa Sawa – https://mboasawa.com/fr/mboasawa-2/dictionnaire-duala/

- **robots.txt:** `User-agent: *` disallows only `/application/`, `/development/`, `/externals/`, `/temporary/`.
- **Terms / licence:** no terms-of-use page. Footer: "© 2026 byCamerfeeling / Mboasawa". No licence grants reuse (see §5).
- **Why there were only 86, then 324 entries:** two causes, neither the pagination nor the HTML extractor.
  1. **The letter navigation is incomplete.** The WordPress sitemap (`/fr/wp-sitemap-posts-dictionnaire-1..4.xml`) lists **7,461** word pages. The A–Z buttons offer no ɓ, ɗ, ɛ, ŋ or ɔ, so the **1,146 words starting with ɓ** cannot be reached from any letter page. The B and D pages only show a handful of words (13 and 29) that start with a plain b or d.
  2. **The crawl was interrupted twice** by the server (a read timeout, then HTTP 500). The old crawler then crashed instead of stopping cleanly.
- **Fix:** the site's public WordPress REST API returns the same posts, 100 per request: `GET /fr/wp-json/wp/v2/dictionnaire?per_page=100&page=N&_fields=id,link,title,content`. robots.txt does not disallow it. This takes 75 requests, 5 s apart, instead of 7,461 page loads.
  - `title` is the Duala headword;
  - `content` is `French gloss###examples`;
  - `link` is the word page URL, used as `reference`.
- **Cleaning (`sites/mboasawa.ts`):** every removed piece goes to the note, and nothing is reworded.
  - **Sense letters** ("b)") and **etymologies** ("(de l'angl. …)") move to the note.
  - **"<description> – <sense>"** (derived forms, e.g. "f. caus. de tíka – mettre dans l'embarras") and **"<label> : <sense>"** (e.g. "interrog. de lieu : où?"): only the sense is kept as the translation.
  - **Cross-references** "voir : …" are kept as definitions, never as translations.
  - **Headword annotations** move to the note: homonym numbers "(2)", form markers "-edi" and "mi-", singular/plural pairs "ɓopánda / mi-ɓopánda". The spelling of the word itself is unchanged.
  - **Examples after `###`** mix Duala and French without a separator. They are kept verbatim in the `example` field and never split.
- **Result:** all 7,461 word pages read (76 requests, no 403/429/CAPTCHA). 104 have no translation on the site. After cleaning and the audit: 6,611 vocabulary entries, 1,248 definitions (descriptions, cross-references, grammatical labels), 8 sentence examples. Entries with the same French sense and the same Duala word on two homonym pages are merged (same id), keeping one page URL.
- **Problems:**
  - The server occasionally drops connections or answers 500. This is handled by a pause and one retry.
  - One write failed on a Windows file lock (EPERM). The store now retries the rename, and the import was resumed from API page 69 with `--start-page`.

### 6.2 Wiktionary – fr.wiktionary.org and en.wiktionary.org

- **Licence:** CC BY-SA 4.0. Each entry links to its page and its `note` names the revision and the contributors.
- **robots.txt:** `Disallow: /w/` for generic crawlers. Extraction used only the **MediaWiki Action API**, under the API etiquette: serial requests, a User-Agent with a contact URL, `maxlag=5`, 50 titles per request, ≥ 3.5 s apart.
- **Duala entries:** fr `Catégorie:douala` (412 pages), en `Category:Duala lemmas` (46 pages).
  - **Definitions** give one entry per sense.
  - **Usage examples with their translation** become `sentence_example` entries. Formats read: `{{exemple|…|sens=…}}`, `''…'' - …`, the two-line `#*` / `#*:` form, and en `{{ux|dua|…|…}}`.
  - **en derived terms with a gloss** become `expression` entries.
  - **Helmlinger page references** are kept in the note.
- **Translation tables (new):** they give French → Duala and English → Duala pairs, with the sense in the note.
  - **fr:** `Catégorie:Traductions en douala`, 49 French pages with `{{trad|dua|…}}` under `{{trad-début|sense}}`.
  - **en:** `Category:Terms with Duala translations`, 17 English pages or `/translations` subpages with `{{t|dua|…}}` under `{{trans-top|sense}}`.
  - **Skipped:** translations Wiktionary itself flags as unchecked (`{{t-check}}`, `{{checktrans-top}}`), e.g. "I love you" → "muléma" (heart).
- **Result:** fr 919 entries (188 sentence examples, 10 more than before thanks to the two-line format; 58 from 49 translation-table pages), en 73 entries (15 from 17 translation-table pages; 2 pages had only unchecked translations).

### 6.3 dictionnaireduala.com – refused

- **robots.txt:** none (HTTP 404).
- **Terms:** the *Mentions légales* page (read 2026-11-13) reserves the dictionary entries and lexical databases to Philippe Mbappé Bessémè and requires written permission for any substantial reuse.
- **Decision:** **nothing extracted.** Next step: ask the publisher for a licence.

### 6.4 Kemelang – refused

- **robots.txt:** "Automated scraping of Kemelang data is strictly restricted…"; AI agents (`claude`, `anthropic`, `ClaudeBot`, …) are blocked with `Disallow: /`.
- **Decision:** **not extracted.** Next step: ask Kemelang for research access to their dataset.

### 6.5 Glosbe – excluded

Not fetched. Its terms prohibit scraping.

### 6.6 Wikipédia – « Duala (langue) » (fr) and « Duala language » (en) – imported

- **Licence:** CC BY-SA 4.0. Read through the MediaWiki API (fr revision 241045385, en revision 1359233633).
- **French article:** tables citing Nseme 1998, Helmlinger 1972 and duala.douala.free.fr. They cover personal pronouns, verbal prefixes, demonstratives, noun-class prefixes, basic words, months, body parts, a few phrases (including negative ones) and the numbers 1–10.
- **English article:** the SVO word order, tones and the alphabet.
- **Use:** tables imported as pending entries (`sites/wikipedia.ts`, 69 entries: basic words, months (October is missing from the article), body parts, numbers 1–10, 8 phrases, and 11 grammar rules of the sheet); grammar summarised in `data/knowledge/grammaire-douala.md`.

### 6.7 WALS Online – Duala – used for the grammar sheet

- **Licence:** CC BY 4.0. Values read from the CLDF release (`cldf-datasets/wals` v2020.4); wals.info itself has no robots restriction.
- **Content:** 28 feature values for Duala, each citing a published grammar. They include the SVO order, noun–adjective and noun–genitive order, demonstrative–noun order, the preverbal negative particle (SNegVO), double-object "give", "and" = "with", the "exceed" comparative and a possible zero copula.
- **Use:** grammar sheet rules G11, G17–G19, G21–G23, G25. No vocabulary.

### 6.8 Wikipedia in Duala – not imported

`dua.wikipedia.org` does not exist (DNS lookup fails). The Duala Wikipedia is a test project in the Wikimedia Incubator (`Wp/dua`, CC BY-SA). Its monolingual Duala text could later help with spelling and word frequency, but it has no translations, so nothing was imported.

### 6.9 Omniglot – not imported

robots.txt (2026-11-14) declares `Content-Signal: search=yes,ai-train=no,use=reference` for all agents and blocks `ClaudeBot` and other AI crawlers; the content is under copyright. Not imported.

### 6.10 Parallel texts (eBible.org) – none found

The eBible.org catalogue (`translations.csv`, 1,557 translations) lists no Duala translation. Wikipédia mentions the 19th-century Duala New Testament (Saker), but no machine-readable text with an explicitly free licence was found. Nothing imported.

### 6.11 Audit of existing entries

All dictionary entries were rebuilt from their sources with the audit of §4: 1,290 entries are now definitions instead of translations (1,248 from Mboa Sawa, 42 from Wiktionary, e.g. "exprime la surprise, le désespoir ou la douleur" → aba), and whole sentences are sentence examples (200).

The 48 interface terms without a translation (`manual-linguist-entries`, `targetText: null`) were removed, since they could not help translate. The backend no longer seeds them (`SEED_UI_TERMS=false`).
