/**
 * Word-by-word dictionary lookup.
 *
 *   "Consultez votre solde et lancez un transfert"
 *     → Consultez (consulter → …) · votre (function word) · solde (not found) · et (function word)
 *       · lancez (lancer → …) · un (function word) · transfert (not found)
 *
 * 1. The segment is split into words; elisions (l', d', qu', j', n', s', c', m', t') are separate
 *    tokens and punctuation is dropped.
 * 2. Multi-word expressions are matched first, longest first (up to MAX_SPAN words).
 * 3. Single words are matched through their dictionary-form candidates (lemma.ts): the first
 *    candidate that exists in the dictionary wins.
 * 4. Function words are not looked up on their own (but stay in the sentence); numbers and
 *    capitalised words inside a sentence that are not in the dictionary are treated as names.
 * Pending entries are used: they are the available documentation. Status only affects evidence.
 */
import { FUNCTION_WORDS, RELIABILITY_RANK, dictionaryKey, normalizeForLookup } from "@douala-ai/shared";
import type { KnowledgeEntry, SourceLanguageCode, TargetLanguageCode } from "@douala-ai/shared";
import { lemmaCandidates } from "./lemma";
import { TRANSLATABLE_CATEGORIES } from "./retrieval";
import type { KnowledgeStore } from "./store";

export const MAX_SPAN = 5;
/** Distinct Duala texts kept per word. */
export const MAX_TRANSLATIONS_PER_WORD = 3;

export type WordKind = "found" | "not_found" | "function_word" | "name" | "number";

export interface SegmentToken {
  surface: string;
  /** normalizeForLookup(surface) without apostrophes. */
  norm: string;
  kind: "content" | "function_word" | "number";
  /** Starts with a capital letter. */
  capitalised: boolean;
  /** First word of the segment or of a sentence inside it. */
  sentenceStart: boolean;
}

export interface GlossItem {
  /** Word or expression as written in the segment. */
  surface: string;
  /** Dictionary form that matched. */
  lemma: string | null;
  kind: WordKind;
  /** Matching entries, most trustworthy first, one per distinct Duala text. */
  entries: KnowledgeEntry[];
}

export interface SegmentLookup {
  text: string;
  items: GlossItem[];
  /** Content words (found + not found) and how many were found. */
  found: number;
  total: number;
}

const TOKEN_RE = /(?:jusqu|lorsqu|puisqu|quoiqu|qu|[cdjlmnst])['’](?=\p{L})|[\p{L}\p{M}\p{N}]+(?:[-'’][\p{L}\p{M}\p{N}]+)*/giu;

export function tokenizeSegment(text: string): SegmentToken[] {
  const out: SegmentToken[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const surface = m[0];
    const norm = normalizeForLookup(surface).replace(/['’]/g, "");
    if (!norm) continue;
    const before = text.slice(0, m.index).trimEnd();
    const sentenceStart = before === "" || /[.!?…:;«"“(]$/.test(before);
    const kind = /^\p{N}/u.test(surface) ? "number" : FUNCTION_WORDS.has(norm) ? "function_word" : "content";
    out.push({ surface, norm, kind, capitalised: /^\p{Lu}/u.test(surface), sentenceStart });
  }
  return out;
}

const ORIGIN_RANK: Record<KnowledgeEntry["origin"], number> = { verified_source: 4, user_correction: 3, extracted_unverified: 2, ai_suggestion: 1 };
const CATEGORY_RANK: Partial<Record<KnowledgeEntry["category"], number>> = { vocabulary: 3, expression: 3, translation_pair: 3, language_variant: 1, sentence_example: 0 };

/** Most trustworthy first: verified, then source reliability, origin and category. */
export function rankEntries(entries: KnowledgeEntry[]): KnowledgeEntry[] {
  const score = (e: KnowledgeEntry) => (e.validationStatus === "verified" ? 1000 : 0) + RELIABILITY_RANK[e.reliability] * 100 + ORIGIN_RANK[e.origin] * 10 + (CATEGORY_RANK[e.category] ?? 0);
  const sorted = [...entries].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
  const seen = new Set<string>();
  const out: KnowledgeEntry[] = [];
  for (const e of sorted) {
    const k = (e.targetText ?? "").normalize("NFC").toLowerCase().trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(e);
    if (out.length >= MAX_TRANSLATIONS_PER_WORD) break;
  }
  return out;
}

const usable = (e: KnowledgeEntry, lang: SourceLanguageCode, target: TargetLanguageCode) =>
  e.sourceLanguage === lang && e.targetLanguage === target && Boolean(e.targetText?.trim()) && e.validationStatus !== "rejected" && TRANSLATABLE_CATEGORIES.has(e.category);

/** Dictionary index (key → entries) for the candidates of a batch of segments. */
async function buildIndex(store: KnowledgeStore, segments: SegmentToken[][], lang: SourceLanguageCode, target: TargetLanguageCode): Promise<Map<string, KnowledgeEntry[]>> {
  const forms = new Set<string>();
  for (const tokens of segments) {
    for (const t of tokens) {
      forms.add(t.norm);
      if (t.kind === "content") for (const c of lemmaCandidates(t.surface, lang)) forms.add(c);
    }
  }
  const candidates = await store.searchCandidates([...forms].join(" "), { sourceLanguage: lang, targetLanguage: target, includeUnverified: true, limit: 50_000 });
  const index = new Map<string, KnowledgeEntry[]>();
  for (const e of candidates) {
    if (!usable(e, lang, target)) continue;
    const key = dictionaryKey(e.sourceText);
    if (!key) continue;
    const list = index.get(key) ?? [];
    list.push(e);
    index.set(key, list);
  }
  return index;
}

function lookupTokens(tokens: SegmentToken[], index: Map<string, KnowledgeEntry[]>, lang: SourceLanguageCode, text: string): SegmentLookup {
  const items: GlossItem[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    // 1. Longest multi-word expression starting here (must contain a content word).
    let matched = false;
    for (let j = Math.min(tokens.length, i + MAX_SPAN); j >= i + 2; j--) {
      const span = tokens.slice(i, j);
      if (!span.some((s) => s.kind === "content")) continue;
      const surface = span.map((s) => s.surface).join(" ").replace(/(['’]) /g, "$1");
      const entries = index.get(dictionaryKey(surface));
      if (entries?.length) {
        items.push({ surface, lemma: dictionaryKey(surface), kind: "found", entries: rankEntries(entries) });
        i = j;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    // 2. Single word.
    if (t.kind === "number") items.push({ surface: t.surface, lemma: null, kind: "number", entries: [] });
    else if (t.kind === "function_word") items.push({ surface: t.surface, lemma: null, kind: "function_word", entries: [] });
    else {
      let found: GlossItem | null = null;
      for (const form of lemmaCandidates(t.surface, lang)) {
        const entries = index.get(dictionaryKey(form));
        if (entries?.length) {
          found = { surface: t.surface, lemma: form, kind: "found", entries: rankEntries(entries) };
          break;
        }
      }
      if (found) items.push(found);
      else {
        const acronym = t.surface.length > 1 && t.surface === t.surface.toUpperCase() && /\p{Lu}/u.test(t.surface);
        const name = acronym || (t.capitalised && !t.sentenceStart);
        items.push({ surface: t.surface, lemma: null, kind: name ? "name" : "not_found", entries: [] });
      }
    }
    i++;
  }
  const found = items.filter((x) => x.kind === "found").length;
  const total = found + items.filter((x) => x.kind === "not_found").length;
  return { text, items, found, total };
}

/** Word-by-word lookup of a batch of segments (one dictionary query for the whole batch). */
export async function lookupSegments(store: KnowledgeStore, texts: string[], options: { sourceLanguage: SourceLanguageCode; targetLanguage: TargetLanguageCode }): Promise<SegmentLookup[]> {
  const tokenised = texts.map(tokenizeSegment);
  const index = await buildIndex(store, tokenised, options.sourceLanguage, options.targetLanguage);
  return tokenised.map((tokens, k) => lookupTokens(tokens, index, options.sourceLanguage, texts[k]!));
}

/**
 * Up to `limit` sentence examples from the documentation that contain words of the batch:
 * they show the Duala word order. Examples whose Duala side contains a lexicon word rank first,
 * shorter examples before longer ones.
 */
export async function findExamples(store: KnowledgeStore, lookups: SegmentLookup[], options: { sourceLanguage: SourceLanguageCode; targetLanguage: TargetLanguageCode; limit?: number }): Promise<KnowledgeEntry[]> {
  const lemmas = new Set<string>();
  const dualaWords = new Set<string>();
  for (const l of lookups) {
    for (const it of l.items) {
      if (it.kind !== "found") continue;
      if (it.lemma) for (const w of it.lemma.split(" ")) lemmas.add(w);
      for (const e of it.entries) for (const w of dualaTokens(e.targetText ?? "")) dualaWords.add(w);
    }
  }
  if (lemmas.size === 0) return [];
  const candidates = await store.searchCandidates([...lemmas].join(" "), { sourceLanguage: options.sourceLanguage, targetLanguage: options.targetLanguage, includeUnverified: true, limit: 50_000 });
  const scored = candidates
    .filter((e) => e.category === "sentence_example" && e.targetText && e.validationStatus !== "rejected" && e.sourceLanguage === options.sourceLanguage)
    .map((e) => {
      const dua = dualaTokens(e.targetText!);
      const src = new Set(normalizeForLookup(e.sourceText).split(/[\s']+/));
      const score = dua.filter((w) => dualaWords.has(w)).length * 2 + [...lemmas].filter((w) => src.has(w)).length;
      return { e, score, len: e.sourceText.length + e.targetText!.length };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.len - b.len || a.e.id.localeCompare(b.e.id));
  return scored.slice(0, options.limit ?? 3).map((x) => x.e);
}

/** Duala word tokens (NFC, lower case, diacritics kept). */
export function dualaTokens(text: string): string[] {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[’ʼ`]/g, "'")
    .split(/[^\p{L}\p{M}\p{N}']+/u)
    .map((t) => t.replace(/^'+|'+$/g, ""))
    .filter((t) => t.length > 0 && /\p{L}/u.test(t));
}
