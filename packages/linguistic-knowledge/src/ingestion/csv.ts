import { parse } from "csv-parse/sync";
import type { KnowledgeCategory } from "@douala-ai/shared";
import { KNOWLEDGE_CATEGORIES } from "@douala-ai/shared";
import type { ExtractedPair } from "./types";

export interface CsvColumnMap {
  source: string;
  target: string;
  category?: string;
  context?: string;
  example?: string;
  note?: string;
  reference?: string;
}

const DEFAULT_COLUMNS: CsvColumnMap = {
  source: "source_text",
  target: "target_text",
  category: "category",
  context: "context",
  example: "example",
  note: "note",
  reference: "reference",
};

/**
 * Extract pairs from CSV text. Header names are configurable so dictionaries
 * exported from spreadsheets can be imported without reformatting.
 */
export function extractFromCsv(csv: string, columns: Partial<CsvColumnMap> = {}): ExtractedPair[] {
  const cols = { ...DEFAULT_COLUMNS, ...columns };
  const records = parse(csv, { columns: true, skip_empty_lines: true, trim: true, bom: true, relax_column_count: true }) as Record<string, string>[];
  const pairs: ExtractedPair[] = [];
  records.forEach((rec, i) => {
    const sourceText = rec[cols.source]?.trim();
    if (!sourceText) return;
    const target = rec[cols.target]?.trim();
    const rawCategory = cols.category ? rec[cols.category]?.trim() : undefined;
    const category = (KNOWLEDGE_CATEGORIES as readonly string[]).includes(rawCategory ?? "") ? (rawCategory as KnowledgeCategory) : undefined;
    pairs.push({
      sourceText,
      targetText: target ? target : null,
      category,
      context: cols.context ? rec[cols.context]?.trim() || null : null,
      example: cols.example ? rec[cols.example]?.trim() || null : null,
      note: cols.note ? rec[cols.note]?.trim() || null : null,
      reference: cols.reference ? rec[cols.reference]?.trim() || `row ${i + 2}` : `row ${i + 2}`,
    });
  });
  return pairs;
}
