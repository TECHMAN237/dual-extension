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

/** Placeholders the site shows when a word has no translation yet: never imported. */
const PLACEHOLDER = /^(traduction\s+(à|a)\s+compl[ée]ter|(à|a)\s+compl[ée]ter|(à|a)\s+v[ée]rifier|non\s+traduit|sans\s+traduction|n\/a|-+|\?+|…|\.\.\.)$/i;

/** Leading grammatical abbreviations ("interj.", "v.t.", "n.") are moved to the note. */
const POS_PREFIX = /^((?:interj|v|vt|vi|v\.t|v\.i|n|nom|adj|adv|pr[ée]p|conj|pron|loc|cl|pl|sg|art|num)\.\s*)+/i;

/** One pair per French sense; the Duala headword is kept exactly as written on the page. */
export function mboasawaPairs(word: MboasawaWord, pageUrl: string): ExtractedPair[] {
  const raw = word.translation.trim();
  if (!raw || PLACEHOLDER.test(raw) || raw.toLowerCase() === word.headword.toLowerCase()) return [];
  const pos = POS_PREFIX.exec(raw)?.[0]?.trim() ?? null;
  const gloss = pos ? raw.slice(pos.length).trim() : raw;
  if (!gloss || PLACEHOLDER.test(gloss)) return [];
  return splitSenses(gloss)
    .filter((sense) => !PLACEHOLDER.test(sense.text))
    .map((sense) => ({
      sourceText: sense.text,
      targetText: word.headword,
      category: "vocabulary" as const,
      note: [pos ? `Mboa Sawa: ${pos}` : null, sense.note].filter(Boolean).join(" — ") || null,
      reference: pageUrl,
      tags: ["mboasawa"],
    }));
}
