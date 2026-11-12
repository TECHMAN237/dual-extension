import { RELIABILITY_RANK, normalizeForLookup, tokenize } from "@douala-ai/shared";
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

/** Score a single entry against a query; exported for tests. */
export function scoreEntry(query: string, entry: KnowledgeEntry): RankedReference | null {
  const qn = normalizeForLookup(query);
  const en = normalizeForLookup(entry.sourceText);
  if (!qn || !en) return null;
  const qTokens = new Set(tokenize(qn));
  const eTokens = new Set(tokenize(en));

  let relevance: number;
  let matchType: RankedReference["matchType"];
  if (qn === en) {
    relevance = 1;
    matchType = "exact";
  } else if (qn.includes(` ${en} `) || qn.startsWith(`${en} `) || qn.endsWith(` ${en}`)) {
    // Entry is a sub-phrase of the query: useful vocabulary for composing the translation.
    relevance = 0.6 + 0.3 * (eTokens.size / Math.max(qTokens.size, 1));
    matchType = "contained";
  } else if (en.includes(qn)) {
    relevance = 0.5 + 0.3 * (qTokens.size / Math.max(eTokens.size, 1));
    matchType = "contains";
  } else {
    relevance = jaccard(qTokens, eTokens) * 0.8;
    matchType = "overlap";
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
