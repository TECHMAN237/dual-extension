import { RELIABILITY_RANK, contentTokens, dictionaryKey, normalizeForLookup, tokenize } from "@douala-ai/shared";
import type { EvidenceLevel, KnowledgeEntry, SourceLanguageCode, TargetLanguageCode, TranslationReference } from "@douala-ai/shared";
import type { KnowledgeStore } from "./store";

export interface RankedReference {
  entry: KnowledgeEntry;
  /** 0..1 lexical relevance. */
  relevance: number;
  /** Combined score used for ordering. */
  score: number;
  matchType: "exact" | "contains" | "contained" | "overlap";
}

export interface RetrievalOptions {
  sourceLanguage: SourceLanguageCode;
  targetLanguage: TargetLanguageCode;
  /** Maximum references returned per query. */
  limit?: number;
  includeUnverified?: boolean;
  /** Minimum relevance to keep an entry. */
  minRelevance?: number;
}

const STATUS_BOOST: Record<KnowledgeEntry["validationStatus"], number> = {
  verified: 1,
  pending: 0.55,
  rejected: 0,
};

const ORIGIN_BOOST: Record<KnowledgeEntry["origin"], number> = {
  verified_source: 1,
  user_correction: 0.8,
  extracted_unverified: 0.6,
  ai_suggestion: 0.3,
};

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Overlap matches below this relevance are noise ("Compte courant" vs "le compte-rendu"). */
export const MIN_OVERLAP_RELEVANCE = 0.5;

/** Categories whose target text can stand for the source text (grammar notes cannot). */
// contextual_meaning holds definitions ("exprime la surprise…"): they explain a word, they do not translate it.
export const TRANSLATABLE_CATEGORIES: ReadonlySet<KnowledgeEntry["category"]> = new Set(["vocabulary", "expression", "translation_pair", "sentence_example", "language_variant"]);

/**
 * Score a single entry against a query; exported for tests.
 *
 * - exact: same dictionary key (case, accents, final punctuation, leading article, simple plural).
 * - otherwise the entry must share at least one CONTENT word with the query: function words
 *   (le, les, de, votre, the, of, your…) never create a reference on their own.
 * - overlap matches below MIN_OVERLAP_RELEVANCE are dropped.
 * - for a one- or two-word segment, long example sentences are not used unless they match exactly.
 */
export function scoreEntry(query: string, entry: KnowledgeEntry): RankedReference | null {
  const qn = normalizeForLookup(query);
  const en = normalizeForLookup(entry.sourceText);
  if (!qn || !en) return null;

  let relevance: number;
  let matchType: RankedReference["matchType"];
  if (qn === en || dictionaryKey(query) === dictionaryKey(entry.sourceText)) {
    relevance = 1;
    matchType = "exact";
  } else {
    const qContent = new Set(contentTokens(qn));
    const eContent = new Set(contentTokens(en));
    if (qContent.size === 0 || eContent.size === 0) return null;
    let shared = 0;
    for (const t of eContent) if (qContent.has(t)) shared++;
    if (shared === 0) return null;
    const qWords = tokenize(qn).length;
    if (qWords <= 2 && (entry.category === "sentence_example" || tokenize(en).length > 4)) return null;
    if (qn.includes(` ${en} `) || qn.startsWith(`${en} `) || qn.endsWith(` ${en}`)) {
      // Entry is a sub-phrase of the query: useful vocabulary for composing the translation.
      relevance = 0.6 + 0.3 * (eContent.size / Math.max(qContent.size, 1));
      matchType = "contained";
    } else if (en.includes(qn)) {
      relevance = 0.5 + 0.3 * (qContent.size / Math.max(eContent.size, 1));
      matchType = "contains";
    } else {
      relevance = jaccard(qContent, eContent) * 0.8;
      matchType = "overlap";
      if (relevance < MIN_OVERLAP_RELEVANCE) return null;
    }
  }
  if (relevance <= 0) return null;

  const reliability = RELIABILITY_RANK[entry.reliability] / 5;
  const quality = 0.5 * STATUS_BOOST[entry.validationStatus] + 0.3 * ORIGIN_BOOST[entry.origin] + 0.2 * reliability;
  // Entries without a target translation are still useful (they document the term) but rank lower.
  const hasTarget = entry.targetText ? 1 : 0.4;
  const score = relevance * (0.6 + 0.4 * quality) * hasTarget;
  return { entry, relevance, score, matchType };
}

/**
 * Retrieve and rank references from the knowledge base for a source text.
 * Pure ranking lives here so both store backends behave identically.
 */
export async function retrieveReferences(store: KnowledgeStore, query: string, options: RetrievalOptions): Promise<RankedReference[]> {
  const candidates = await store.searchCandidates(query, {
    sourceLanguage: options.sourceLanguage,
    targetLanguage: options.targetLanguage,
    includeUnverified: options.includeUnverified ?? true,
    limit: 300,
  });
  const minRelevance = options.minRelevance ?? 0.2;
  const ranked = candidates
    .map((e) => scoreEntry(query, e))
    .filter((r): r is RankedReference => r !== null && r.relevance >= minRelevance)
    .sort((a, b) => b.score - a.score);
  // De-duplicate identical (sourceText, targetText) pairs coming from several sources, keep the best.
  const seen = new Set<string>();
  const out: RankedReference[] = [];
  for (const r of ranked) {
    const key = `${normalizeForLookup(r.entry.sourceText)}::${(r.entry.targetText ?? "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= (options.limit ?? 8)) break;
  }
  return out;
}

/* ------------------------------------------------------------------------- */
/* Direct dictionary lookup (no AI)                                           */
/* ------------------------------------------------------------------------- */

export interface DictionaryMatch {
  /** Entry whose Duala text is applied. */
  best: KnowledgeEntry;
  /** Other entries with the same key but a different Duala text (most reliable first). */
  alternatives: KnowledgeEntry[];
  /** All matching entries with the chosen Duala text (several sources may agree). */
  agreeing: KnowledgeEntry[];
  evidence: EvidenceLevel;
}

const sameDuala = (a: string, b: string) => a.normalize("NFC").toLowerCase().trim() === b.normalize("NFC").toLowerCase().trim();

/** Most trustworthy first: verified, then source reliability, then origin. */
function trustRank(e: KnowledgeEntry): number {
  return (e.validationStatus === "verified" ? 100 : 0) + RELIABILITY_RANK[e.reliability] * 10 + ORIGIN_BOOST[e.origin] * 5;
}

/** Evidence for a direct dictionary hit: high if verified, moderate if established or better, else low. */
export function dictionaryEvidence(e: KnowledgeEntry): EvidenceLevel {
  if (e.validationStatus === "verified") return "high";
  if (RELIABILITY_RANK[e.reliability] >= RELIABILITY_RANK.established) return "moderate";
  return "low";
}

/**
 * Find knowledge entries whose source text is EXACTLY the given text (same dictionary key) and
 * that carry a Duala translation, whatever their review status (rejected entries excluded).
 * When several Duala texts exist, the most reliable wins; ties go to the text most sources agree on.
 */
export async function lookupDictionary(store: KnowledgeStore, text: string, options: Pick<RetrievalOptions, "sourceLanguage" | "targetLanguage">): Promise<DictionaryMatch | null> {
  const key = dictionaryKey(text);
  if (!key) return null;
  const candidates = await store.searchCandidates(text, { sourceLanguage: options.sourceLanguage, targetLanguage: options.targetLanguage, includeUnverified: true, limit: 5000 });
  const matches = candidates.filter((e) => e.targetText && e.targetText.trim() && e.validationStatus !== "rejected" && TRANSLATABLE_CATEGORIES.has(e.category) && dictionaryKey(e.sourceText) === key);
  if (matches.length === 0) return null;
  // Group by Duala text.
  const groups: { target: string; entries: KnowledgeEntry[] }[] = [];
  for (const e of matches) {
    const g = groups.find((x) => sameDuala(x.target, e.targetText!));
    if (g) g.entries.push(e);
    else groups.push({ target: e.targetText!, entries: [e] });
  }
  for (const g of groups) g.entries.sort((a, b) => trustRank(b) - trustRank(a) || a.id.localeCompare(b.id));
  groups.sort((a, b) => trustRank(b.entries[0]!) - trustRank(a.entries[0]!) || b.entries.length - a.entries.length || (a.entries[0]!.category === "sentence_example" ? 1 : 0) - (b.entries[0]!.category === "sentence_example" ? 1 : 0) || a.target.localeCompare(b.target));
  const [winner, ...others] = groups;
  const best = winner!.entries[0]!;
  return { best, agreeing: winner!.entries, alternatives: others.map((g) => g.entries[0]!), evidence: dictionaryEvidence(best) };
}

/**
 * Derive a categorical evidence level from the references that were used.
 * - high: an exact, verified reference with a target translation.
 * - moderate: exact unverified-but-established reference, or verified references covering the phrase.
 * - low: only partial/overlapping references.
 * - unverified: no usable reference.
 */
export function deriveEvidenceLevel(query: string, used: RankedReference[]): EvidenceLevel {
  const withTarget = used.filter((r) => r.entry.targetText);
  if (withTarget.length === 0) return "unverified";
  const exact = withTarget.find((r) => r.matchType === "exact");
  if (exact) {
    if (exact.entry.validationStatus === "verified") return "high";
    if (RELIABILITY_RANK[exact.entry.reliability] >= RELIABILITY_RANK.established) return "moderate";
    return "low";
  }
  const qTokens = new Set(tokenize(query));
  const covered = new Set<string>();
  for (const r of withTarget) {
    if (r.entry.validationStatus !== "verified") continue;
    for (const t of tokenize(r.entry.sourceText)) if (qTokens.has(t)) covered.add(t);
  }
  const coverage = qTokens.size ? covered.size / qTokens.size : 0;
  if (coverage >= 0.8) return "moderate";
  return "low";
}

export function toTranslationReference(r: RankedReference): TranslationReference {
  const e = r.entry;
  return {
    id: e.id,
    category: e.category,
    sourceText: e.sourceText,
    targetText: e.targetText,
    sourceName: e.sourceName,
    sourceUrl: e.sourceUrl,
    reference: e.reference,
    origin: e.origin,
    validationStatus: e.validationStatus,
    reliability: e.reliability,
    note: e.note,
  };
}
