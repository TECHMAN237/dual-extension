/**
 * Real translation with the configured provider (AI_PROVIDER / AI_API_KEY in apps/backend/.env),
 * printing for each text: source, word-by-word glosses, translation, words not found.
 *
 *   pnpm translate:sample                      # 10 varied sentences from data/knowledge/samples
 *   pnpm translate:sample --file texts.txt [--lang fr|en] [--json]
 *
 * Uses the free model quota: run it sparingly.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { TranslationResult } from "@douala-ai/shared";
import { createContainer } from "../container";
import { loadConfig } from "../config";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/** Ten varied sentences from the sample files (news, bank, encyclopedia, shop, English). */
const DEFAULT_TEXTS: { text: string; lang: "fr" | "en" }[] = [
  { text: "Consultez votre solde et lancez un transfert en toute sécurité.", lang: "fr" },
  { text: "Compte courant", lang: "fr" },
  { text: "Le gouvernement s'efforce de résoudre le problème en ajoutant de la chaux à la rivière.", lang: "fr" },
  { text: "Des poissons morts ont été observés à 100 kilomètres en aval.", lang: "fr" },
  { text: "Les langues officielles sont le français et l'anglais.", lang: "fr" },
  { text: "Le pays compte une multitude de langues locales.", lang: "fr" },
  { text: "Les Baka sont repoussés dans les forêts du sud et de l'est.", lang: "fr" },
  { text: "Ajouter au panier", lang: "fr" },
  { text: "Merci pour votre achat", lang: "fr" },
  { text: "Cameroon is a country in Central Africa.", lang: "en" },
];

function show(r: TranslationResult) {
  const glosses = (r.glosses ?? [])
    .filter((g) => g.kind === "found" || g.kind === "not_found")
    .map((g) => (g.kind === "found" ? `${g.source} → ${g.duala}` : `${g.source} → (non trouvé)`))
    .join(" · ");
  console.log(`\nSOURCE      : ${r.sourceText}`);
  console.log(`GLOSES      : ${glosses || "—"}`);
  console.log(`TRADUCTION  : ${r.translatedText ?? "(texte original conservé)"}`);
  console.log(`NON TROUVÉS : ${(r.notFound ?? []).join(", ") || "—"}`);
  console.log(`STATUT      : ${r.status} · preuve ${r.evidence} · couverture ${r.coverage ? `${r.coverage.found}/${r.coverage.total}` : "—"}${r.note ? ` · ${r.note}` : ""}`);
}

async function main() {
  const file = arg("file");
  const texts = file
    ? readFileSync(path.resolve(process.env.INIT_CWD ?? process.cwd(), file), "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((text) => ({ text, lang: (arg("lang") ?? "fr") as "fr" | "en" }))
    : DEFAULT_TEXTS;
  const config = loadConfig();
  const log = (level: string) => (obj: Record<string, unknown>, msg?: string) => console.error(`[${level}] ${msg ?? ""} ${JSON.stringify(obj)}`);
  const c = await createContainer(config, { logger: { info: () => {}, warn: log("warn"), error: log("error") } });
  console.log(`Fournisseur : ${c.provider.name} · modèle ${config.engine.model} (rapide : ${config.engine.fastModel ?? config.engine.model})`);
  const all: TranslationResult[] = [];
  for (const lang of ["fr", "en"] as const) {
    const items = texts.map((t, i) => ({ ...t, id: String(i) })).filter((t) => t.lang === lang);
    if (items.length === 0) continue;
    const res = await c.engine.translateBatch({ sourceLanguage: lang, targetLanguage: "dua", items: items.map((t) => ({ id: t.id, text: t.text, context: "paragraph" })) });
    all.push(...res.results);
  }
  all.sort((a, b) => Number(a.id) - Number(b.id));
  if (process.argv.includes("--json")) console.log(JSON.stringify(all, null, 2));
  else for (const r of all) show(r);
}

void main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
