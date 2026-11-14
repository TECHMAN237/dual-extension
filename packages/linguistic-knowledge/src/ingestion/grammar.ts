/**
 * Grammar sheet (data/knowledge/grammaire-douala.md) → `grammar_rule` entries.
 *
 * Format of each rule:
 *   ### G17 · Ordre des mots : sujet, verbe, objet
 *   <one paragraph>
 *   - Exemple : « … » = « … »
 *   - Source : https://…
 * Rules whose paragraph starts with "Non documenté" are kept in the sheet (they tell the model
 * not to guess) but are not imported as knowledge entries.
 */
import type { ExtractedPair } from "./types";

export interface GrammarRule {
  id: string;
  title: string;
  text: string;
  examples: string[];
  sources: string[];
  documented: boolean;
}

export function parseGrammarSheet(markdown: string): GrammarRule[] {
  const rules: GrammarRule[] = [];
  const blocks = markdown.split(/^### /m).slice(1);
  for (const block of blocks) {
    const [headingLine = "", ...lines] = block.split(/\r?\n/);
    const heading = /^(G\d+)\s*·\s*(.+)$/.exec(headingLine.trim());
    if (!heading) continue;
    const body: string[] = [];
    const examples: string[] = [];
    const sources: string[] = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (/^#{1,2}\s/.test(line)) break; // next "## section"
      const ex = /^-\s*Exemple\s*:\s*(.+)$/.exec(line);
      const src = /^-\s*Source\s*:\s*(\S+)/.exec(line);
      if (ex) examples.push(ex[1]!.trim());
      else if (src) sources.push(src[1]!.trim());
      else if (line) body.push(line);
    }
    const text = body.join(" ").trim();
    rules.push({ id: heading[1]!, title: heading[2]!.trim(), text, examples, sources, documented: !/^non documenté/i.test(text) });
  }
  return rules;
}

/** Source id for a rule, from its first cited URL. */
export function grammarSourceId(url: string | undefined): string {
  if (!url) return "manual-linguist-entries";
  if (/wals\.info/.test(url)) return "wals-duala";
  if (/wikipedia\.org/.test(url)) return "wikipedia-duala";
  if (/wiktionary\.org/.test(url)) return "wiktionary-dua";
  if (/mboasawa\.com/.test(url)) return "mboasawa-dictionnaire-duala";
  return "manual-linguist-entries";
}

/** Documented rules as pairs, grouped by source id (one `toEntryInputs` call per source). */
export function grammarPairsBySource(rules: GrammarRule[]): Map<string, ExtractedPair[]> {
  const out = new Map<string, ExtractedPair[]>();
  for (const r of rules.filter((x) => x.documented && x.sources.length > 0)) {
    const sourceId = grammarSourceId(r.sources[0]);
    const list = out.get(sourceId) ?? [];
    list.push({
      sourceText: `${r.id} · ${r.title}`,
      targetText: null,
      category: "grammar_rule",
      note: `${r.text} — Sources : ${r.sources.join(" ; ")} — data/knowledge/grammaire-douala.md`,
      example: r.examples.length ? r.examples.join(" | ") : null,
      reference: r.sources[0]!,
      tags: ["grammar-sheet", r.id],
    });
    out.set(sourceId, list);
  }
  return out;
}
