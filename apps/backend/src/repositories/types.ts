import type { CorrectionRecord, CorrectionSubmission, HistoryRecord, SourceLanguageCode, TargetLanguageCode } from "@douala-ai/shared";

export interface HistoryInput {
  clientId: string;
  domain: string;
  sourceLanguage: SourceLanguageCode;
  targetLanguage: TargetLanguageCode;
  translatedCount: number;
  uncertainCount: number;
  status: HistoryRecord["status"];
}

export interface UsageInput {
  clientId: string | null;
  provider: string;
  model: string;
  tier: string;
  items: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  ok: boolean;
  error?: string;
}

export interface UsageSummary {
  requests: number;
  failures: number;
  items: number;
  inputTokens: number;
  outputTokens: number;
  byModel: Record<string, { requests: number; items: number; inputTokens: number; outputTokens: number }>;
}

export interface CorrectionsRepository {
  create(input: CorrectionSubmission): Promise<CorrectionRecord>;
  getByIds(ids: string[]): Promise<CorrectionRecord[]>;
  listByClient(clientId: string, limit?: number): Promise<CorrectionRecord[]>;
  list(options: { status?: CorrectionRecord["status"]; limit?: number; offset?: number }): Promise<CorrectionRecord[]>;
  review(id: string, status: "approved" | "rejected", reviewNote: string | null, reviewer: string): Promise<CorrectionRecord | null>;
  /** Count of pending corrections submitted by a client in the last 24h (abuse protection). */
  countRecent(clientId: string, sinceIso: string): Promise<number>;
}

export interface HistoryRepository {
  record(input: HistoryInput): Promise<HistoryRecord>;
  listByClient(clientId: string, limit?: number): Promise<HistoryRecord[]>;
}

export interface UsageRepository {
  record(input: UsageInput): Promise<void>;
  summary(sinceIso: string): Promise<UsageSummary>;
}

export interface Repositories {
  corrections: CorrectionsRepository;
  history: HistoryRepository;
  usage: UsageRepository;
}
