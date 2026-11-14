/**
 * Wikipédia (fr) – article « Duala (langue) », read through the MediaWiki API (wikitext).
 * Licence CC BY-SA 4.0: every entry records the article URL and revision in its note.
 *
 * The article has two-column French → Duala tables under these headings:
 *   "Grammaticale" (basic words), "les mois de l'année", "le corps", "quelques phrases", "les chiffres".
 * Rows: `| français || duala` (or one cell per line). A parenthesis in the Duala cell holds plural
 * or agreement forms ("muléma (miléma)", "ewɔ̄ (mɔ, diwɔ, bɔ…)") and goes to the note.
 */
import type { ExtractedPair } from "../types";
import { wikitextToPlain } from "./wiktionary";

export const WIKIPEDIA_SOURCE_ID = "wikipedia-duala";
export const WIKIPEDIA_FR_TITLE = "Duala (langue)";
export const WIKIPEDIA_FR_URL = "https://fr.wikipedia.org/wiki/Duala_(langue)";

const TABLE_SECTIONS: Record<string, { category: ExtractedPair["category"]; label: string }> = {
  grammaticale: { category: "vocabulary", label: "vocabulaire de base" },
  "les mois de l'année": { category: "vocabulary", label: "mois de l'année" },
  "le corps": { category: "vocabulary", label: "le corps" },
  "quelques phrases": { category: "expression", label: "phrases" },
  "les chiffres": { category: "vocabulary", label: "nombres" },
};

/** Parse "{| … |}" tables into rows of plain-text cells. */
function tableRows(table: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length) rows.push(current);
    current = [];
  };
  for (const raw of table.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^\|-/.test(line) || /^\|\}/.test(line)) {
      flush();
      continue;
    }
    if (/^\{\|/.test(line) || /^\|\+/.test(line) || /^!/.test(line)) continue;
    if (line.startsWith("|")) current.push(...line.slice(1).split("||").map((c) => c.trim()));
  }
  flush();
  return rows;
}

export function wikipediaTablePairs(wikitext: string, revid: number): ExtractedPair[] {
  const out: ExtractedPair[] = [];
  const parts = wikitext.split(/^(={2,3})\s*(.+?)\s*\1\s*$/m);
  // split() with 2 capture groups → [before, "==", title, body, "===", title, body, …]
  for (let i = 1; i + 2 < parts.length; i += 3) {
    const title = parts[i + 1]!.trim().toLowerCase();
    const section = TABLE_SECTIONS[title];
    if (!section) continue;
    for (const table of parts[i + 2]!.match(/\{\|[\s\S]*?\n\|\}/g) ?? []) {
      for (const row of tableRows(table)) {
        if (row.length < 2) continue;
        const fr = wikitextToPlain(row[0]!);
        const cell = wikitextToPlain(row[1]!);
        if (!fr || !cell || /^(mot|traduction)$/i.test(fr)) continue;
        const forms = /\(([^)]*)\)/.exec(cell)?.[1]?.trim();
        const duala = cell.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
        const frClean = fr.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
        const notes = [forms ? `Formes (pluriel / accord) : ${forms}` : null, `Wikipédia (fr), « ${WIKIPEDIA_FR_TITLE} », section « ${section.label} », révision ${revid}, CC BY-SA 4.0`];
        // "terre || wásē, minyáŋgádú": several Duala words for one French word.
        const all = section.label === "phrases" ? [duala] : duala.split(/\s*,\s*/).filter(Boolean);
        // "-ndɛ̄nɛ" is a stem that takes the class prefix: recorded in the note, not used as a word.
        const stems = all.filter((a) => a.startsWith("-"));
        if (stems.length) notes.splice(1, 0, `Radical (prend le préfixe de la classe du nom) : ${stems.join(", ")}`);
        for (const alt of all.filter((a) => !a.startsWith("-"))) {
          out.push({ sourceText: frClean, targetText: alt, category: section.category, note: notes.filter(Boolean).join(" — "), reference: WIKIPEDIA_FR_URL, tags: ["wikipedia", `wikipedia:${section.label}`] });
        }
      }
    }
  }
  return out;
}
