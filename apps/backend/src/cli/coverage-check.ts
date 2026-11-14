/**
 * Dictionary coverage of sample texts, word by word. No model is called and nothing is written.
 *
 *   pnpm coverage:check                                   # every data/knowledge/samples/*.txt
 *   pnpm coverage:check --file my-texts.txt [--lang fr|en] [--details] [--top 30]
 *
 * One text per line; lines starting with "#" are comments. The language is taken from --lang,
 * or "en" for files named anglais*.txt / english*.txt, otherwise "fr".
 *
 * For each file: share of content words found in the dictionary, and how many segments would
 * be translated directly (one dictionary entry), composed by the model (at least one word
 * found) or kept in the original (no content word found). At the end: the most frequent words
 * not found, i.e. what to add to the documentation first.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { InMemoryKnowledgeStore } from "@douala-ai/linguistic-knowledge";
import { TranslationEngine, type LlmProvider, type SegmentPlan } from "@douala-ai/translation-engine";
import { normalizeForLookup } from "@douala-ai/shared";
import { loadConfig } from "../config";
import { findRepoRoot } from "../paths";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = (name: string) => process.argv.includes(`--${name}`);
const pct = (n: number, d: number) => `${d === 0 ? "0.0" : ((100 * n) / d).toFixed(1)} %`;

async function main() {
  const root = findRepoRoot();
  const samplesDir = path.join(root, "data/knowledge/samples");
  const files = arg("file") ? [path.resolve(process.env.INIT_CWD ?? process.cwd(), arg("file")!)] : readdirSync(samplesDir).filter((f) => f.endsWith(".txt")).sort().map((f) => path.join(samplesDir, f));
  const config = loadConfig();
  const knowledgeFile = arg("knowledge") ? path.resolve(root, arg("knowledge")!) : config.knowledgeFile;
  const store = new InMemoryKnowledgeStore({ persistPath: knowledgeFile, readOnly: true });
  await store.load();
  // plan() never calls the model; this provider fails loudly if it ever were.
  const provider: LlmProvider = { name: "coverage-check", complete: async () => { throw new Error("coverage:check must not call the model"); } };
  const engine = new TranslationEngine({ config: config.engine, provider, store });
  const top = Number(arg("top") ?? 30);

  console.log(`Documentation : ${path.relative(root, knowledgeFile)} (${await store.countEntries()} entrées)\n`);
  const missing = new Map<string, { count: number; lang: string }>();
  const totals = { found: 0, words: 0, segments: 0, dictionary: 0, compose: 0, kept: 0 };
  for (const file of files) {
    const name = path.basename(file);
    const lang = (arg("lang") ?? (/^(anglais|english)/i.test(name) ? "en" : "fr")) as "fr" | "en";
    const texts = readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    const plan: SegmentPlan[] = await engine.plan(texts, lang);
    const found = plan.reduce((n, p) => n + p.lookup.found, 0);
    const words = plan.reduce((n, p) => n + p.lookup.total, 0);
    const count = (r: SegmentPlan["route"]) => plan.filter((p) => p.route === r).length;
    totals.found += found;
    totals.words += words;
    totals.segments += plan.length;
    totals.dictionary += count("dictionary");
    totals.compose += count("compose");
    totals.kept += count("kept");
    console.log(`${name} (${lang}, ${plan.length} textes) : mots trouvés ${found}/${words} = ${pct(found, words)} · dictionnaire direct ${count("dictionary")} · composés par l'IA ${count("compose")} · originaux conservés ${count("kept")}`);
    for (const p of plan) {
      for (const it of p.lookup.items) {
        if (it.kind !== "not_found") continue;
        const key = normalizeForLookup(it.surface);
        const m = missing.get(key) ?? { count: 0, lang };
        m.count++;
        missing.set(key, m);
      }
      if (flag("details")) {
        const detail = p.lookup.items.map((it) => (it.kind === "found" ? `${it.surface}→${it.entries[0]!.targetText}` : it.kind === "not_found" ? `[${it.surface}?]` : it.surface)).join(" ");
        console.log(`   ${p.route.padEnd(10)} ${p.lookup.found}/${p.lookup.total}  ${detail}`);
      }
    }
  }
  console.log(`\nTOTAL : mots trouvés ${totals.found}/${totals.words} = ${pct(totals.found, totals.words)} · segments ${totals.segments} : dictionnaire direct ${totals.dictionary}, composés ${totals.compose}, originaux ${totals.kept} (${pct(totals.dictionary + totals.compose, totals.segments)} traduisibles)`);
  const ranked = [...missing.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0])).slice(0, top);
  console.log(`\n${ranked.length} mots non trouvés les plus fréquents (à ajouter à la documentation) :`);
  console.log(ranked.map(([w, m]) => `${w} (${m.count}${m.lang === "en" ? ", en" : ""})`).join(", "));
}

void main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
