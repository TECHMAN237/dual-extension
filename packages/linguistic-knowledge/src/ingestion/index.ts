export * from "./types";
export * from "./classify";
export * from "./grammar";
export * from "./csv";
export * from "./json";
export * from "./html";
export * from "./pdf";
export * from "./fetch";
export * from "./sites";

import type { LinguisticSource, SourceLanguageCode, TargetLanguageCode } from "@douala-ai/shared";
import type { KnowledgeEntryInput, KnowledgeStore } from "../store";
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
  /**
   * Import as `verified` (a list checked by a Duala speaker). Only allowed for the source
   * `manual-linguist-entries`; rows without a translation are skipped.
   */
  verified?: boolean;
  /** Name or initials of the speaker who reviewed a verified import (stored in the note). */
  reviewer?: string;
}

function inferFormat(contentType: string | null, ref: string): IngestDocumentOptions["format"] {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("pdf") || ref.toLowerCase().endsWith(".pdf")) return "pdf";
  if (ct.includes("csv") || ref.toLowerCase().endsWith(".csv")) return "csv";
  if (ct.includes("json") || ref.toLowerCase().endsWith(".json")) return "json";
  if (ct.includes("html") || ref.toLowerCase().endsWith(".html") || ref.toLowerCase().endsWith(".htm")) return "html";
  return "text";
}

/**
 * Upsert extracted entries without undoing human review: when an entry with the same
 * (deterministic) id already exists, its validation status, note and extraction date are kept.
 * Exception: an entry imported as `verified` (a list checked by a speaker, see VERIFIED_IMPORT_SOURCE_ID)
 * is itself a human review, so it upgrades a pending entry.
 */
export async function writeEntriesKeepingReview(store: KnowledgeStore, entries: KnowledgeEntryInput[]): Promise<void> {
  const ids = entries.map((e) => e.id).filter((id): id is string => Boolean(id));
  const existing = new Map((await store.getEntries(ids)).map((e) => [e.id, e]));
  await store.upsertEntries(
    entries.map((e) => {
      const prev = e.id ? existing.get(e.id) : undefined;
      if (!prev) return e;
      if (e.validationStatus === "verified") return { ...e, extractedAt: prev.extractedAt };
      return { ...e, validationStatus: prev.validationStatus, note: prev.note ?? e.note, extractedAt: prev.extractedAt };
    }),
  );
}

/** The only source whose files may be imported directly as `verified` (`pnpm ingest --verified`). */
export const VERIFIED_IMPORT_SOURCE_ID = "manual-linguist-entries";

/**
 * Mark entries from a list checked by a Duala speaker as verified. Rows without a Duala translation
 * are dropped (a verified entry must have a target). Throws for any other source.
 */
export function asVerifiedImport(source: LinguisticSource, entries: KnowledgeEntryInput[], reviewer?: string): KnowledgeEntryInput[] {
  if (source.id !== VERIFIED_IMPORT_SOURCE_ID) {
    throw new Error(`--verified is only allowed for the source "${VERIFIED_IMPORT_SOURCE_ID}" (got "${source.id}"). Dictionary imports stay pending.`);
  }
  const date = new Date().toISOString().slice(0, 10);
  return entries
    .filter((e) => e.targetText && e.targetText.trim())
    .map((e) => ({
      ...e,
      origin: "verified_source" as const,
      validationStatus: "verified" as const,
      note: [e.note, `Verified by a Duala speaker${reviewer ? ` (${reviewer})` : ""}, import ${date}.`].filter(Boolean).join(" — "),
      tags: [...new Set([...(e.tags ?? []), "speaker-verified"])],
    }));
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
  if (opts.verified) {
    const before = report.entries.length;
    report.entries = asVerifiedImport(opts.source, report.entries, opts.reviewer);
    report.skipped += before - report.entries.length;
    report.extracted = report.entries.length;
    if (before > report.entries.length) report.warnings.push(`${before - report.entries.length} row(s) without a Duala translation were skipped (a verified entry needs a target).`);
  }
  if (!opts.dryRun && report.entries.length > 0) {
    await writeEntriesKeepingReview(opts.store, report.entries);
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
