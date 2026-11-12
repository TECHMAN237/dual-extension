export * from "./types";
export * from "./csv";
export * from "./json";
export * from "./html";
export * from "./pdf";
export * from "./fetch";

import type { LinguisticSource, SourceLanguageCode, TargetLanguageCode } from "@douala-ai/shared";
import type { KnowledgeStore } from "../store";
import { extractFromCsv } from "./csv";
import { politeFetch } from "./fetch";
import { extractFromHtml, type HtmlExtractorOptions } from "./html";
import { extractFromJson } from "./json";
import { extractPairsFromText, extractPdfText } from "./pdf";
import { toEntryInputs, type ExtractedPair, type IngestionReport } from "./types";

export interface IngestDocumentOptions {
  store: KnowledgeStore;
  source: LinguisticSource;
  sourceLanguage: SourceLanguageCode;
  targetLanguage?: TargetLanguageCode;
  /** Explicit format; inferred from content type / extension otherwise. */
  format?: "html" | "pdf" | "csv" | "json" | "text";
  html?: HtmlExtractorOptions;
  csvColumns?: Parameters<typeof extractFromCsv>[1];
  /** When true, entries are returned but not written to the store. */
  dryRun?: boolean;
}

function inferFormat(contentType: string | null, ref: string): IngestDocumentOptions["format"] {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("pdf") || ref.toLowerCase().endsWith(".pdf")) return "pdf";
  if (ct.includes("csv") || ref.toLowerCase().endsWith(".csv")) return "csv";
  if (ct.includes("json") || ref.toLowerCase().endsWith(".json")) return "json";
  if (ct.includes("html") || ref.toLowerCase().endsWith(".html") || ref.toLowerCase().endsWith(".htm")) return "html";
  return "text";
}

/** Ingest a document already in memory (buffer) with a known reference (URL or filename). */
export async function ingestBuffer(buffer: Buffer, reference: string, contentType: string | null, opts: IngestDocumentOptions): Promise<IngestionReport> {
  const format = opts.format ?? inferFormat(contentType, reference);
  let pairs: ExtractedPair[];
  switch (format) {
    case "pdf": {
      const { text } = await extractPdfText(buffer);
      pairs = extractPairsFromText(text);
      break;
    }
    case "csv":
      pairs = extractFromCsv(buffer.toString("utf8"), opts.csvColumns);
      break;
    case "json":
      pairs = extractFromJson(buffer.toString("utf8"));
      break;
    case "html":
      pairs = extractFromHtml(buffer.toString("utf8"), opts.html);
      break;
    default:
      pairs = extractPairsFromText(buffer.toString("utf8"));
  }
  const report = toEntryInputs(pairs, {
    source: opts.source,
    sourceLanguage: opts.sourceLanguage,
    targetLanguage: opts.targetLanguage ?? "dua",
    documentReference: reference,
  });
  if (!opts.dryRun && report.entries.length > 0) {
    await opts.store.upsertEntries(report.entries);
    await opts.store.upsertSource({
      ...opts.source,
      ingestionStatus: "ingested",
      lastIngestedAt: new Date().toISOString(),
    });
  }
  return report;
}

/** Fetch a public URL politely and ingest it. */
export async function ingestUrl(url: string, opts: IngestDocumentOptions): Promise<IngestionReport> {
  const res = await politeFetch(url);
  if (!res.ok || !res.body) {
    if (!opts.dryRun) {
      await opts.store.upsertSource({ ...opts.source, ingestionStatus: "failed", notes: `${opts.source.notes ?? ""}\nLast fetch (${new Date().toISOString()}): ${res.message ?? "failed"}`.trim() });
    }
    return { sourceId: opts.source.id, extracted: 0, skipped: 0, warnings: [`Fetch failed: ${res.message ?? `HTTP ${res.status}`} (${res.blockedBy})`], entries: [] };
  }
  return ingestBuffer(res.body, url, res.contentType, opts);
}
