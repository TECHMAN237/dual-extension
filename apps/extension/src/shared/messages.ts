import type {
  CorrectionRecord,
  CorrectionSubmission,
  EvidenceLevel,
  HealthResponse,
  ScanAnalyzeRequest,
  ScanAnalyzeResponse,
  SegmentContext,
  SourceLanguageCode,
  SourceLanguageSelection,
  TargetLanguageCode,
  TranslateBatchRequest,
  TranslateBatchResponse,
  TranslationReference,
  TranslationStatus,
} from "@douala-ai/shared";

/* ------------------------------------------------------------------------- */
/* Session state shared between content script, background and popup         */
/* ------------------------------------------------------------------------- */

export type SessionStatus = "idle" | "scanning" | "scanned" | "translating" | "translated" | "restoring" | "error";

export interface EvidenceCounts {
  high: number;
  moderate: number;
  low: number;
  unverified: number;
}

/** Serialisable snapshot of the content-script session (never contains page text). */
export interface SessionSnapshot {
  status: SessionStatus;
  domain: string;
  url: string;
  htmlLang: string | null;
  sourceLanguage: SourceLanguageSelection;
  resolvedSourceLanguage: SourceLanguageCode | null;
  targetLanguage: TargetLanguageCode;
  detectedLanguage: SourceLanguageCode | null;
  detectionConfidence: "high" | "medium" | "low" | null;
  totalSegments: number;
  requestedCount: number;
  translatedCount: number;
  uncertainCount: number;
  skippedCount: number;
  errorCount: number;
  completedCount: number;
  evidence: EvidenceCounts;
  mock: boolean;
  provider: string | null;
  model: string | null;
  /** Set when the page navigated (SPA) since the last scan. */
  navigated: boolean;
  errorMessage: string | null;
  updatedAt: number;
}

export interface ScanResult {
  domain: string;
  url: string;
  htmlLang: string | null;
  detectedLanguage: SourceLanguageCode | null;
  detectionConfidence: "high" | "medium" | "low" | null;
  totalSegments: number;
  /** Whether the backend analysis was reachable. */
  analyzedByBackend: boolean;
}

/** Per-segment translation info exposed to the Corrections tab. */
export interface TranslatedSegmentInfo {
  id: string;
  sourceText: string;
  translatedText: string | null;
  status: TranslationStatus;
  evidence: EvidenceLevel;
  needsReview: boolean;
  references: TranslationReference[];
  note: string | null;
  context: SegmentContext;
}

export interface SessionSummary {
  domain: string;
  sourceLanguage: SourceLanguageCode;
  targetLanguage: TargetLanguageCode;
  totalSegments: number;
  translatedCount: number;
  uncertainCount: number;
  errorCount: number;
  status: "completed" | "partial" | "failed";
}

/* ------------------------------------------------------------------------- */
/* Messages                                                                   */
/* ------------------------------------------------------------------------- */

/** Popup → background. */
export type PopupMessage =
  | { type: "SCAN" }
  | { type: "TRANSLATE"; sourceLanguage: SourceLanguageSelection }
  | { type: "RESTORE" }
  | { type: "GET_STATE" }
  | { type: "LIST_TRANSLATIONS" }
  | { type: "OPEN_OPTIONS" };

/** Content script → background (backend proxy + history). */
export type ContentMessage =
  | { type: "API_TRANSLATE_BATCH"; body: TranslateBatchRequest }
  | { type: "API_SCAN_ANALYZE"; body: ScanAnalyzeRequest }
  | { type: "SESSION_COMPLETE"; summary: SessionSummary }
  | { type: "GET_SETTINGS" };

/** Popup → background API proxy (popup can also call the backend directly). */
export type ApiMessage =
  | { type: "API_HEALTH" }
  | { type: "API_SUBMIT_CORRECTION"; body: CorrectionSubmission }
  | { type: "API_CORRECTION_STATUS"; ids: string[] };

export type BackgroundMessage = PopupMessage | ContentMessage | ApiMessage;

/** Background → content script (chrome.tabs.sendMessage). */
export type TabMessage =
  | { type: "CS_PING" }
  | { type: "CS_SCAN" }
  | { type: "CS_TRANSLATE"; sourceLanguage: SourceLanguageSelection; translateDynamicContent: boolean }
  | { type: "CS_RESTORE" }
  | { type: "CS_GET_STATE" }
  | { type: "CS_LIST_TRANSLATIONS" };

/** Broadcast from the content script to extension pages. */
export interface ProgressMessage {
  type: "PROGRESS";
  state: SessionSnapshot;
}

export type Envelope<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

export interface MessageResults {
  SCAN: ScanResult;
  TRANSLATE: SessionSnapshot;
  RESTORE: SessionSnapshot;
  GET_STATE: SessionSnapshot;
  LIST_TRANSLATIONS: TranslatedSegmentInfo[];
  OPEN_OPTIONS: null;
  API_TRANSLATE_BATCH: TranslateBatchResponse;
  API_SCAN_ANALYZE: ScanAnalyzeResponse;
  API_HEALTH: HealthResponse;
  API_SUBMIT_CORRECTION: CorrectionRecord;
  API_CORRECTION_STATUS: { corrections: CorrectionRecord[] };
  SESSION_COMPLETE: null;
  GET_SETTINGS: import("./storage").Settings;
}

export type ResultFor<M extends { type: keyof MessageResults }> = MessageResults[M["type"]];

/** Typed wrapper around chrome.runtime.sendMessage with envelope unwrapping. */
export async function sendToBackground<M extends BackgroundMessage>(message: M): Promise<ResultFor<M>> {
  const response = (await chrome.runtime.sendMessage(message)) as Envelope<ResultFor<M>> | undefined;
  if (!response) throw new Error("No response from the extension background worker.");
  if (!response.ok) {
    const err = new Error(response.error);
    (err as Error & { code?: string }).code = response.code;
    throw err;
  }
  return response.data;
}

export function ok<T>(data: T): Envelope<T> {
  return { ok: true, data };
}

export function fail(error: unknown, code?: string): Envelope<never> {
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, error: message, code: code ?? (error as { code?: string })?.code };
}
