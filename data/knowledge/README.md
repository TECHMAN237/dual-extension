# DOUALA AI knowledge base

This folder is the Duala documentation the translation engine relies on. It is versioned in Git; the backend loads it at startup, locally and on Render. No database is needed.

| File | Content |
| --- | --- |
| `douala.json` | Dictionary (French and English → Duala), definitions, sentence examples and grammar rules, each with its source |
| `grammaire-douala.md` | Grammar sheet: one rule per paragraph, each with its source; points the open sources do not cover are marked "non documenté" |
| `samples/` | Sample texts used by `pnpm coverage:check` |

## `douala.json`

- **Format:** `{ "version": 1, "sources": [...], "entries": [...] }`. Sources and entries are sorted by `id`, indented with 2 spaces and end with a newline, so diffs stay readable.
- **Provenance:** every entry stores `sourceId`, `sourceName` and `reference`, the exact URL of the page it came from. Wikimedia entries also record the revision id and the licence in `note`.
- **Direction:** `sourceText` is French (`sourceLanguage: "fr"`) or English (`"en"`). `targetText` is Duala, spelled exactly as in the source: tones, ɓ ɗ ɛ ɔ ŋ, Meinhof diacritics such as e̱, and Mboa Sawa's ę/q.
- **Categories:**
  - `vocabulary` and `expression`: translation equivalents;
  - `contextual_meaning`: **definitions** ("exprime la surprise…", "voir : …"). They explain a Duala word and are never applied as a translation;
  - `sentence_example`: whole sentences on both sides, which show word order;
  - `grammar_rule`: the rules of `grammaire-douala.md`, with their source.
- **Status:** everything imported is `pending`. Pending entries are usable documentation; a Duala speaker must review them (admin page `/admin/`) before they count as verified.

## Updating it

```bash
pnpm ingest:site --site mboasawa-api            # also: wiktionary-fr, wiktionary-en, wiktionary-fr-translations,
                                                #       wiktionary-en-translations, wikipedia-fr (docs/LINGUISTIC_RESEARCH.md §4)
pnpm ingest:grammar                             # after editing grammaire-douala.md
git add data/knowledge && git commit -m "Update knowledge base"
```

Entry ids are deterministic (derived from source, languages, category and text), so re-importing updates the same entries and never resets a human review. On Render, changes made through the admin page are kept in memory only and are lost at the next restart: make lasting changes here and commit them.

## Validation by a Duala speaker

Entries checked by a Duala speaker can be imported as **verified** from a CSV file (columns `source_language,source_text,target_text,category,context,note`). This is only allowed for the source `manual-linguist-entries`; rows without a Duala translation are skipped:

```bash
pnpm ingest --source manual-linguist-entries --file verified-by-speaker.csv --lang fr --format csv --verified --reviewer "Name of the speaker" --dry-run   # check
pnpm ingest --source manual-linguist-entries --file verified-by-speaker.csv --lang fr --format csv --verified --reviewer "Name of the speaker"
```

## Licences and attribution

| Source (`sourceId`) | Licence | Notes |
| --- | --- | --- |
| `wiktionary-dua` | **CC BY-SA 4.0**. © Wiktionary / Wiktionnaire contributors | Duala entries, usage examples and translation tables of fr.wiktionary.org and en.wiktionary.org. Each entry links to its page and records the revision id. If you redistribute these entries, keep the attribution and share them under CC BY-SA 4.0. |
| `wikipedia-duala` | **CC BY-SA 4.0**. © Wikipédia / Wikipedia contributors | Tables of the article « Duala (langue) » (fr) and grammar rules drawn from it and from « Duala language » (en). |
| `wals-duala` | **CC BY 4.0**. Dryer & Haspelmath (eds.), *WALS Online* | Grammar rules only (word order, negation…), each citing a published grammar. |
| `mboasawa-dictionnaire-duala` | No licence stated. © Camerfeeling / Mboasawa | The whole dictionary (7,461 words), imported as pending research data with a link to every page. The site grants no reuse rights: ask the owners before redistributing beyond this project. |
| `manual-linguist-entries` | Project licence (MIT) | Reserved for entries checked by a Duala speaker. |

`grammaire-douala.md` is written in the project's own words; it cites Wikipédia/Wikipedia (CC BY-SA 4.0), WALS (CC BY 4.0), Wiktionary (CC BY-SA 4.0) and Mboa Sawa pages for its examples.

Not imported, on purpose: dictionnaireduala.com (its legal notice forbids substantial reuse without written permission), Kemelang (robots.txt restricts automated scraping and blocks AI agents), Glosbe (terms forbid scraping), Omniglot (opts out of AI use) and the Duala Wikipedia in the Incubator (monolingual). See `docs/LINGUISTIC_RESEARCH.md`.
