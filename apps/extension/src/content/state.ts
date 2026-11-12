import type { SourceLanguageCode, SourceLanguageSelection, TargetLanguageCode } from "@douala-ai/shared";
import type { EvidenceCounts, SessionSnapshot, SessionStatus } from "../shared/messages";

export function emptyEvidence(): EvidenceCounts {
  return { high: 0, moderate: 0, low: 0, unverified: 0 };
}

export interface SessionState extends SessionSnapshot {}

export function createInitialState(): SessionState {
  return {
    status: "idle",
    domain: typeof location !== "undefined" ? location.hostname : "",
    url: typeof location !== "undefined" ? location.href : "",
    htmlLang: typeof document !== "undefined" ? document.documentElement.getAttribute("lang") : null,
    sourceLanguage: "auto",
    resolvedSourceLanguage: null,
    targetLanguage: "dua",
    detectedLanguage: null,
    detectionConfidence: null,
    totalSegments: 0,
    requestedCount: 0,
    translatedCount: 0,
    uncertainCount: 0,
    skippedCount: 0,
    errorCount: 0,
    completedCount: 0,
    evidence: emptyEvidence(),
    mock: false,
    provider: null,
    model: null,
    navigated: false,
    errorMessage: null,
    updatedAt: Date.now(),
  };
}

export function resetCounts(state: SessionState): void {
  state.requestedCount = 0;
  state.translatedCount = 0;
  state.uncertainCount = 0;
  state.skippedCount = 0;
  state.errorCount = 0;
  state.completedCount = 0;
  state.evidence = emptyEvidence();
  state.errorMessage = null;
}

export function setStatus(state: SessionState, status: SessionStatus): void {
  state.status = status;
  state.updatedAt = Date.now();
}

export function setLanguages(state: SessionState, source: SourceLanguageSelection, resolved: SourceLanguageCode | null, target: TargetLanguageCode): void {
  state.sourceLanguage = source;
  state.resolvedSourceLanguage = resolved;
  state.targetLanguage = target;
}

export function snapshot(state: SessionState): SessionSnapshot {
  return { ...state, evidence: { ...state.evidence } };
}
