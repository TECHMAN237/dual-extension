/**
 * Wiktionary (fr / en) – Duala entries, read through the MediaWiki Action API (wikitext),
 * never by scraping HTML. Content is CC BY-SA 4.0: every entry records the page URL, the
 * revision id and the licence/attribution in `note`.
 *
 *  - fr.wiktionary.org: pages in "Catégorie:douala"; section `== {{langue|dua}} ==`,
 *    part-of-speech headings `=== {{S|nom|dua}} ===`, definitions `# …` (French),
 *    examples `#* {{exemple|<duala>|sens=<français>|lang=dua}}`.
 *  - en.wiktionary.org: pages in "Category:Duala lemmas"; section `==Duala==`,
 *    headings `===Noun===` / `====Verb====`, definitions `# …` (English),
 *    examples `#: {{ux|dua|<duala>|<english>}}`.
 * The page title is the Duala headword, kept exactly (tones, ɓ ɗ ɛ ɔ ŋ, Meinhof diacritics).
 */
import type { SourceLanguageCode } from "@douala-ai/shared";
import type { ExtractedPair } from "../types";
import { splitSenses } from "./senses";

export const WIKTIONARY_SOURCE_ID = "wiktionary-dua";
export type WikiLang = "fr" | "en";
export const WIKTIONARY_CATEGORY: Record<WikiLang, string> = { fr: "Catégorie:douala", en: "Category:Duala lemmas" };
export const WIKTIONARY_LICENCE = "CC BY-SA 4.0";

export function wiktionaryPageUrl(wiki: WikiLang, title: string): string {
  return `https://${wiki}.wiktionary.org/wiki/${encodeURIComponent(title.replace(/ /g, "_")).replace(/%2F/g, "/")}`;
}

/* ------------------------------------------------------------------------- */
/* Wikitext → plain text                                                      */
/* ------------------------------------------------------------------------- */

/** Parameters of a template body "name|a|b|k=v" (no nested templates at this point). */
function params(body: string): { name: string; pos: string[]; named: Record<string, string> } {
  const parts = body.split("|");
  const name = parts.shift()!.trim().toLowerCase();
  const pos: string[] = [];
  const named: Record<string, string> = {};
  for (const p of parts) {
    const m = /^\s*([\w-]+)\s*=(.*)$/s.exec(p);
    if (m) named[m[1]!.trim()] = m[2]!.trim();
    else pos.push(p.trim());
  }
  return { name, pos, named };
}

/** Display text of templates that stand for words; every other template (labels, notes) is dropped. */
function renderTemplate(body: string): string {
  const { name, pos, named } = params(body);
  switch (name) {
    // fr
    case "lien":
    case "lien-ancre":
      return named.dif ?? pos[0] ?? "";
    case "w":
    case "wp":
      return pos[1] ?? pos[0] ?? "";
    case "siècle":
      return "";
    // en
    case "l":
    case "m":
    case "ll":
      return named.alt ?? pos[2] ?? pos[1] ?? "";
    case "gloss":
    case "gl":
      return pos[0] ? `(${pos[0]})` : "";
    case "n-g":
    case "ng":
    case "non-gloss definition":
    case "non-gloss":
      return pos[0] ?? "";
    case "taxlink":
    case "taxfmt":
    case "vern":
    case "vernacular":
      return pos[0] ?? "";
    default:
      return "";
  }
}

const NAMED_ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", thinsp: " ", ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»" };

/** Decode HTML character references (e.g. `de&#817;` → "de̱": U+0331 combining macron below). */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, ref: string) => {
    if (ref[0] === "#") {
      const cp = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? m;
  });
}

export function wikitextToPlain(text: string): string {
  let s = decodeEntities(text)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref[^>]*\/>/gi, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/<[^>]+>/g, "");
  // Resolve innermost templates first.
  for (let i = 0; i < 10 && /\{\{/.test(s); i++) {
    s = s.replace(/\{\{([^{}]*)\}\}/g, (_, body: string) => renderTemplate(body));
  }
  s = s
    .replace(/\[\[(?:Catégorie|Category|Fichier|File|Image):[^\]]*\]\]/gi, "")
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/\[\[([^\]#]*)(?:#[^\]]*)?\]\]/g, "$1")
    .replace(/\[(?:https?:)?\/\/[^\s\]]+\s*([^\]]*)\]/g, "$1")
    .replace(/'''?/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

/* ------------------------------------------------------------------------- */
/* Template helpers for examples                                              */
/* ------------------------------------------------------------------------- */

/** Find top-level templates named `names` in a line and return their raw bodies (nested braces allowed). */
function findTemplates(line: string, names: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while ((i = line.indexOf("{{", i)) !== -1) {
    let depth = 0;
    let j = i;
    for (; j < line.length - 1; j++) {
      if (line[j] === "{" && line[j + 1] === "{") {
        depth++;
        j++;
      } else if (line[j] === "}" && line[j + 1] === "}") {
        depth--;
        j++;
        if (depth === 0) break;
      }
    }
    const body = line.slice(i + 2, j - 1);
    const name = body.split("|")[0]!.trim().toLowerCase();
    if (names.includes(name)) out.push(body);
    i = j + 1;
  }
  return out;
}

/** Split template params at top level (ignoring | inside nested {{ }} and [[ ]]). */
function topLevelParams(body: string): { pos: string[]; named: Record<string, string> } {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (let k = 0; k < body.length; k++) {
    const two = body.slice(k, k + 2);
    if (two === "{{" || two === "[[") {
      depth++;
      cur += two;
      k++;
      continue;
    }
    if (two === "}}" || two === "]]") {
      depth--;
      cur += two;
      k++;
      continue;
    }
    if (body[k] === "|" && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += body[k];
  }
  parts.push(cur);
  parts.shift(); // template name
  const pos: string[] = [];
  const named: Record<string, string> = {};
  for (const p of parts) {
    const m = /^\s*([\w-]+)\s*=([\s\S]*)$/.exec(p);
    if (m) named[m[1]!.trim()] = m[2]!.trim();
    else pos.push(p.trim());
  }
  return { pos, named };
}

/* ------------------------------------------------------------------------- */
/* Section extraction                                                         */
/* ------------------------------------------------------------------------- */

const FR_NON_POS = /^(étymologie|prononciation|références|voir aussi|variantes|variantes orthographiques|synonymes|antonymes|dérivés|apparentés|vocabulaire|traductions|notes|homophones|paronymes|anagrammes|hyperonymes|hyponymes|méronymes|holonymes|composés|abréviations|abrév|attestations|forme|faux-amis|quasi-synonymes|gentilés|dérivés autres langues|phrases|proverbes|citations|bibliographie|sources)/i;
const EN_POS = /^(noun|proper noun|verb|adjective|adverb|pronoun|preposition|conjunction|interjection|numeral|particle|determiner|phrase|proverb|prefix|suffix|article|classifier|contraction|idiom)$/i;

/** Printed references cited by the definition, e.g. {{R:Helmlinger1972|head=bongo̱sí|p=49}}. */
function citedReferences(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/\{\{R:([^|}]+)([^}]*)\}\}/g)) {
    const page = /\|\s*p(?:age)?\s*=\s*([^|}]+)/.exec(m[2] ?? "")?.[1]?.trim();
    const head = /\|\s*head\s*=\s*([^|}]+)/.exec(m[2] ?? "")?.[1]?.trim();
    const name = m[1]!.trim().replace(/^([A-Za-z]+)(\d{4})$/, "$1 ($2)");
    out.push(`cites ${name}${page ? `, p. ${page}` : ""}${head ? ` (${head})` : ""}`);
  }
  return out;
}

interface Definition {
  pos: string;
  text: string;
  refs: string[];
  /** Example sentences under this definition: Duala text + translation. */
  examples: { dua: string; translation: string }[];
}

function frSection(wikitext: string): string | null {
  const start = /^==\s*\{\{langue\|dua\}\}\s*==\s*$/m.exec(wikitext);
  if (!start) return null;
  const rest = wikitext.slice(start.index + start[0].length);
  const end = /^==[^=]/m.exec(rest);
  return end ? rest.slice(0, end.index) : rest;
}

function enSection(wikitext: string): string | null {
  const start = /^==\s*Duala\s*==\s*$/m.exec(wikitext);
  if (!start) return null;
  const rest = wikitext.slice(start.index + start[0].length);
  const end = /^==[^=]/m.exec(rest);
  return end ? rest.slice(0, end.index) : rest;
}

function definitions(section: string, wiki: WikiLang): Definition[] {
  const defs: Definition[] = [];
  let pos: string | null = null;
  for (const rawLine of section.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const heading = /^(={3,6})\s*(.*?)\s*\1\s*$/.exec(line);
    if (heading) {
      const title = heading[2]!;
      if (wiki === "fr") {
        const m = /\{\{S\|([^}]*)\}\}/.exec(title);
        const parts = (m?.[1] ?? "").split("|").map((p) => p.trim());
        const type = parts[0] ?? "";
        // `flexion` sections are inflected forms ("{{p}} de mubakwedi" = plural of …), not translations.
        const isFlexion = parts.includes("flexion");
        pos = m && type && !FR_NON_POS.test(type) && !isFlexion && (parts[1] === undefined || parts[1] === "dua") ? type : null;
      } else {
        pos = EN_POS.test(title.trim()) ? title.trim().toLowerCase() : null;
      }
      continue;
    }
    if (!pos) continue;
    if (/^#[^*:#]/.test(line)) {
      const text = wikitextToPlain(line.replace(/^#\s*/, ""));
      defs.push({ pos, text, refs: citedReferences(line), examples: [] });
      continue;
    }
    const last = defs[defs.length - 1];
    if (!last || !/^#[*:]/.test(line)) continue;
    // Examples
    if (wiki === "fr") {
      // Plain form: #* ''Duala text'' - traduction française.
      const plain = /^#\*\s*(.*''.*?'')\s+[-–—]\s+(.+)$/.exec(line);
      if (plain && !line.includes("{{exemple")) {
        const dua = wikitextToPlain(plain[1]!);
        const tr = wikitextToPlain(plain[2]!).replace(/\.$/, "");
        if (dua && tr) last.examples.push({ dua, translation: tr });
      }
      for (const body of findTemplates(line, ["exemple", "ébauche-exe"])) {
        const { pos: p, named } = topLevelParams(body);
        if ((named.lang ?? "dua") !== "dua") continue;
        const dua = wikitextToPlain(p[0] ?? "");
        const tr = wikitextToPlain(named.sens ?? p[1] ?? "");
        if (dua && tr) last.examples.push({ dua, translation: tr });
      }
    } else {
      for (const body of findTemplates(line, ["ux", "uxi", "usex"])) {
        const { pos: p, named } = topLevelParams(body);
        if (p[0] !== "dua") continue;
        const dua = wikitextToPlain(p[1] ?? "");
        const tr = wikitextToPlain(named.t ?? named.translation ?? p[2] ?? "");
        if (dua && tr) last.examples.push({ dua, translation: tr });
      }
    }
  }
  return defs;
}

/**
 * en.wiktionary "Derived terms"/"Related terms" lists give Duala phrases with an English gloss:
 * {{col|dua|ndabo a baboedi<t:a hospital>|ndabo a mitin,ndabo a Loba<t:a religious facility>}}
 */
function glossedColumnItems(section: string): { dua: string; gloss: string }[] {
  const out: { dua: string; gloss: string }[] = [];
  for (const body of findTemplates(section.replace(/\n/g, " "), ["col", "col2", "col3", "col4", "col-u", "der2", "der3", "der4", "rel2", "rel3"])) {
    const { pos } = topLevelParams(body);
    if (pos[0] !== "dua") continue;
    for (const item of pos.slice(1)) {
      const m = /^([^<]+)<t:([^>]+)>/.exec(item.trim());
      if (!m) continue;
      for (const alt of m[1]!.split(",")) {
        const dua = wikitextToPlain(alt.trim());
        if (dua) out.push({ dua, gloss: m[2]!.trim() });
      }
    }
  }
  return out;
}

export interface WiktionaryPage {
  title: string;
  revid: number;
  wikitext: string;
}

/**
 * Pairs for one page: one entry per sense (sourceText = French/English, targetText = the Duala
 * headword) and one `sentence_example` entry per example with a translation.
 */
export function wiktionaryPairs(wiki: WikiLang, page: WiktionaryPage): ExtractedPair[] {
  const section = wiki === "fr" ? frSection(page.wikitext) : enSection(page.wikitext);
  if (!section) return [];
  const url = wiktionaryPageUrl(wiki, page.title);
  const attribution =
    wiki === "fr"
      ? `Wiktionnaire (fr), révision ${page.revid}, ${WIKTIONARY_LICENCE}, contributeurs du Wiktionnaire`
      : `Wiktionary (en), revision ${page.revid}, ${WIKTIONARY_LICENCE}, Wiktionary contributors`;
  const out: ExtractedPair[] = [];
  for (const def of definitions(section, wiki)) {
    // fr definitions are capitalised by convention; en definitions are lower-case except proper nouns.
    for (const sense of splitSenses(def.text, { lowercaseFirst: wiki === "fr" })) {
      // Definitions that only describe grammar ("Pluriel de …", "plural of …") are not translations.
      if (/^(pluriel|singulier|forme|variante|plural|alternative|inflection|form) (de|d’|d'|of)\b/i.test(sense.text)) continue;
      const grammatical = /^(préfixe|suffixe|prefix|suffix|affixe|infix)/i.test(def.pos);
      out.push({
        sourceText: sense.text,
        targetText: page.title,
        category: grammatical ? "grammar_rule" : def.pos.startsWith("locution") || def.pos === "phrase" || def.pos === "idiom" ? "expression" : "vocabulary",
        context: def.pos,
        note: [sense.note, ...def.refs, attribution].filter(Boolean).join(" — "),
        reference: url,
        tags: ["wiktionary", `wiktionary-${wiki}`, `pos:${def.pos}`],
      });
    }
    for (const ex of def.examples) {
      out.push({
        sourceText: ex.translation,
        targetText: ex.dua,
        category: "sentence_example",
        context: def.pos,
        example: null,
        note: `Exemple de « ${page.title} » — ${attribution}`,
        reference: url,
        tags: ["wiktionary", `wiktionary-${wiki}`, "example"],
      });
    }
  }
  for (const item of wiki === "en" ? glossedColumnItems(section) : []) {
    for (const sense of splitSenses(item.gloss, { lowercaseFirst: false })) {
      out.push({
        sourceText: sense.text,
        targetText: item.dua,
        category: "expression",
        context: "derived term",
        note: [`Derived term listed on « ${page.title} »`, sense.note, attribution].filter(Boolean).join(" — "),
        reference: url,
        tags: ["wiktionary", `wiktionary-${wiki}`, "derived-term"],
      });
    }
  }
  return out;
}

export const wiktionarySourceLanguage = (wiki: WikiLang): SourceLanguageCode => wiki;
