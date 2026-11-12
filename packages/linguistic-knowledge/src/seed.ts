import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { linguisticSourceSchema } from "@douala-ai/shared";
import type { LinguisticSource } from "@douala-ai/shared";
import { extractFromCsv } from "./ingestion/csv";
import { toEntryInputs } from "./ingestion/types";
import type { KnowledgeEntryInput } from "./store";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Locate the seed directory. Works from source (packages/linguistic-knowledge/src),
 * from the bundled backend (dist/seed) and from an explicit DOUALA_SEED_DIR override.
 */
function resolveSeedDir(): string {
  const candidates = [process.env.DOUALA_SEED_DIR, path.resolve(here, "../seed"), path.resolve(here, "seed"), path.resolve(process.cwd(), "seed")].filter((c): c is string => Boolean(c));
  for (const c of candidates) if (existsSync(path.join(c, "sources.json"))) return c;
  throw new Error(`Seed directory not found. Tried: ${candidates.join(", ")}. Set DOUALA_SEED_DIR.`);
}
export const SEED_DIR = resolveSeedDir();

/** Linguistic sources discovered during research (see docs/LINGUISTIC_RESEARCH.md). */
export function loadSeedSources(): LinguisticSource[] {
  const raw = readFileSync(path.join(SEED_DIR, "sources.json"), "utf8");
  return (JSON.parse(raw) as unknown[]).map((s) => linguisticSourceSchema.parse(s));
}

/**
 * Common interface terms with EMPTY target translations.
 * They are seeded so the admin interface lists what needs a verified Douala
 * equivalent. No Douala text is invented here.
 */
export function loadSeedUiTerms(): KnowledgeEntryInput[] {
  const csv = readFileSync(path.join(SEED_DIR, "ui-terms.en-fr.csv"), "utf8");
  const sources = loadSeedSources();
  const manual = sources.find((s) => s.id === "manual-linguist-entries")!;
  const byLang: Record<"en" | "fr", string[]> = { en: [], fr: [] };
  const lines = csv.split(/\r?\n/);
  const header = lines[0]!;
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const lang = line.split(",")[0] as "en" | "fr";
    byLang[lang]?.push(line);
  }
  const out: KnowledgeEntryInput[] = [];
  for (const lang of ["en", "fr"] as const) {
    const pairs = extractFromCsv([header, ...byLang[lang]].join("\n"));
    const report = toEntryInputs(pairs, { source: manual, sourceLanguage: lang, targetLanguage: "dua", documentReference: "seed/ui-terms.en-fr.csv" });
    for (const e of report.entries) {
      out.push({ ...e, id: `seed-${lang}-${e.sourceText.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, origin: "verified_source", validationStatus: "pending", tags: ["seed", "needs-translation"] });
    }
  }
  return out;
}
