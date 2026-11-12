/**
 * Ingest a linguistic resource into the knowledge base.
 *
 * Usage:
 *   pnpm ingest --source <sourceId> --url <https://...> --lang fr [--format html|pdf|csv|json|text] [--strategy auto|table|dl|lines] [--dry-run]
 *   pnpm ingest --source <sourceId> --file <path> --lang fr [--format ...]
 *
 * Everything ingested is stored as `pending` / `extracted_unverified`.
 */
import { readFileSync } from "node:fs";
import { ingestBuffer, ingestUrl, loadSeedSources } from "@douala-ai/linguistic-knowledge";
import { createContainer } from "../container";
import { loadConfig } from "../config";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const sourceId = arg("source");
  const url = arg("url");
  const file = arg("file");
  const lang = arg("lang") as "en" | "fr" | undefined;
  const format = arg("format") as "html" | "pdf" | "csv" | "json" | "text" | undefined;
  const strategy = arg("strategy") as "auto" | "table" | "dl" | "lines" | undefined;
  if (!sourceId || (!url && !file) || !lang) {
    console.error("Usage: pnpm ingest --source <sourceId> (--url <url> | --file <path>) --lang <en|fr> [--format html|pdf|csv|json|text] [--strategy auto|table|dl|lines] [--source-column 0 --target-column 1] [--dry-run]");
    console.error(`Known seed sources: ${loadSeedSources().map((s) => s.id).join(", ")}`);
    process.exit(1);
  }
  const config = loadConfig();
  const c = await createContainer(config);
  let source = await c.store.getSource(sourceId);
  if (!source) {
    const seed = loadSeedSources().find((s) => s.id === sourceId);
    if (!seed) {
      console.error(`Unknown source "${sourceId}". Register it first (admin page or PUT /api/admin/sources/:id).`);
      process.exit(1);
    }
    source = await c.store.upsertSource(seed);
  }
  const html = { strategy: strategy ?? "auto", sourceColumn: Number(arg("source-column") ?? 0), targetColumn: Number(arg("target-column") ?? 1) };
  const opts = { store: c.store, source, sourceLanguage: lang, format, html, dryRun: flag("dry-run") };
  const report = url ? await ingestUrl(url, opts) : await ingestBuffer(readFileSync(file!), file!, null, opts);
  console.log(JSON.stringify({ sourceId: report.sourceId, extracted: report.extracted, skipped: report.skipped, warnings: report.warnings, sample: report.entries.slice(0, 5) }, null, 2));
  if (flag("dry-run")) console.log("Dry run: nothing written.");
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
