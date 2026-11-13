/**
 * Coverage check: how would each text be handled with the current knowledge base?
 * No model is called and nothing is written.
 *
 *   pnpm coverage:check [--file data/knowledge/samples/banque.txt] [--lang fr|en] [--mode assisted|strict] [--knowledge <file.json>]
 *
 * Routes:
 *   DICTIONNAIRE  exact entry with a Duala text: applied directly, without the model (certain).
 *   ASSISTÉ       assisted mode, at least one content word has a Duala reference: the model may
 *                 translate it (words without reference stay as loans); the anti-invention check
 *                 can still reject its output, so this is "translatable", not "translated".
 *   MODÈLE        strict mode, no exact entry: sent to the model, which returns null when evidence
 *                 is missing (the free model returned null everywhere in production).
 *   ORIGINAL      original text kept (no reference at all, or not translatable).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { InMemoryKnowledgeStore } from "@douala-ai/linguistic-knowledge";
import { TRANSLATION_MODES, TranslationEngine, type LlmProvider, type SegmentPlan, type TranslationMode } from "@douala-ai/translation-engine";
import { loadConfig } from "../config";
import { findRepoRoot } from "../paths";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const LABEL: Record<SegmentPlan["route"], string> = { dictionary: "DICTIONNAIRE", assisted: "ASSISTÉ", model: "MODÈLE", kept: "ORIGINAL" };

async function main() {
  const root = findRepoRoot();
  const file = path.resolve(root, arg("file") ?? "data/knowledge/samples/banque.txt");
  const lang = (arg("lang") ?? "fr") as "fr" | "en";
  const config = loadConfig();
  const mode = (arg("mode") ?? config.engine.translationMode) as TranslationMode;
  if (!(TRANSLATION_MODES as readonly string[]).includes(mode)) throw new Error(`--mode must be one of ${TRANSLATION_MODES.join(", ")}`);
  const knowledgeFile = arg("knowledge") ? path.resolve(root, arg("knowledge")!) : config.knowledgeFile;

  const store = new InMemoryKnowledgeStore({ persistPath: knowledgeFile, readOnly: true });
  await store.load();
  // The model is never called by plan(); this provider fails loudly if it ever were.
  const provider: LlmProvider = {
    name: "coverage-check",
    complete: async () => {
      throw new Error("coverage:check must not call the model");
    },
  };
  const engine = new TranslationEngine({ config: { ...config.engine, translationMode: mode }, provider, store });

  const texts = readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const plan = await engine.plan(texts, lang);

  console.log(`Base : ${path.relative(root, knowledgeFile)} (${await store.countEntries()} entrées) · mode : ${mode} · textes : ${path.relative(root, file)}\n`);
  const width = Math.min(60, Math.max(...plan.map((p) => p.text.length)));
  for (const p of plan) {
    const detail =
      p.route === "dictionary"
        ? `→ ${p.translation} (${p.evidence})`
        : p.route === "assisted"
          ? `mots avec référence : ${p.anchors.map((a) => `${a.word} → ${a.duala}`).join(", ")}`
          : "";
    console.log(`${LABEL[p.route].padEnd(12)} ${p.text.slice(0, 60).padEnd(width)}  ${detail}`);
  }
  const count = (r: SegmentPlan["route"]) => plan.filter((p) => p.route === r).length;
  const pct = (n: number) => `${((100 * n) / Math.max(plan.length, 1)).toFixed(1)} %`;
  const dict = count("dictionary");
  const assisted = count("assisted");
  console.log("");
  console.log(`Dictionnaire direct (traduit, sans modèle) : ${dict}/${plan.length} (${pct(dict)})`);
  if (mode === "assisted") console.log(`Assisté (traduisible par le modèle, sous contrôle anti-invention) : ${assisted}/${plan.length} (${pct(assisted)})`);
  else console.log(`Envoyés au modèle en mode strict (résultat incertain) : ${count("model")}/${plan.length} (${pct(count("model"))})`);
  console.log(`Texte original conservé : ${count("kept")}/${plan.length} (${pct(count("kept"))})`);
  console.log(`COUVERTURE (dictionnaire + assisté) : ${pct(dict + assisted)}`);
}

void main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
