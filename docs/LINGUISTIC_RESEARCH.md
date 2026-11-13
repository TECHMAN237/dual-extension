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
# Dedicated, rate-limited extractors (preferred for the sites below):
pnpm ingest:site --site mboasawa --letters A --max-words 10 --dry-run   # 10 examples, nothing written
pnpm ingest:site --site mboasawa --letters A-Z --log ingest.log         # full import (several hours)
pnpm ingest:site --site wiktionary-fr                                   # fr.wiktionary.org, Catégorie:douala
pnpm ingest:site --site wiktionary-en                                   # en.wiktionary.org, Category:Duala lemmas
# Generic extractor for a single page or file (tables, definition lists, "word — meaning" lines, CSV, JSON, PDF):
pnpm ingest --source <id> --url <url> --lang fr --dry-run
```

Rules built into the tooling (`packages/linguistic-knowledge/src/ingestion/fetch.ts`, `PoliteSession`):

- **One request at a time and at least 3.5 s between two requests to the same host**, robots.txt included. The pause is measured from the end of the previous response.
- **robots.txt is read once per site and honoured**, including `*` and `$` wildcards and multi-agent groups. The only exception is the MediaWiki Action API (§6.2).
- **Hard stop at the first 403, 429 or CAPTCHA / bot challenge.** Nothing is retried or bypassed; what was collected so far is saved and the source is marked `partial`. A dropped connection gets one retry after 30 s, then the run stops.
- Descriptive User-Agent with a contact URL: `DoualaAI-Ingestion/0.1 (+https://github.com/TECHMAN237/dual-extension; …)`.
- **Direction:** `sourceText` = French (or English), `targetText` = Duala, spelled exactly as on the page. Duala→French dictionaries are inverted on import.
- **One entry per sense:** "maison, demeure ; foyer" gives three entries with the same Duala word and the same reference. Commas split only lists of short senses or senses that each start with an article; descriptive definitions are kept whole. A trailing "(…)" becomes the note.
- **Provenance:** every entry has `reference` = the exact URL of the page it came from, plus the source id/name. Wiktionary entries also record the revision id and the CC BY-SA 4.0 attribution in `note`.
- **Status:** everything imported is `pending` / `extracted_unverified`. Nothing is marked `verified`; that is a speaker's job (admin page `/admin/`).
- **Stable ids:** entry ids are UUIDs derived from (source, languages, category, French text, Duala text). Re-running an import updates the same entries, never duplicates them, and never resets a status or note set by a reviewer.

## 5. Gaps and honest limitations

- **Nothing is verified yet.** All imported entries are `pending`: they are hints for the model ("Low"/"Moderate" evidence at most), not authoritative translations, until a Duala speaker reviews them.
- **Two of the four sites from the email could not be used** (dictionnaireduala.com, Kemelang): their owners do not allow automated reuse. Glosbe is excluded by its terms. Obtaining permission (§6.3, §6.4) would add the most valuable data, in particular Philippe Mbappé Bessémè's normalised AGLC dictionary.
- **Mixed orthographies:** Wiktionary pages use both AGLC spellings (ɓ, ɛ, ɔ, ŋ) and the older Meinhof notation (e̱, o̱ with a combining macron below). Mboa Sawa uses AGLC with tone marks. Entries are kept exactly as written; no conversion was attempted.
- **Mboa Sawa's editorial quality is unknown.** Its word pages say historical content was migrated and examples are "à vérifier". Its reliability stays `unknown`.
- **Licensing:** Wiktionary entries are CC BY-SA 4.0 (attribution kept per entry). Mboa Sawa states no licence; its entries are kept as pending research data with links, and the owners should be asked before any redistribution beyond this project.
- The MEGA archive was not retrieved.
- Printed dictionaries (Helmlinger 1972, Ittmann 1976) cannot be bulk-copied; the recommended path is manual verification of imported entries against them, with page references.

## 6. Ingestion report (2026-11-13)

| Source | Status | Entries imported | Requests |
| --- | --- | --- | --- |
| Wiktionary fr (`wiktionary-dua`, sourceLanguage `fr`) | **Imported** | 878 (699 vocabulary, 178 sentence examples, 1 expression) from 412 pages | 10 API calls |
| Wiktionary en (`wiktionary-dua`, sourceLanguage `en`) | **Imported** | 67 (58 vocabulary, 6 expressions, 3 grammar: noun-class prefixes) from 46 pages | 2 API calls |
| Mboa Sawa (`mboasawa-dictionnaire-duala`) | **Import in progress** (partial snapshot in this commit) | 86 so far (letters A–B; the crawl continues letter by letter and the file will be updated in a follow-up commit) | one per word page + one per letter page, ≥ 3.5 s apart |
| dictionnaireduala.com (`dictionnaireduala-com`) | **Refused by its terms** | 0 | 3 (robots.txt, home page, legal notice) |
| Kemelang (`kemelang-duala`) | **Refused by robots.txt** | 0 | 2 (robots.txt, /duala/ landing page) |
| Glosbe (`glosbe-fr-dua`) | **Excluded** (terms forbid scraping) | 0 | 0 |

### 6.1 Mboa Sawa – https://mboasawa.com/fr/mboasawa-2/dictionnaire-duala/

- **robots.txt:** `User-agent: *` disallows only `/application/`, `/development/`, `/externals/`, `/temporary/`. The dictionary is allowed.
- **Terms / licence:** no terms-of-use or legal page is linked. The footer says "© 2026 byCamerfeeling / Mboasawa" and "This demo site is only for demonstration purposes … All content cited is derived from their respective sources". No licence grants reuse: the entries are kept as pending research data with links to every page, and the owners should be asked before redistribution.
- **Structure:**
  - **Letter pages** `?lettre=A` … `Z` list 50 distinct headwords per page. The HTML repeats the list twice, so it contains 100 `div.word-item` blocks. Each headword is in `div.words-list > div.word-item > div.word-dua > a`, which links to the word page.
  - **The French column `div.word-fr` is empty** on letter pages. That is why the generic extractor found 0 entries (dry run, step b).
  - **Pagination:** `div.mboa-pagination` (`span.current` + links `?lettre=A&mboa_page=N`), followed to the end.
  - **Word pages** (`/fr/dictionnaire-duala/<slug>/`) contain `article.mboa-u-dict-sheet`: `.mboa-u-sheet-word` holds the Duala headword and `.mboa-u-sheet-translation > strong` the French translation ("sens principal"). An "Exemple à structurer" block holds unsegmented examples flagged "à vérifier", which are not imported.
- **Extractor:** `packages/linguistic-knowledge/src/ingestion/sites/mboasawa.ts`, tested on real extracts in `packages/linguistic-knowledge/test/fixtures/mboasawa-*.html`.
- **Cleaning rules:**
  - The placeholder "Traduction à compléter" is ignored.
  - Leading grammatical abbreviations ("interj.", "v.", "n.") move to the note.
  - Senses are split as described in §4.
- **Result:** in progress. In the snapshot committed on 2026-11-13: 86 entries from letters A and B, one per French sense, each with the URL of its word page. Letter B has only 13 headwords on the site.
- **Problems / pages ignored:** the server regularly drops a connection ("other side closed"); the crawler pauses 30 s and retries once, and would stop on a second failure. No 403, 429 or CAPTCHA so far. Word pages showing "Traduction à compléter" (e.g. `ábu`) are skipped.

### 6.2 Wiktionary – fr.wiktionary.org and en.wiktionary.org

- **Licence:** CC BY-SA 4.0, attribution required. Each entry links to its page (`reference`) and its `note` names the revision and "contributeurs du Wiktionnaire / Wiktionary contributors". Entries from this source are distributed under CC BY-SA 4.0 (see `data/knowledge/README.md`).
- **robots.txt:** `User-agent: *` → `Disallow: /w/` (with exceptions for `api.php?action=mobileview` and `load.php`) and "Friendly, low-speed bots are welcome viewing article pages, but not dynamically-generated pages". The extraction did **not** crawl HTML pages: it used the **MediaWiki Action API** as requested, under Wikimedia's API etiquette (https://www.mediawiki.org/wiki/API:Etiquette): requests in series, an informative User-Agent with contact information, `maxlag=5`, and 50 titles per request. 12 requests were made in total, each at least 3.5 s apart.
- **Categories:** fr `Catégorie:douala` (412 pages, with sub-categories by part of speech such as "Noms communs en douala" or "Verbes en douala"); en `Category:Duala lemmas` (46 pages).
- **Structure (wikitext):**
  - **fr:** section `== {{langue|dua}} ==`; parts of speech `=== {{S|nom|dua}} ===`; senses on `# …` lines; examples as `#* {{exemple|<duala>|sens=<français>|lang=dua}}` or `#* ''<duala>'' - <français>`. Sections marked `flexion` (plural forms, "{{p}} de …") are skipped.
  - **en:** section `==Duala==`; headings `===Noun===` etc.; senses on `# …` lines (with `{{vern}}`/`{{taxlink}}` for plant names, which become notes); `{{R:Helmlinger1972|p=…}}` references are kept in the note ("cites Helmlinger (1972), p. 49"); derived terms `{{col|dua|ndabo a baboedi<t:a hospital>}}` become `expression` entries.
- **Extractor:** `packages/linguistic-knowledge/src/ingestion/sites/wiktionary.ts`, tested on real extracts in `packages/linguistic-knowledge/test/fixtures/wiktionary-*.json`.
- **Problems found and fixed during the dry run:**
  - **Plural forms** produced "de mubakwedi" entries. These sections are now skipped.
  - **HTML character references** (`de&#817;`) are now decoded to the real combining character (e̱, U+0331).
  - **Proper nouns** keep their capital letter in English.
- **Pages without a usable translation:**
  - **fr:** 61 of 412, mostly inflected forms and stubs.
  - **en:** 1 of 46 (`ngéngeti`, an "alternative form of" entry).

### 6.3 dictionnaireduala.com – refused

- **robots.txt:** none (HTTP 404).
- **Terms:** the *Mentions légales* page (read 2026-11-13) states that dictionary entries and lexical databases are the exclusive property of Philippe Mbappé Bessémè. Consultation is reserved for personal, teaching or research use; reasonable quotations with attribution are allowed; "toute reproduction … diffusion ou réutilisation substantielle des contenus du site … est soumise à l'autorisation écrite préalable de l'éditeur".
- **Decision:** a bulk import into a public repository is a substantial reuse, so **nothing was extracted**. Only the home page and the legal notice were fetched.
- **Next step:** ask the publisher for a licence through the site's contact page. This would be the most valuable source: a normalised AGLC dictionary.

### 6.4 Kemelang – refused

- **robots.txt:** the file opens with "Automated scraping of Kemelang data is strictly restricted. If you wish to access our dictionary datasets, audio corpora, or APIs for commercial or research purposes, please contact us at: contact@kemelang.com".
  - **AI agents** are blocked by name with `Disallow: /`: `claude`, `anthropic`, `ClaudeBot`, `Claude-User`, `GPTBot`, …
  - **Everyone else** (`User-agent: *`) cannot access `/api/` or `/translate/`, nor URLs with query parameters.
- **Decision:** **not extracted.** Only robots.txt and the `/duala/` landing page were fetched for the assessment.
- **Next step:** ask Kemelang for research access to their dataset (they mention a page at `/dictionary/datasets/download`).

### 6.5 Glosbe – excluded

Not fetched at all. Its terms prohibit scraping. Use it only for manual checks by linguists.
