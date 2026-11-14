/**
 * Dictionary-form candidates for a word, without any dependency.
 *
 * The rules over-generate on purpose ("consultez" → consulter, consultir, consultre…): the caller
 * keeps only the candidates that exist in the dictionary. Input and output are normalised forms
 * (lower case, no accents: see normalizeForLookup), so "effectué" is handled as "effectue".
 */
import { normalizeForLookup } from "@douala-ai/shared";

const FR_IRREGULAR: Record<string, string[]> = {
  est: ["etre"], es: ["etre"], suis: ["etre"], sommes: ["etre"], etes: ["etre"], sont: ["etre"], etait: ["etre"], etaient: ["etre"], ete: ["etre"], sera: ["etre"], seront: ["etre"], soit: ["etre"],
  a: ["avoir"], as: ["avoir"], ai: ["avoir"], avons: ["avoir"], avez: ["avoir"], ont: ["avoir"], avait: ["avoir"], avaient: ["avoir"], eu: ["avoir"], aura: ["avoir"], auront: ["avoir"],
  va: ["aller"], vais: ["aller"], vas: ["aller"], allons: ["aller"], allez: ["aller"], vont: ["aller"], ira: ["aller"], iront: ["aller"],
  fait: ["faire"], fais: ["faire"], faisons: ["faire"], faites: ["faire"], font: ["faire"], faisait: ["faire"], fera: ["faire"],
  peut: ["pouvoir"], peux: ["pouvoir"], pouvons: ["pouvoir"], pouvez: ["pouvoir"], peuvent: ["pouvoir"], pu: ["pouvoir"], pourra: ["pouvoir"],
  veut: ["vouloir"], veux: ["vouloir"], voulons: ["vouloir"], voulez: ["vouloir"], veulent: ["vouloir"], voulu: ["vouloir"],
  doit: ["devoir"], dois: ["devoir"], devons: ["devoir"], devez: ["devoir"], doivent: ["devoir"], du: ["devoir"],
  dit: ["dire"], dis: ["dire"], disons: ["dire"], dites: ["dire"], disent: ["dire"],
  prend: ["prendre"], prends: ["prendre"], prenons: ["prendre"], prenez: ["prendre"], prennent: ["prendre"], pris: ["prendre"], prise: ["prendre"],
  voit: ["voir"], vois: ["voir"], voyons: ["voir"], voyez: ["voir"], voient: ["voir"], vu: ["voir"], vue: ["voir"],
  vient: ["venir"], viens: ["venir"], venons: ["venir"], venez: ["venir"], viennent: ["venir"], venu: ["venir"], venue: ["venir"],
  sait: ["savoir"], sais: ["savoir"], savons: ["savoir"], savez: ["savoir"], savent: ["savoir"], su: ["savoir"],
  met: ["mettre"], mets: ["mettre"], mettez: ["mettre"], mis: ["mettre"], mise: ["mettre"],
  ouvert: ["ouvrir"], ouverte: ["ouvrir"], offert: ["offrir"], mort: ["mourir"], morts: ["mourir", "mort"], ne: ["naitre"], nee: ["naitre"],
  yeux: ["oeil"], cieux: ["ciel"], messieurs: ["monsieur"], mesdames: ["madame"],
};

const EN_IRREGULAR: Record<string, string[]> = {
  is: ["be"], are: ["be"], was: ["be"], were: ["be"], been: ["be"], am: ["be"],
  has: ["have"], had: ["have"], does: ["do"], did: ["do"], done: ["do"], went: ["go"], gone: ["go"], goes: ["go"],
  made: ["make"], paid: ["pay"], took: ["take"], taken: ["take"], gave: ["give"], given: ["give"], said: ["say"], saw: ["see"], seen: ["see"],
  came: ["come"], got: ["get"], bought: ["buy"], sold: ["sell"], sent: ["send"], found: ["find"], kept: ["keep"], left: ["leave"], told: ["tell"],
  knew: ["know"], known: ["know"], thought: ["think"], brought: ["bring"], ate: ["eat"], eaten: ["eat"], drank: ["drink"], ran: ["run"], wrote: ["write"], written: ["write"],
  men: ["man"], women: ["woman"], children: ["child"], people: ["person"], feet: ["foot"], teeth: ["tooth"], mice: ["mouse"],
};

/** French verb endings → infinitive endings to try (longest endings first). */
const FR_VERB_ENDINGS: [string, string[]][] = [
  ["eraient", ["er"]], ["erions", ["er"]], ["eriez", ["er"]], ["erons", ["er"]], ["eront", ["er"]], ["erais", ["er"]], ["erait", ["er"]],
  ["issions", ["ir"]], ["issiez", ["ir"]], ["issons", ["ir"]], ["issez", ["ir"]], ["issent", ["ir"]], ["issant", ["ir"]], ["issait", ["ir"]],
  ["aient", ["er"]], ["erai", ["er"]], ["eras", ["er"]], ["era", ["er"]], ["ions", ["er", "ir", "re"]], ["iez", ["er", "ir", "re"]],
  ["ons", ["er", "ir", "re"]], ["ez", ["er", "ir", "re"]], ["ent", ["er", "ir", "re"]], ["ais", ["er", "ir", "re"]], ["ait", ["er", "ir", "re"]], ["ant", ["er", "ir", "re"]],
  ["ees", ["er"]], ["ee", ["er"]], ["es", ["er", "e"]], ["e", ["er", "re"]], ["is", ["ir", "re"]], ["it", ["ir", "re"]], ["ie", ["ir"]], ["ies", ["ir"]], ["i", ["ir"]],
  ["ue", ["re", "oir"]], ["us", ["re", "oir"]], ["u", ["re", "oir"]], ["ds", ["dre"]], ["d", ["dre"]],
];

/** French noun/adjective endings (plural, feminine) → masculine singular endings. */
const FR_NOMINAL: [string, string][] = [
  ["eaux", "eau"], ["aux", "al"], ["euses", "eur"], ["euse", "eur"], ["euses", "eux"], ["euse", "eux"], ["ives", "if"], ["ive", "if"],
  ["elles", "el"], ["elle", "el"], ["ennes", "en"], ["enne", "en"], ["ettes", "et"], ["ette", "et"], ["eres", "er"], ["ere", "er"],
  ["ees", "e"], ["ee", "e"], ["es", "e"], ["es", ""], ["s", ""], ["x", ""], ["e", ""],
];

function frenchCandidates(w: string): string[] {
  const out = new Set<string>([w]);
  for (const f of FR_IRREGULAR[w] ?? []) out.add(f);
  for (const [end, rep] of FR_NOMINAL) if (w.length > end.length + 2 && w.endsWith(end)) out.add(w.slice(0, -end.length) + rep);
  for (const [end, infs] of FR_VERB_ENDINGS) {
    if (w.length <= end.length + 2 || !w.endsWith(end)) continue;
    const stem = w.slice(0, -end.length);
    for (const inf of infs) out.add(stem + inf);
    // "mangeons" / "commençons": stem keeps a spelling e / ç (normalised to c)
    if (stem.endsWith("ge")) for (const inf of infs) out.add(stem.slice(0, -1) + inf);
  }
  return [...out];
}

function englishCandidates(w: string): string[] {
  const out = new Set<string>([w]);
  for (const f of EN_IRREGULAR[w] ?? []) out.add(f);
  if (w.length > 3 && w.endsWith("ies")) out.add(w.slice(0, -3) + "y");
  if (w.length > 3 && w.endsWith("es")) out.add(w.slice(0, -2));
  if (w.length > 2 && w.endsWith("s") && !w.endsWith("ss")) out.add(w.slice(0, -1));
  for (const suffix of ["ing", "ed"]) {
    if (w.length <= suffix.length + 2 || !w.endsWith(suffix)) continue;
    const stem = w.slice(0, -suffix.length);
    out.add(stem);
    out.add(stem + "e");
    if (/([b-df-hj-np-tv-z])\1$/.test(stem)) out.add(stem.slice(0, -1)); // "stopped" → stop
    if (suffix === "ed" && stem.endsWith("i")) out.add(stem.slice(0, -1) + "y"); // "paid" handled above, "carried" → carry
  }
  return [...out];
}

/** Candidate dictionary forms of one word (normalised), the word itself first. */
export function lemmaCandidates(word: string, language: "fr" | "en"): string[] {
  const w = normalizeForLookup(word).replace(/['’]/g, "");
  if (!w) return [];
  return language === "fr" ? frenchCandidates(w) : englishCandidates(w);
}
