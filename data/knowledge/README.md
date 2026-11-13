# DOUALA AI knowledge base

`douala.json` is the project's knowledge base, versioned in Git. The backend loads it at
startup, locally and on Render. No database is needed.

- Format: `{ "version": 1, "sources": [...], "entries": [...] }`. Sources and entries are sorted by `id`, indented with 2 spaces and end with a newline, so diffs stay readable.
- Every entry stores its provenance: `sourceId`, `sourceName`, `reference` (exact URL of the page it came from) and, for Wiktionary, the revision id and licence in `note`.
- Direction: `sourceText` is French (`sourceLanguage: "fr"`) or English (`"en"`); `targetText` is Duala, spelled exactly as in the source (tones, ɓ ɗ ɛ ɔ ŋ, Meinhof diacritics such as e̱).
- **Everything imported is `pending`.** Nothing here is verified yet: a Duala speaker must review entries (admin page `/admin/`) before they count as high evidence. Entries with `targetText: null` are interface terms that still need a translation.

## Updating it

```bash
pnpm ingest:site --site wiktionary-fr      # or wiktionary-en, mboasawa (see docs/LINGUISTIC_RESEARCH.md)
git add data/knowledge/douala.json && git commit -m "Update knowledge base"
```

Entry ids are deterministic (derived from source, languages and text), so re-importing a page updates the same entries and never resets a human review. On Render, changes made through the admin page are kept in memory only and are lost at the next restart: make lasting changes here and commit them.

## Speaker glossary (`glossaire-a-traduire.csv`)

`glossaire-a-traduire.csv` lists about 320 common French terms of websites and financial services, grouped by context: navigation, forms, politeness, banking, mobile money, status messages, dates and general words. **Its `target_text` column is intentionally empty**: no Duala was written by the project.

Columns: `source_language,source_text,target_text,category,context,note`.

1. A Duala speaker fills `target_text`, in AGLC orthography with tones, for the terms they are sure of. Leave the cell empty when unsure, and add remarks in `note` if needed. Keep the file in UTF-8.
2. Import the filled file as **verified** entries. This is only allowed for the source `manual-linguist-entries`; rows still empty are skipped:

   ```bash
   pnpm ingest --source manual-linguist-entries --file data/knowledge/glossaire-a-traduire.csv --lang fr --format csv --verified --reviewer "Name of the speaker" --dry-run   # check
   pnpm ingest --source manual-linguist-entries --file data/knowledge/glossaire-a-traduire.csv --lang fr --format csv --verified --reviewer "Name of the speaker"
   ```

   Verified entries are applied directly, with "high" evidence and no review flag. Re-importing the same file updates the same entries. Without `--verified` the same command imports them as `pending`.
3. Measure the effect, then commit `douala.json`:

   ```bash
   pnpm coverage:check                       # samples/banque.txt by default
   git add data/knowledge && git commit -m "Add speaker-verified glossary entries"
   ```

`samples/banque.txt` holds the 20 texts of a sample bank page. It is used by `pnpm coverage:check` to track progress.

## Licences and attribution

| Source (`sourceId`) | Licence | Notes |
| --- | --- | --- |
| `wiktionary-dua` | **CC BY-SA 4.0**. © Wiktionary / Wiktionnaire contributors | Entries from fr.wiktionary.org (Catégorie:douala) and en.wiktionary.org (Category:Duala lemmas). Each entry links to its page and records the revision id. If you redistribute these entries, keep the attribution and share them under CC BY-SA 4.0. |
| `mboasawa-dictionnaire-duala` | No licence stated. © Camerfeeling / Mboasawa | Imported as pending research data with a link to every page. No terms of use were found and robots.txt allows the dictionary, but the site does not grant reuse rights: ask the owners before redistributing beyond this project. |
| `manual-linguist-entries` | Project licence (MIT) | Interface terms with empty translations (`seed/ui-terms.en-fr.csv`). |

Not imported, on purpose: dictionnaireduala.com (its legal notice forbids substantial reuse without written permission), Kemelang (robots.txt restricts automated scraping and blocks AI agents) and Glosbe (terms forbid scraping). See `docs/LINGUISTIC_RESEARCH.md`.
