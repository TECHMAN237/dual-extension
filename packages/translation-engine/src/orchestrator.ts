import {
  detectSourceLanguage,
  isUntranslatableText,
  normalizeWhitespace,
  type SegmentContext,
  type SourceLanguageCode,
  type TargetLanguageCode,
  type TranslateBatchRequest,
  type TranslateBatchResponse,
  type TranslationResult,
  type EvidenceLevel,
} from "@douala-ai/shared";
import { contentTokens, type KnowledgeEntry } from "@douala-ai/shared";
import {
  TRANSLATABLE_CATEGORIES,
  deriveEvidenceLevel,
  lookupDictionary,
  retrieveReferences,
  toTranslationReference,
  type DictionaryMatch,
  type KnowledgeStore,
  type RankedReference,
} from "@douala-ai/linguistic-knowledge";
import { TranslationCache } from "./cache";
import type { EngineConfig, TranslationMode } from "./config";
import { MalformedOutputError, checkAssistedTranslation, parseLlmOutput, validateTranslationText } from "./output";
import { LLM_OUTPUT_JSON_SCHEMA, buildSystemPrompt, buildUserPrompt, toPromptItem, type PromptItem } from "./prompt";
import { ProviderError, type LlmProvider } from "./providers/types";
import { createLimiter, withRetry } from "./retry";
import { modelForTier, partitionItems } from "./router";

export interface UsageEvent {
  provider: string;
  model: string;
  tier: "fast" | "capable" | "fallback";
  items: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  ok: boolean;
  error?: string;
}

export interface EngineLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export interface TranslationEngineOptions {
  config: EngineConfig;
  provider: LlmProvider;
  store: KnowledgeStore;
  logger?: EngineLogger;
  onUsage?: (event: UsageEvent) => void;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const EVIDENCE_ORDER: EvidenceLevel[] = ["unverified", "low", "moderate", "high"];
function weakerEvidence(a: EvidenceLevel, b: EvidenceLevel): EvidenceLevel {
  return EVIDENCE_ORDER.indexOf(a) <= EVIDENCE_ORDER.indexOf(b) ? a : b;
}

/** Match the capitalisation pattern of the source onto a verified target string. */
export function matchCase(source: string, target: string): string {
  if (!target) return target;
  const letters = source.replace(/[^\p{L}]/gu, "");
  if (letters.length > 1 && letters === letters.toUpperCase()) return target.toUpperCase();
  const first = source.match(/\p{L}/u)?.[0];
  if (first && first === first.toUpperCase()) return target.charAt(0).toUpperCase() + target.slice(1);
  return target;
}

interface WorkItem {
  key: string;
  text: string;
  context: SegmentContext;
  ids: string[];
  refs: RankedReference[];
  /** Assisted mode: content words of the segment that have a Duala reference. */
  anchors: { word: string; reference: RankedReference }[];
  result?: Omit<TranslationResult, "id" | "cached">;
  cached: boolean;
}

/** How a segment will be handled (see TranslationEngine.plan). */
export type PlanRoute = "dictionary" | "assisted" | "model" | "kept";
export interface SegmentPlan {
  text: string;
  route: PlanRoute;
  /** Duala text applied directly (route "dictionary"). */
  translation: string | null;
  evidence: EvidenceLevel;
  /** Words with a Duala reference (assisted mode). */
  anchors: { word: string; duala: string }[];
  note: string | null;
}

const asReference = (entry: KnowledgeEntry, matchType: RankedReference["matchType"] = "exact"): RankedReference => ({ entry, relevance: 1, score: 1, matchType });

export class TranslationEngine {
  private readonly cache: TranslationCache;
  private readonly limit: <T>(fn: () => Promise<T>) => Promise<T>;
  private readonly logger: EngineLogger;

  constructor(private readonly opts: TranslationEngineOptions) {
    this.cache = new TranslationCache(opts.config.cacheTtlSeconds * 1000, opts.config.cacheMaxEntries);
    this.limit = createLimiter(opts.config.concurrency);
    this.logger = opts.logger ?? { info() {}, warn() {}, error() {} };
  }

  get isMock(): boolean {
    return this.opts.provider.name === "mock";
  }

  /**
   * Effective translation mode. The mock provider keeps the strict pipeline so that the whole
   * interface can still be exercised with visible "[MOCK dua] …" placeholders without a key.
   */
  get mode(): TranslationMode {
    return this.isMock ? "strict" : this.opts.config.translationMode;
  }

  /** Apply an exact dictionary entry directly (no model). */
  private dictionaryResult(text: string, dict: DictionaryMatch): Omit<TranslationResult, "id" | "cached"> {
    const verified = dict.best.validationStatus === "verified";
    const others = dict.alternatives.map((a) => `${a.targetText} (${a.sourceName}${a.validationStatus === "verified" ? ", verified" : ""})`);
    const notes = [
      verified ? null : "Direct dictionary match, not yet verified by a Duala speaker.",
      others.length ? `Other translations in the knowledge base: ${others.join("; ")}.` : null,
    ].filter(Boolean);
    return {
      sourceText: text,
      translatedText: matchCase(text, dict.best.targetText!),
      status: "translated",
      evidence: dict.evidence,
      needsReview: !verified,
      references: [dict.best, ...dict.alternatives].map((e) => toTranslationReference(asReference(e))),
      note: notes.length ? notes.join(" ") : null,
    };
  }

  /** Assisted mode: content words of the segment that have an exact Duala entry, plus contained phrases. */
  private async anchorsFor(text: string, refs: RankedReference[], sourceLanguage: SourceLanguageCode, targetLanguage: TargetLanguageCode): Promise<WorkItem["anchors"]> {
    const anchors: WorkItem["anchors"] = [];
    const seen = new Set<string>();
    // Capitalised words after the first word ("Safinum Pay", "Banque Atlantique") are treated as
    // proper names or brands: they stay as written and never anchor a translation.
    const properNames = new Set(
      text
        .split(/\s+/)
        .slice(1)
        .filter((w) => /^\p{Lu}/u.test(w))
        .flatMap((w) => contentTokens(w)),
    );
    for (const word of [...new Set(contentTokens(text))].filter((t) => !properNames.has(t))) {
      const hit = await lookupDictionary(this.opts.store, word, { sourceLanguage, targetLanguage });
      if (hit && !seen.has(hit.best.id)) {
        seen.add(hit.best.id);
        anchors.push({ word, reference: asReference(hit.best, "contained") });
      }
    }
    for (const r of refs) {
      if (!r.entry.targetText || !TRANSLATABLE_CATEGORIES.has(r.entry.category) || r.entry.category === "sentence_example") continue;
      if ((r.matchType === "contained" || r.matchType === "exact") && !seen.has(r.entry.id)) {
        seen.add(r.entry.id);
        anchors.push({ word: r.entry.sourceText, reference: r });
      }
    }
    return anchors;
  }

  /**
   * Decide how one segment is handled, without calling the model:
   * dictionary hit → applied directly; assisted mode without any anchored word → original kept;
   * otherwise the segment goes to the model (with the references it may use).
   */
  private async prepare(w: WorkItem, sourceLanguage: SourceLanguageCode, targetLanguage: TargetLanguageCode): Promise<"dictionary" | "kept" | "model"> {
    const { store, config } = this.opts;
    const dict = await lookupDictionary(store, w.text, { sourceLanguage, targetLanguage });
    if (dict) {
      w.result = this.dictionaryResult(w.text, dict);
      return "dictionary";
    }
    w.refs = await retrieveReferences(store, w.text, { sourceLanguage, targetLanguage, limit: config.maxReferencesPerItem });
    if (this.mode === "assisted") {
      w.anchors = await this.anchorsFor(w.text, w.refs, sourceLanguage, targetLanguage);
      if (w.anchors.length === 0) {
        w.result = { sourceText: w.text, translatedText: null, status: "uncertain", evidence: "unverified", needsReview: true, references: [], note: "No content word of this text has a Duala reference: original text kept." };
        return "kept";
      }
      // Anchored words first so they are always part of the prompt.
      const ids = new Set(w.anchors.map((a) => a.reference.entry.id));
      w.refs = [...w.anchors.map((a) => a.reference), ...w.refs.filter((r) => !ids.has(r.entry.id))].slice(0, Math.max(config.maxReferencesPerItem, w.anchors.length));
    }
    return "model";
  }

  /** Coverage analysis: how each text would be handled (no model call, nothing cached). */
  async plan(texts: string[], sourceLanguage: SourceLanguageCode, targetLanguage: TargetLanguageCode = "dua"): Promise<SegmentPlan[]> {
    const out: SegmentPlan[] = [];
    for (const raw of texts) {
      const text = normalizeWhitespace(raw);
      if (isUntranslatableText(text)) {
        out.push({ text, route: "kept", translation: null, evidence: "unverified", anchors: [], note: "Not translatable (identifier, number, URL or email)." });
        continue;
      }
      const w: WorkItem = { key: "", text, context: "other", ids: [], refs: [], anchors: [], cached: false };
      const route = await this.prepare(w, sourceLanguage, targetLanguage);
      out.push({
        text,
        route: route === "model" ? (this.mode === "assisted" ? "assisted" : "model") : route,
        translation: route === "dictionary" ? (w.result?.translatedText ?? null) : null,
        evidence: route === "dictionary" ? w.result!.evidence : route === "model" && this.mode === "assisted" ? "low" : "unverified",
        anchors: w.anchors.map((a) => ({ word: a.word, duala: a.reference.entry.targetText ?? "" })),
        note: w.result?.note ?? null,
      });
    }
    return out;
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  clearCache(): void {
    this.cache.clear();
  }

  resolveSourceLanguage(request: Pick<TranslateBatchRequest, "sourceLanguage" | "items">): { language: SourceLanguageCode; detected: TranslateBatchResponse["detectedLanguage"] } {
    const detection = detectSourceLanguage(request.items.map((i) => i.text).join(" \n "));
    const detected = detection.language ? { language: detection.language, confidence: detection.confidence } : null;
    if (request.sourceLanguage !== "auto") return { language: request.sourceLanguage, detected };
    return { language: detection.language ?? "en", detected };
  }

  async translateBatch(request: TranslateBatchRequest): Promise<TranslateBatchResponse> {
    const { config, store, provider } = this.opts;
    const { language: sourceLanguage, detected } = this.resolveSourceLanguage(request);
    const targetLanguage: TargetLanguageCode = request.targetLanguage;

    // 1. Normalise, skip untranslatable, de-duplicate.
    const work = new Map<string, WorkItem>();
    const skipped: TranslationResult[] = [];
    for (const item of request.items) {
      const text = normalizeWhitespace(item.text);
      if (isUntranslatableText(text)) {
        skipped.push({ id: item.id, sourceText: item.text, translatedText: null, status: "skipped", evidence: "unverified", needsReview: false, references: [], note: "Not translatable (identifier, number, URL or email).", cached: false });
        continue;
      }
      const key = TranslationCache.key(text, sourceLanguage, targetLanguage, item.context, `${provider.name}:${this.mode}`);
      const existing = work.get(key);
      if (existing) existing.ids.push(item.id);
      else work.set(key, { key, text, context: item.context, ids: [item.id], refs: [], anchors: [], cached: false });
    }

    // 2. Cache lookup.
    for (const w of work.values()) {
      const hit = this.cache.get(w.key);
      if (hit) {
        w.result = hit;
        w.cached = true;
      }
    }

    // 3. Dictionary layer and retrieval for uncached items:
    //    - an exact dictionary entry with a Duala text is applied directly, without the model;
    //    - assisted mode: segments without any anchored content word keep their original text;
    //    - everything else goes to the model with its references.
    const pending: WorkItem[] = [];
    await Promise.all(
      [...work.values()]
        .filter((w) => !w.result)
        .map(async (w) => {
          const route = await this.prepare(w, sourceLanguage, targetLanguage);
          if (route === "model") pending.push(w);
          else this.cache.set(w.key, w.result!);
        }),
    );

    // 4. Model calls in batches, per tier, with concurrency limit.
    const promptItems = pending.map((w) => toPromptItem(w.key, w.text, w.context, w.refs));
    const byKey = new Map(pending.map((w) => [w.key, w]));
    const batches = partitionItems(promptItems, config.batchSize);
    await Promise.all(
      batches.map((batch) =>
        this.limit(async () => {
          const outputs = await this.runBatch(batch.items, batch.tier, sourceLanguage, targetLanguage, request.domain);
          for (const out of outputs) {
            const w = byKey.get(out.id);
            if (!w) continue;
            w.result = this.finalise(w, out);
            if (w.result.status !== "error") this.cache.set(w.key, w.result);
          }
        }),
      ),
    );

    // 5. Assemble per-id results.
    const results: TranslationResult[] = [...skipped];
    for (const w of work.values()) {
      const base = w.result ?? { sourceText: w.text, translatedText: null, status: "error" as const, evidence: "unverified" as const, needsReview: true, references: [], note: "No result produced." };
      for (const id of w.ids) results.push({ id, ...base, cached: w.cached });
    }
    const order = new Map(request.items.map((i, idx) => [i.id, idx]));
    results.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

    return {
      sourceLanguage,
      targetLanguage,
      detectedLanguage: detected,
      results,
      provider: provider.name,
      model: this.isMock ? null : config.model,
      mock: this.isMock,
    };
  }

  private finalise(w: WorkItem, out: { translation: string | null; evidence: EvidenceLevel; usedReferenceIds: string[]; note: string | null; failed?: boolean }): Omit<TranslationResult, "id" | "cached"> {
    if (out.failed) {
      return { sourceText: w.text, translatedText: null, status: "error", evidence: "unverified", needsReview: true, references: [], note: out.note };
    }
    const used = w.refs.filter((r) => out.usedReferenceIds.includes(r.entry.id));
    const supporting = used.length > 0 ? used : w.refs.filter((r) => r.matchType === "exact" || r.matchType === "contained");
    const derived = deriveEvidenceLevel(w.text, supporting);
    const evidence = weakerEvidence(out.evidence, derived);
    const check = validateTranslationText(w.text, out.translation);
    if (!check.ok) {
      this.logger.warn({ reason: check.reason }, "translation rejected by output validation");
      return { sourceText: w.text, translatedText: null, status: "uncertain", evidence: "unverified", needsReview: true, references: supporting.map(toTranslationReference), note: `Output rejected: ${check.reason}.` };
    }
    if (out.translation === null) {
      return { sourceText: w.text, translatedText: null, status: "uncertain", evidence: "unverified", needsReview: true, references: supporting.map(toTranslationReference), note: out.note ?? "Insufficient linguistic evidence." };
    }
    if (this.mode === "assisted") {
      // Anti-invention: every word must come from the segment (loan) or from its references,
      // and at least one Duala word from the references must be present.
      const withTarget = w.refs.filter((r) => r.entry.targetText);
      const check2 = checkAssistedTranslation(w.text, out.translation, withTarget.map((r) => r.entry.targetText!));
      if (!check2.ok) {
        this.logger.warn({ reason: check2.reason }, "assisted translation rejected by the anti-invention check");
        return { sourceText: w.text, translatedText: null, status: "uncertain", evidence: "unverified", needsReview: true, references: withTarget.map(toTranslationReference), note: `Assisted output rejected (anti-invention check): ${check2.reason}. Original text kept.` };
      }
      const used = withTarget.filter((r) => check2.usedTargets.includes(r.entry.targetText!));
      return {
        sourceText: w.text,
        translatedText: out.translation,
        status: "translated",
        // Assisted translations are at best "low" evidence and always need a speaker's review.
        evidence: weakerEvidence("low", out.evidence === "unverified" ? "unverified" : "low"),
        needsReview: true,
        references: used.map(toTranslationReference),
        note: ["Assisted translation: words without a Duala reference were kept as loans.", out.note].filter(Boolean).join(" "),
      };
    }
    return {
      sourceText: w.text,
      translatedText: out.translation,
      status: "translated",
      evidence,
      needsReview: evidence === "low" || evidence === "unverified",
      references: supporting.map(toTranslationReference),
      note: out.note,
    };
  }

  private async runBatch(items: PromptItem[], tier: "fast" | "capable", source: SourceLanguageCode, target: TargetLanguageCode, domain?: string) {
    const { config, provider } = this.opts;
    const ids = items.map((i) => i.id);
    const system = buildSystemPrompt(source, target, this.mode);
    const user = buildUserPrompt(items, source, target, domain);
    const maxTokens = Math.min(16_000, 400 + items.reduce((n, i) => n + i.text.length * 3, 0));
    const primaryModel = modelForTier(config, tier);

    const attempt = async (model: string, usageTier: UsageEvent["tier"]) => {
      const started = Date.now();
      try {
        const res = await withRetry(
          () => provider.complete({ model, system, user, jsonSchema: LLM_OUTPUT_JSON_SCHEMA, maxTokens, timeoutMs: config.timeoutMs, effort: config.effort }),
          { maxRetries: config.maxRetries, sleep: this.opts.sleep, onRetry: (n, err) => this.logger.warn({ attempt: n, err: (err as Error).message }, "retrying provider call") },
        );
        this.opts.onUsage?.({ provider: provider.name, model: res.model, tier: usageTier, items: items.length, inputTokens: res.usage?.inputTokens ?? 0, outputTokens: res.usage?.outputTokens ?? 0, durationMs: Date.now() - started, ok: true });
        if (res.refused) throw new ProviderError("The model declined this request", { retryable: false, provider: provider.name });
        return parseLlmOutput(res.text, ids).items;
      } catch (err) {
        this.opts.onUsage?.({ provider: provider.name, model, tier: usageTier, items: items.length, inputTokens: 0, outputTokens: 0, durationMs: Date.now() - started, ok: false, error: (err as Error).message });
        throw err;
      }
    };

    try {
      try {
        return await attempt(primaryModel, tier);
      } catch (err) {
        if (err instanceof MalformedOutputError) {
          this.logger.warn({ model: primaryModel }, "malformed model output, retrying once");
          return await attempt(primaryModel, tier);
        }
        throw err;
      }
    } catch (err) {
      const fallback = config.fallbackModel;
      if (fallback && fallback !== primaryModel && !(err instanceof ProviderError && err.options.status === 401)) {
        this.logger.warn({ model: primaryModel, fallback, err: (err as Error).message }, "primary model failed, using fallback model");
        try {
          return await attempt(fallback, "fallback");
        } catch (fallbackErr) {
          this.logger.error({ err: (fallbackErr as Error).message }, "fallback model failed");
          return ids.map((id) => ({ id, translation: null, evidence: "unverified" as const, usedReferenceIds: [], note: `Translation failed: ${(fallbackErr as Error).message}` }));
        }
      }
      this.logger.error({ err: (err as Error).message }, "translation batch failed");
      const message = err instanceof ProviderError ? err.message : "Translation service error";
      return ids.map((id) => ({ id, translation: null, evidence: "unverified" as const, usedReferenceIds: [], note: `Translation failed: ${message}`, failed: true }));
    }
  }
}
