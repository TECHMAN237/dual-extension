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

Every one of these hosts, plus the open reference sites tried afterwards (`en.wiktionary.org`, `fr.wiktionary.org`, `omniglot.com`, `glottolog.org`), was **blocked by the cloud session's network policy** (DNS resolution refused / proxy `403`). `mega.nz` additionally requires client-side JavaScript decryption and serves an archive of unknown provenance, which must not be executed blindly in any case.

Consequently:

- The content, structure, licence and reliability of the four websites **have not been verified** by direct inspection.
- No entries were extracted from them. The knowledge base ships with **zero Douala translations**.
- Web search (which works independently of the proxy) was used to characterise the Douala linguistic landscape and to find the standard academic references listed below.

To finish the research, allow these hosts in the environment's network settings (or run the ingestion locally) and follow §4.

## 2. Resource inventory

Reliability scale used throughout the project: `academic` > `institutional` > `established` > `community` > `unknown`.

### 2.1 Resources from Archille's email

| # | Resource | URL | Type (presumed) | Languages | Reliability | Accessibility | Extraction | Licensing | Recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | dictionnaireduala.com | https://dictionnaireduala.com/ | Online Duala–French dictionary | dua, fr | **unknown** (not inspected) | Blocked in build env; presumably public | HTML extractor (`auto`/`table`/`dl`/`custom` selectors) once the page layout is known | Unknown — check the site's terms before any automated extraction | Inspect manually first; if entries cite a printed dictionary (e.g. Helmlinger), mark reliability `established`; ingest as *pending* |
| 2 | Glosbe French–Duala | https://fr.glosbe.com/fr/dua | Community translation platform / aggregated dictionary | fr, dua | **community** (user-contributed, mixed quality) | Blocked in build env; public site | Glosbe's terms prohibit scraping; an API exists for partners | Mixed (CC-BY-SA for some data, proprietary aggregation) | Use for **manual lookup** by linguists only; do not scrape |
| 3 | Mboa Sawa – Dictionnaire duala | https://mboasawa.com/fr/mboasawa-2/dictionnaire-duala/?lettre=M | Alphabetical Duala–French dictionary (letter pages) | dua, fr | **unknown** (cultural site of the Sawa community; editorial process unknown) | Blocked in build env | HTML extractor per letter page (`?lettre=A` … `Z`) | Unknown | Inspect; contact the site owners for permission; ingest as *pending*, verify against Helmlinger/Ittmann |
| 4 | Kemelang – Duala | https://kemelang.com/duala/ | Language-learning / phrase platform | dua, fr, en | **unknown** | Blocked in build env | Likely lesson/phrase pages → `lines` extractor | Unknown | Inspect; good candidate for *expressions* and *sentence examples* |
| 5 | ZIP archive on MEGA | mega.nz link | Prior prototype + README (per email) | — | n/a | Not retrievable without a browser; untrusted binary | Not applicable | n/a | Download manually, scan it, and review the README; do **not** execute anything from it. If it contains a word list, import it through the CSV/JSON importer as *pending* |

### 2.2 Reference works identified by web research (not in the email)

| Resource | Type | Reliability | Accessibility | Notes |
| --- | --- | --- | --- | --- |
| Helmlinger, Paul (1972). *Dictionnaire duala-français, suivi d'un lexique français-duala*. Paris: Klincksieck, 664 p. | Bilingual dictionary | **academic** | Print only (libraries) | The standard Duala–French dictionary, cited by Omniglot, Lexilogos and the Basel Mission Archives. Primary reference for verifying entries. Copyrighted: cite, do not bulk-copy. |
| Ittmann, Johannes; ed. Kähler-Meyer, Emmi (1976). *Wörterbuch der Duala-Sprache / Dictionnaire de la langue duala / Dictionary of the Duala language*. Berlin: Dietrich Reimer, 675 p. | Four-language dictionary (dua/de/fr/en) | **academic** | Print only; catalogued by the Basel Mission Archives | Secondary reference; some tone marks reported missing or erroneous. |
| Ittmann, Johannes (1978). *Grammaire du duala* (French translation of *Grammatik des Duala*, 1939). Douala: Collège Libermann. | Reference grammar | **academic** | Print only; Glottolog reference 80392 | Source for grammar rules (noun classes, agreement, verb morphology). Summarise rules in the project's own words with page references. |
| Dinkelacker, Ernst (1914). *Wörterbuch der Duala-Sprache*. Hamburg. | Historical dictionary (dua/de) | academic (historical orthography) | Public domain scans may exist | Orthography predates the AGLC standard; use with caution. |
| Mbappé Bessémè, Philippe. *Dictionnaire Idiba de la langue duala* (Les Éditions du Net, 2013) and *How to say it in Duala* (2016) | Modern bilingual dictionaries | established | Commercial print | Uses the General Alphabet of Cameroon Languages (AGLC). Not open-licensed. |
| Wiktionary, Duala lemmas (en.wiktionary.org, fr.wiktionary.org) | Community dictionary | **community** | CC BY-SA 4.0; MediaWiki API | Blocked in build env. Suitable for ingestion as *pending* entries with attribution. |
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

## 4. How to complete the ingestion (once network access is available)

```bash
# 1. Start the backend (see docs/INSTALLATION.md), then inspect a page manually in a browser.
# 2. Dry-run the extractor to see what it finds:
pnpm ingest --source mboasawa-dictionnaire-duala --url "https://mboasawa.com/fr/mboasawa-2/dictionnaire-duala/?lettre=A" --lang fr --strategy auto --dry-run
# 3. If the orientation is wrong (Duala headword first, French gloss second) swap columns:
pnpm ingest --source mboasawa-dictionnaire-duala --url "…?lettre=A" --lang fr --strategy table --source-column 1 --target-column 0
# 4. Review the entries in /admin/ and verify them against Helmlinger (1972).
```

The ingestion honours `robots.txt`, identifies itself with a descriptive User-Agent, never bypasses logins or CAPTCHAs, limits response size, and records provenance (source id, URL, page/row reference, extraction date) on every entry.

## 5. Gaps and honest limitations

- No Douala translation data is included. Until linguists import and verify entries, a real AI provider will mostly return **"uncertain"** results (original text kept) or low-evidence suggestions flagged for review. This is by design.
- The four websites from the email were not inspected; their reliability column is "unknown" until a human reviews them.
- The MEGA archive was not retrieved.
- Printed dictionaries cannot be bulk-copied; the recommended path is manual entry of verified vocabulary with page references, or obtaining a licence from the rights holders.
