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
  Coverage,
  WordGloss,
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
  /** Content words of the translated segments found in the Duala dictionary / content words. */
  wordsFound: number;
  wordsTotal: number;
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
  /**
   * Always false in the scan answer: the scan never waits for the server. The server check
   * runs in the background and, if it answers, refines the language through a PROGRESS update.
   */
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
  /** Word-by-word detail: each word → Duala text, or not found. */
  glosses: WordGloss[];
  notFound: string[];
  coverage: Coverage | null;
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

/** Maximum time the popup waits for each action before showing an error instead of spinning. */
export const MESSAGE_TIMEOUTS_MS: Partial<Record<BackgroundMessage["type"], number>> = {
  GET_STATE: 8_000,
  SCAN: 30_000,
  RESTORE: 15_000,
  LIST_TRANSLATIONS: 8_000,
  // Translation of a long page is batched and can legitimately take a few minutes.
  TRANSLATE: 300_000,
};
const DEFAULT_MESSAGE_TIMEOUT_MS = 30_000;

export class MessageTimeoutError extends Error {
  readonly code = "timeout";
  constructor(type: string, ms: number) {
    super(`The extension did not answer "${type}" within ${Math.round(ms / 1000)} s. Reload the page and try again.`);
    this.name = "MessageTimeoutError";
  }
}

/** Race a promise against a timeout (the timer is always cleared). */
export function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Typed wrapper around chrome.runtime.sendMessage with envelope unwrapping and a timeout. */
export async function sendToBackground<M extends BackgroundMessage>(message: M, timeoutMs?: number): Promise<ResultFor<M>> {
  const ms = timeoutMs ?? MESSAGE_TIMEOUTS_MS[message.type] ?? DEFAULT_MESSAGE_TIMEOUT_MS;
  const response = (await withTimeout(chrome.runtime.sendMessage(message) as Promise<unknown>, ms, () => new MessageTimeoutError(message.type, ms))) as Envelope<ResultFor<M>> | undefined;
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
