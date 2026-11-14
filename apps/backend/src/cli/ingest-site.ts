/**
 * Crawl a dictionary site with its dedicated extractor and write the entries into the
 * knowledge base (data/knowledge/douala.json by default). Everything stays `pending`.
 *
 *   pnpm ingest:site --site mboasawa-api [--max-pages N] [--start-page N] [--dry-run]     (whole dictionary via the WordPress REST API)
 *   pnpm ingest:site --site mboasawa [--letters A-Z | A,B,C] [--max-words N] [--dry-run] [--examples 10]   (letter pages: incomplete, see docs)
 *   pnpm ingest:site --site wiktionary-fr | wiktionary-en [--max-pages N] [--dry-run]
 *   pnpm ingest:site --site wiktionary-fr-translations | wiktionary-en-translations   (translation tables → Duala)
 *
 * Politeness: one request at a time, ≥ 3.5 s between requests to a host, robots.txt honoured
 * (except the MediaWiki API, whose etiquette explicitly allows programmatic clients), and the
 * run stops at the first 403, 429 or CAPTCHA (exit code 3) after saving what was collected.
 * Sites whose terms forbid automated extraction (dictionnaireduala.com, Kemelang, Glosbe)
 * have no crawler on purpose.
 */
import { appendFileSync } from "node:fs";
import {
  MBOASAWA_ALL_LETTERS,
  MBOASAWA_SOURCE_ID,
  PoliteSession,
  SiteBlockedError,
  WIKTIONARY_SOURCE_ID,
  crawlMboasawa,
  crawlMboasawaRest,
  crawlWikipediaFr,
  WIKIPEDIA_SOURCE_ID,
  crawlWiktionary,
  loadSeedSources,
  toEntryInputs,
  writeEntriesKeepingReview,
  type CrawlBatch,
  type ExtractedPair,
  type KnowledgeEntryInput,
} from "@douala-ai/linguistic-knowledge";
import type { LinguisticSource, SourceLanguageCode } from "@douala-ai/shared";
import { createContainer } from "../container";
import { loadConfig } from "../config";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

function parseLetters(spec: string | undefined): string[] {
  if (!spec) return MBOASAWA_ALL_LETTERS;
  const range = /^([A-Za-z])-([A-Za-z])$/.exec(spec);
  if (range) {
    const [a, b] = [range[1]!.toUpperCase().charCodeAt(0), range[2]!.toUpperCase().charCodeAt(0)];
    return MBOASAWA_ALL_LETTERS.filter((l) => l.charCodeAt(0) >= a && l.charCodeAt(0) <= b);
  }
  return spec.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
}

async function main() {
  const site = arg("site");
  const dryRun = flag("dry-run");
  const showExamples = Number(arg("examples") ?? (dryRun ? 10 : 5));
  const logFile = arg("log");
  const log = (line: string) => {
    const stamped = `[${new Date().toISOString()}] ${line}`;
    console.log(stamped);
    if (logFile) appendFileSync(logFile, `${stamped}\n`);
  };
  const SITES = ["mboasawa-api", "mboasawa", "wiktionary-fr", "wiktionary-en", "wiktionary-fr-translations", "wiktionary-en-translations", "wikipedia-fr"] as const;
  if (!site || !(SITES as readonly string[]).includes(site)) {
    console.error(`Usage: pnpm ingest:site --site ${SITES.join("|")} [--max-pages N] [--letters A-Z --max-words N (mboasawa letter pages)] [--dry-run] [--log file]`);
    process.exit(1);
  }
  const isMboasawa = site.startsWith("mboasawa");
  const sourceId = isMboasawa ? MBOASAWA_SOURCE_ID : site === "wikipedia-fr" ? WIKIPEDIA_SOURCE_ID : WIKTIONARY_SOURCE_ID;
  const sourceLanguage: SourceLanguageCode = site.startsWith("wiktionary-en") ? "en" : "fr";
  const maxPages = arg("max-pages") ? Number(arg("max-pages")) : undefined;

  const config = loadConfig();
  const c = await createContainer(config);
  const seed = loadSeedSources().find((s) => s.id === sourceId)!;
  const stored = await c.store.getSource(sourceId);
  // Descriptive fields come from seed/sources.json (reviewed by hand); status fields from the store.
  let source: LinguisticSource = { ...seed, ingestionStatus: stored?.ingestionStatus ?? seed.ingestionStatus, lastIngestedAt: stored?.lastIngestedAt ?? seed.lastIngestedAt };
  log(`${dryRun ? "DRY RUN (nothing written)" : `Writing to ${config.storage === "memory" ? config.knowledgeFile : "Supabase"}`}; source ${sourceId}`);

  // Mboa Sawa: robots.txt honoured, 5 s between requests (the server is unstable).
  // Wiktionary: MediaWiki Action API under the API etiquette (see docs/LINGUISTIC_RESEARCH.md).
  const session = new PoliteSession({ respectRobots: isMboasawa, minIntervalMs: isMboasawa ? 5_000 : undefined, log: (l) => log(`  ${l}`) });
  const wiki = site.startsWith("wiktionary-fr") ? "fr" : "en";
  const batches: AsyncGenerator<CrawlBatch> =
    site === "mboasawa-api"
      ? crawlMboasawaRest({ session, maxPages, startPage: arg("start-page") ? Number(arg("start-page")) : undefined, log })
      : site === "wikipedia-fr"
        ? crawlWikipediaFr({ session, log })
      : site === "mboasawa"
        ? crawlMboasawa({ session, letters: parseLetters(arg("letters")), maxWords: arg("max-words") ? Number(arg("max-words")) : undefined, log })
        : crawlWiktionary({ session, wiki, kind: site.endsWith("-translations") ? "translations" : "lemmas", maxPages, log });

  let pending: ExtractedPair[] = [];
  let documents = 0;
  let written = 0;
  let empty = 0;
  const examples: KnowledgeEntryInput[] = [];
  const flush = async () => {
    if (pending.length === 0) return;
    const report = toEntryInputs(pending, { source, sourceLanguage, targetLanguage: "dua" });
    for (const e of report.entries) if (examples.length < showExamples) examples.push(e);
    if (!dryRun) await writeEntriesKeepingReview(c.store, report.entries);
    written += report.entries.length;
    pending = [];
  };

  let status: "ingested" | "partial" = "ingested";
  let exitCode = 0;
  try {
    for await (const batch of batches) {
      documents++;
      if (batch.pairs.length === 0) {
        empty++;
        log(`  ${batch.label}: no translation on the page, skipped`);
      }
      pending.push(...batch.pairs);
      if (documents % 25 === 0) {
        await flush();
        log(`progress: ${documents} documents, ${written} entries ${dryRun ? "extracted" : "written"}`);
      }
    }
  } catch (err) {
    if (err instanceof SiteBlockedError) {
      status = "partial";
      exitCode = 3;
      log(`STOPPED: ${err.message} (${err.url})`);
      source = { ...source, notes: `${source.notes ?? ""}\nIngestion stopped ${new Date().toISOString().slice(0, 10)}: ${err.message}`.trim() };
    } else {
      await flush();
      throw err;
    }
  }
  await flush();
  if (!dryRun) {
    await c.store.upsertSource({ ...source, ingestionStatus: written > 0 ? status : "failed", lastIngestedAt: new Date().toISOString() });
  }
  log(`done: ${documents} documents, ${empty} without translation, ${written} entries ${dryRun ? "extracted (dry run)" : "written"}, ${session.requests} HTTP requests`);
  console.log(`\nExamples (sourceText → targetText = Duala):`);
  for (const e of examples) console.log(`  ${e.sourceText}  →  ${e.targetText}   [${e.category ?? "vocabulary"}] ${e.reference ?? ""}`);
  process.exitCode = exitCode;
}

void main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
