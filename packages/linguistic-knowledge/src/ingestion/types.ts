import type { KnowledgeCategory, LinguisticSource, SourceLanguageCode, TargetLanguageCode } from "@douala-ai/shared";
import type { KnowledgeEntryInput } from "../store";

export interface ExtractedPair {
  sourceText: string;
  targetText: string | null;
  category?: KnowledgeCategory;
  context?: string | null;
  example?: string | null;
  note?: string | null;
  /** Page number, entry anchor, line number, etc. */
  reference?: string | null;
  tags?: string[];
}

export interface IngestionContext {
  source: LinguisticSource;
  sourceLanguage: SourceLanguageCode;
  targetLanguage: TargetLanguageCode;
  /** Document reference (URL or file name) recorded on each entry. */
  documentReference?: string;
}

export interface IngestionReport {
  sourceId: string;
  extracted: number;
  skipped: number;
  warnings: string[];
  entries: KnowledgeEntryInput[];
}

/**
 * Convert extracted pairs into store inputs with full provenance. Everything
 * ingested automatically is marked `extracted_unverified` / `pending`: a
 * linguist must verify it before it becomes "high evidence".
 */
export function toEntryInputs(pairs: ExtractedPair[], ctx: IngestionContext): IngestionReport {
  const warnings: string[] = [];
  const entries: KnowledgeEntryInput[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const p of pairs) {
    const sourceText = p.sourceText.replace(/\s+/g, " ").trim();
    const targetText = p.targetText ? p.targetText.replace(/\s+/g, " ").trim() : null;
    if (!sourceText || sourceText.length > 2000 || (targetText && targetText.length > 2000)) {
      skipped++;
      continue;
    }
    const key = `${sourceText.toLowerCase()}::${(targetText ?? "").toLowerCase()}::${p.category ?? "vocabulary"}`;
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    entries.push({
      sourceLanguage: ctx.sourceLanguage,
      targetLanguage: ctx.targetLanguage,
      sourceText,
      targetText,
      category: p.category ?? "vocabulary",
      context: p.context ?? null,
      example: p.example ?? null,
      note: p.note ?? null,
      sourceId: ctx.source.id,
      sourceName: ctx.source.name,
      sourceUrl: ctx.source.url,
      reference: p.reference ?? ctx.documentReference ?? null,
      origin: ctx.source.type === "manual_entry" ? "verified_source" : "extracted_unverified",
      validationStatus: "pending",
      reliability: ctx.source.reliability,
      tags: p.tags ?? [],
    });
  }
  if (entries.length === 0) warnings.push("No entries extracted. Check the extractor selectors or the document format.");
  return { sourceId: ctx.source.id, extracted: entries.length, skipped, warnings, entries };
}
