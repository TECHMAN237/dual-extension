/**
 * Import the grammar sheet data/knowledge/grammaire-douala.md as `grammar_rule` entries
 * (pending, one per documented rule, with its source URL).
 *
 *   pnpm ingest:grammar [--dry-run]
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { grammarPairsBySource, loadSeedSources, parseGrammarSheet, toEntryInputs, writeEntriesKeepingReview } from "@douala-ai/linguistic-knowledge";
import { createContainer } from "../container";
import { loadConfig } from "../config";
import { findRepoRoot } from "../paths";

export const GRAMMAR_SHEET = "data/knowledge/grammaire-douala.md";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const rules = parseGrammarSheet(readFileSync(path.join(findRepoRoot(), GRAMMAR_SHEET), "utf8"));
  const config = loadConfig();
  const c = await createContainer(config);
  const sources = loadSeedSources();
  let written = 0;
  for (const [sourceId, pairs] of grammarPairsBySource(rules)) {
    const source = sources.find((s) => s.id === sourceId)!;
    const report = toEntryInputs(pairs, { source, sourceLanguage: "fr", targetLanguage: "dua" });
    if (!dryRun) await writeEntriesKeepingReview(c.store, report.entries);
    written += report.entries.length;
    console.log(`${sourceId}: ${report.entries.map((e) => e.sourceText.split(" · ")[0]).join(", ")}`);
  }
  console.log(`${rules.length} rules in the sheet, ${rules.filter((r) => !r.documented).length} marked "non documenté", ${written} grammar_rule entries ${dryRun ? "(dry run)" : "written"}.`);
}

void main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
