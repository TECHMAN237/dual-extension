/**
 * Mboa Sawa – Dictionnaire duala (https://mboasawa.com/fr/mboasawa-2/dictionnaire-duala/).
 *
 * Structure observed on 2026-11-13:
 *  - Letter pages `?lettre=A` list 100 headwords per page:
 *      div.words-list > div.word-item > div.word-dua > a[href=word page]   (Duala headword)
 *                                     > div.word-fr                        (French: EMPTY on list pages)
 *    Pagination: div.mboa-pagination > span.current + a[href*="mboa_page=N"].
 *  - Each word page (article.mboa-u-dict-sheet) holds the translation:
 *      .mboa-u-sheet-word                       → Duala headword (exact orthography: ɓ ɗ ɛ ɔ ŋ, tones)
 *      .mboa-u-sheet-translation > strong       → French translation ("sens principal")
 *  The dictionary is Duala → French, so pairs are inverted: sourceText = French, targetText = Duala.
 */
import * as cheerio from "cheerio";
import type { ExtractedPair } from "../types";
import { splitSenses } from "./senses";

export const MBOASAWA_SOURCE_ID = "mboasawa-dictionnaire-duala";
export const MBOASAWA_DICTIONARY_URL = "https://mboasawa.com/fr/mboasawa-2/dictionnaire-duala/";

export function mboasawaLetterUrl(letter: string): string {
  return `${MBOASAWA_DICTIONARY_URL}?lettre=${encodeURIComponent(letter.toUpperCase())}`;
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

export interface MboasawaListPage {
  words: { headword: string; url: string }[];
  /** Absolute URL of the next page of the same letter, or null. */
  nextPage: string | null;
}

export function parseMboasawaLetterPage(html: string, pageUrl: string): MboasawaListPage {
  const $ = cheerio.load(html);
  const words: MboasawaListPage["words"] = [];
  const seen = new Set<string>();
  $(".words-list .word-item .word-dua a[href]").each((_, a) => {
    const headword = clean($(a).text());
    const url = new URL($(a).attr("href")!, pageUrl).toString();
    if (!headword || seen.has(url)) return;
    seen.add(url);
    words.push({ headword, url });
  });
  let nextPage: string | null = null;
  const pagination = $(".mboa-pagination").first();
  const current = Number(clean(pagination.find(".current").first().text()));
  if (Number.isFinite(current) && current > 0) {
    pagination.find("a[href]").each((_, a) => {
      const href = new URL($(a).attr("href")!, pageUrl);
      if (Number(href.searchParams.get("mboa_page")) === current + 1 && !nextPage) nextPage = href.toString();
    });
  }
  return { words, nextPage };
}

export interface MboasawaWord {
  headword: string;
  translation: string;
}

export function parseMboasawaWordPage(html: string): MboasawaWord | null {
  const $ = cheerio.load(html);
  const sheet = $("article.mboa-u-dict-sheet").first();
  if (sheet.length === 0) return null;
  const headword = clean(sheet.find(".mboa-u-sheet-word").first().text());
  const translation = clean(sheet.find(".mboa-u-sheet-translation strong").first().text());
  if (!headword) return null;
  return { headword, translation };
}

/* ------------------------------------------------------------------------- */
/* WordPress REST API (complete list; preferred)                              */
/* ------------------------------------------------------------------------- */
/*
 * Observed 2026-11-14: the letter pages only reach part of the dictionary. The site's sitemap
 * (wp-sitemap-posts-dictionnaire-1..4.xml) lists 7,461 word pages; 1,146 of them start with ɓ,
 * a letter the A–Z navigation does not offer, and B/D only show a few words. The public
 * WordPress REST API returns the same posts, 100 per request:
 *   GET /fr/wp-json/wp/v2/dictionnaire?per_page=100&page=N&_fields=id,link,title,content
 * `title.rendered` = Duala headword; `content.rendered` = "<p>French gloss###examples</p>",
 * where the examples mix Duala and French without a separator ("~" stands for the headword).
 */

export const MBOASAWA_REST_BASE = "https://mboasawa.com/fr/wp-json/wp/v2/dictionnaire";

export function mboasawaRestUrl(page: number, perPage = 100): string {
  return `${MBOASAWA_REST_BASE}?per_page=${perPage}&page=${page}&orderby=id&order=asc&_fields=id,link,title,content`;
}

export interface MboasawaRestPost {
  id: number;
  link: string;
  title?: { rendered?: string };
  content?: { rendered?: string };
}

export interface MboasawaRestWord extends MboasawaWord {
  url: string;
  /** Raw, unsegmented examples (Duala and French mixed, "~" = headword), or null. */
  examples: string | null;
}

const htmlToText = (html: string) => clean(cheerio.load(`<div>${html}</div>`)("div").first().text());

export function parseMboasawaRestPost(post: MboasawaRestPost): MboasawaRestWord | null {
  const headword = htmlToText(post.title?.rendered ?? "");
  if (!headword || !post.link) return null;
  const content = htmlToText(post.content?.rendered ?? "");
  const [gloss = "", ...rest] = content.split("###");
  const examples = rest.join(" ").trim();
  return { headword, translation: gloss.trim(), examples: examples || null, url: post.link };
}

/** Placeholders the site shows when a word has no translation yet: never imported. */
const PLACEHOLDER = /^(traduction\s+(à|a)\s+compl[ée]ter|(à|a)\s+compl[ée]ter|(à|a)\s+v[ée]rifier|non\s+traduit|sans\s+traduction|n\/a|-+|\?+|…|\.\.\.)$/i;

/** Leading grammatical abbreviations ("interj.", "v.t.", "n.") are moved to the note. */
const POS_PREFIX = /^((?:interj|v|vt|vi|v\.t|v\.i|n|nom|adj|adv|pr[ée]p|conj|pron|loc|cl|pl|sg|art|num)\.\s*)+/i;

/* ------------------------------------------------------------------------- */
/* Gloss and headword cleaning (printed-dictionary conventions)               */
/* ------------------------------------------------------------------------- */

export interface CleanGloss {
  /** French senses (may be empty when the gloss is only a description or a cross-reference). */
  senses: string;
  /** Description, grammatical label, etymology or cross-reference moved out of the senses. */
  note: string | null;
  kind: "sense" | "definition" | "crossref";
}

/** Letters found in Duala spellings but not in French ("réponse : Ńamɓé" ends with Duala, not French). */
const DUALA_LETTERS = /[ɓɗɛɔŋńęǫḿṅ]/i;
/** Latin binomial ("Dialium guineense Willd"): a scientific name, not a translation. */
const BINOMIAL = /^[A-Z][a-z]+ [a-z]{3,}/;

/**
 * Separate the French senses of a Mboa Sawa gloss from its descriptive parts:
 *   "b) conj. indique une opposition : mais"          → senses "mais", note "conj. indique une opposition"
 *   "f. réfl. de sóla – se détacher de qch"           → senses "se détacher de qch", note "f. réfl. de sóla"
 *   "voir : ituta"                                    → cross-reference (no sense)
 *   "(de l’angl. ‘threepenny’) 25 centimes"           → senses "25 centimes", note "de l’angl. ‘threepenny’"
 *   "un arbre : Dialium guineense Willd"              → definition (scientific name)
 * Nothing is added or reworded: every piece of the gloss ends up either in the senses or in the note.
 */
export function cleanMboasawaGloss(raw: string): CleanGloss {
  let text = clean(raw).replace(/^[a-h]\)\s+/, "");
  const notes: string[] = [];
  const etym = /^\(([^)]+)\)\s*(.+)$/.exec(text);
  if (etym) {
    notes.push(etym[1]!.trim());
    text = etym[2]!.trim();
  }
  if (/^(arch\.\s*)?(voir|v\.)\s*:?\s*\S/i.test(text) || /\bvoir\s*:\s*\S+$/i.test(text)) {
    return { senses: "", note: [...notes, text].join(" — "), kind: "crossref" };
  }
  // "<description> – <senses>": the meaning follows the last en dash.
  const dash = text.lastIndexOf(" – ");
  if (dash > 0) {
    notes.push(text.slice(0, dash).trim());
    text = text.slice(dash + 3).trim();
  }
  // "<label> : <senses>"
  const colon = /^(.{2,90}?)\s+:\s+(.+)$/.exec(text);
  if (colon) {
    const right = colon[2]!.trim();
    if (DUALA_LETTERS.test(right) || BINOMIAL.test(right)) return { senses: "", note: [...notes, text].join(" — "), kind: "definition" };
    notes.push(colon[1]!.trim());
    text = right;
  }
  return { senses: text, note: notes.length ? notes.join(" — ") : null, kind: "sense" };
}

/**
 * Headword annotations moved to the note: homonym numbers "ndalala (2)", verb-form markers
 * "ɓɔɓea -edi", class-prefix markers "ɓomɓála mi-", singular/plural pairs "ɓopánda / mi-ɓopánda".
 * The spelling of the word itself is never changed.
 */
export function cleanMboasawaHeadword(raw: string): { headword: string; note: string | null } {
  let h = clean(raw);
  const notes: string[] = [];
  const pair = /^(.+?)\s+\/\s+(.+)$/.exec(h);
  if (pair) {
    notes.push(`autre forme (pluriel) : ${pair[2]!.trim()}`);
    h = pair[1]!.trim();
  }
  const homonym = /^(.+?)\s*\((\d+)\)$/.exec(h);
  if (homonym) {
    notes.push(`homonyme n° ${homonym[2]}`);
    h = homonym[1]!.trim();
  }
  const marker = /^(.+?)\s+(-\S+|\S+-)$/.exec(h);
  if (marker && !/\s/.test(marker[1]!)) {
    notes.push(`marque de forme : ${marker[2]}`);
    h = marker[1]!.trim();
  }
  return { headword: h, note: notes.length ? notes.join("; ") : null };
}

/** One pair per French sense; the Duala headword is kept exactly as written on the page. */
export function mboasawaPairs(word: MboasawaWord & { examples?: string | null }, pageUrl: string): ExtractedPair[] {
  const raw = word.translation.trim();
  if (!raw || PLACEHOLDER.test(raw) || raw.toLowerCase() === word.headword.toLowerCase()) return [];
  const { headword, note: headNote } = cleanMboasawaHeadword(word.headword);
  const pos = POS_PREFIX.exec(raw)?.[0]?.trim() ?? null;
  const gloss = pos ? raw.slice(pos.length).trim() : raw;
  if (!gloss || PLACEHOLDER.test(gloss)) return [];
  const cleaned = cleanMboasawaGloss(gloss);
  const base = {
    targetText: headword,
    // Kept verbatim: the site itself does not separate Duala from French in its examples.
    example: word.examples ?? null,
    reference: pageUrl,
    tags: ["mboasawa"],
  };
  const noteOf = (...parts: (string | null)[]) => parts.filter(Boolean).join(" — ") || null;
  if (cleaned.kind !== "sense" || !cleaned.senses) {
    // Cross-reference or description only: kept as a definition, never used as a translation.
    return [{ ...base, sourceText: gloss, category: "contextual_meaning" as const, note: noteOf(cleaned.kind === "crossref" ? "Renvoi vers une autre entrée" : "Définition, pas un équivalent de traduction", pos ? `Mboa Sawa: ${pos}` : null, headNote) }];
  }
  return splitSenses(cleaned.senses)
    .filter((sense) => !PLACEHOLDER.test(sense.text))
    .map((sense) => ({
      ...base,
      sourceText: sense.text,
      category: "vocabulary" as const,
      note: noteOf(pos ? `Mboa Sawa: ${pos}` : null, cleaned.note, sense.note, headNote),
    }));
}
