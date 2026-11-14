import {
  detectSourceLanguage,
  isUntranslatableText,
  normalizeWhitespace,
  type EvidenceLevel,
  type KnowledgeEntry,
  type SegmentContext,
  type SourceLanguageCode,
  type TargetLanguageCode,
  type TranslateBatchRequest,
  type TranslateBatchResponse,
  type TranslationReference,
  type TranslationResult,
  type WordGloss,
} from "@douala-ai/shared";
import { dualaTokens, findExamples, lookupSegments, toTranslationReference, type GlossItem, type KnowledgeStore, type SegmentLookup } from "@douala-ai/linguistic-knowledge";
import { TranslationCache } from "./cache";
import type { EngineConfig } from "./config";
import { MalformedOutputError, checkComposition, coverageEvidence, grammarSheetDualaWords, parseLlmOutput, validateTranslationText } from "./output";
import { CONTEXT_HINTS, LLM_OUTPUT_JSON_SCHEMA, buildSystemPrompt, buildUserPrompt, type LlmOutput, type PromptExample, type PromptItem, type PromptLexiconEntry } from "./prompt";
import { ProviderError, type LlmProvider } from "./providers/types";
import { createLimiter, withRetry } from "./retry";
import { modelForTier, partitionTexts } from "./router";

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
  /** Grammar sheet (data/knowledge/grammaire-douala.md), included in every system prompt. */
  grammarSheet?: string;
  logger?: EngineLogger;
  onUsage?: (event: UsageEvent) => void;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/** Match the capitalisation pattern of the source onto a target string. */
export function matchCase(source: string, target: string): string {
  if (!target) return target;
  const letters = source.replace(/[^\p{L}]/gu, "");
  if (letters.length > 1 && letters === letters.toUpperCase()) return target.toUpperCase();
  const first = source.match(/\p{L}/u)?.[0];
  if (first && first === first.toUpperCase()) return target.charAt(0).toUpperCase() + target.slice(1);
  return target;
}

type Result = Omit<TranslationResult, "id" | "cached">;

interface WorkItem {
  key: string;
  text: string;
  context: SegmentContext;
  ids: string[];
  lookup?: SegmentLookup;
  result?: Result;
  cached: boolean;
}

/** How a segment is handled (see TranslationEngine.plan). */
export type PlanRoute = "dictionary" | "compose" | "kept";
export interface SegmentPlan {
  text: string;
  route: PlanRoute;
  lookup: SegmentLookup;
}

const asRef = (e: KnowledgeEntry): TranslationReference => toTranslationReference({ entry: e, relevance: 1, score: 1, matchType: "exact" });

/** Word-by-word detail for the result; `chosen` maps a source word to the Duala text the model used. */
function toGlosses(lookup: SegmentLookup, chosen: Map<string, string> = new Map()): { glosses: WordGloss[]; used: KnowledgeEntry[] } {
  const used: KnowledgeEntry[] = [];
  const glosses = lookup.items.map((it: GlossItem): WordGloss => {
    if (it.kind !== "found") return { source: it.surface, lemma: it.lemma, duala: null, entryId: null, status: null, sourceName: null, reference: null, kind: it.kind };
    const pick = chosen.get(it.surface.toLowerCase());
    const entry = it.entries.find((e) => pick && e.targetText!.normalize("NFC").toLowerCase() === pick.normalize("NFC").toLowerCase()) ?? it.entries[0]!;
    used.push(entry);
    return { source: it.surface, lemma: it.lemma, duala: entry.targetText, entryId: entry.id, status: entry.validationStatus, sourceName: entry.sourceName, reference: entry.reference, kind: "found" };
  });
  return { glosses, used };
}

function coverageOf(lookup: SegmentLookup) {
  return { found: lookup.found, total: lookup.total };
}

function evidenceFor(lookup: SegmentLookup, used: KnowledgeEntry[]): EvidenceLevel {
  return coverageEvidence(lookup.found, lookup.total, used.length > 0 && used.every((e) => e.validationStatus === "verified"));
}

const notFoundOf = (lookup: SegmentLookup) => lookup.items.filter((i) => i.kind === "not_found").map((i) => i.surface);

export class TranslationEngine {
  private readonly cache: TranslationCache;
  private readonly limit: <T>(fn: () => Promise<T>) => Promise<T>;
  private readonly logger: EngineLogger;
  private readonly sheetWords: Set<string>;

  constructor(private readonly opts: TranslationEngineOptions) {
    this.cache = new TranslationCache(opts.config.cacheTtlSeconds * 1000, opts.config.cacheMaxEntries);
    this.limit = createLimiter(opts.config.concurrency);
    this.logger = opts.logger ?? { info() {}, warn() {}, error() {} };
    this.sheetWords = grammarSheetDualaWords(opts.grammarSheet ?? "");
  }

  get isMock(): boolean {
    return this.opts.provider.name === "mock";
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

  /** Route of a looked-up segment: no content word found → kept; one entry covering the whole segment → dictionary; otherwise composed. */
  private route(lookup: SegmentLookup): PlanRoute {
    if (lookup.found === 0) return "kept";
    if (lookup.items.length === 1 && lookup.items[0]!.kind === "found") return "dictionary";
    return "compose";
  }

  private keptResult(text: string, lookup: SegmentLookup): Result {
    return {
      sourceText: text,
      translatedText: null,
      status: "uncertain",
      evidence: "unverified",
      needsReview: true,
      references: [],
      note: "No content word of this text is in the Duala dictionary: original text kept.",
      glosses: toGlosses(lookup).glosses,
      notFound: notFoundOf(lookup),
      coverage: coverageOf(lookup),
    };
  }

  private dictionaryResult(text: string, lookup: SegmentLookup): Result {
    const { glosses, used } = toGlosses(lookup);
    const evidence = evidenceFor(lookup, used);
    const alternatives = lookup.items[0]!.entries.slice(1).map((e) => `${e.targetText} (${e.sourceName})`);
    return {
      sourceText: text,
      translatedText: matchCase(text, used[0]!.targetText!),
      status: "translated",
      evidence,
      needsReview: evidence !== "high",
      references: used.map(asRef),
      note: alternatives.length ? `Direct dictionary entry. Other translations: ${alternatives.join("; ")}.` : "Direct dictionary entry.",
      glosses,
      notFound: [],
      coverage: coverageOf(lookup),
    };
  }

  /** Coverage analysis: lookup and route of each text, without calling the model. */
  async plan(texts: string[], sourceLanguage: SourceLanguageCode, targetLanguage: TargetLanguageCode = "dua"): Promise<SegmentPlan[]> {
    const clean = texts.map(normalizeWhitespace);
    const lookups = await lookupSegments(this.opts.store, clean, { sourceLanguage, targetLanguage });
    return lookups.map((lookup, i) => ({ text: clean[i]!, lookup, route: isUntranslatableText(clean[i]!) ? "kept" : this.route(lookup) }));
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
        skipped.push({ id: item.id, sourceText: item.text, translatedText: null, status: "skipped", evidence: "unverified", needsReview: false, references: [], note: "Not translatable (identifier, number, URL or email).", cached: false, glosses: [], notFound: [], coverage: null });
        continue;
      }
      const key = TranslationCache.key(text, sourceLanguage, targetLanguage, item.context, `${provider.name}:compose-v1`);
      const existing = work.get(key);
      if (existing) existing.ids.push(item.id);
      else work.set(key, { key, text, context: item.context, ids: [item.id], cached: false });
    }

    // 2. Cache lookup.
    for (const w of work.values()) {
      const hit = this.cache.get(w.key);
      if (hit) {
        w.result = hit;
        w.cached = true;
      }
    }

    // 3. Word-by-word dictionary lookup for the whole batch (one dictionary query).
    const todo = [...work.values()].filter((w) => !w.result);
    const lookups = await lookupSegments(store, todo.map((w) => w.text), { sourceLanguage, targetLanguage });
    const pending: WorkItem[] = [];
    todo.forEach((w, i) => {
      w.lookup = lookups[i]!;
      const route = this.route(w.lookup);
      if (route === "kept") w.result = this.keptResult(w.text, w.lookup);
      else if (route === "dictionary") w.result = this.dictionaryResult(w.text, w.lookup);
      else pending.push(w);
      if (w.result) this.cache.set(w.key, w.result);
    });

    // 4. Composition by the model, in batches, per tier, with a concurrency limit.
    const batches = partitionTexts(pending, config.batchSize);
    await Promise.all(
      batches.map((batch) =>
        this.limit(async () => {
          const { prompt, allowed } = await this.buildBatch(batch.items, sourceLanguage, targetLanguage);
          const outputs = await this.runBatch(prompt, batch.tier, sourceLanguage, targetLanguage, request.domain);
          for (const out of outputs) {
            // Short prompt ids (S1, S2, ...): models copy them reliably, unlike long cache keys.
            const w = batch.items[Number(out.id.replace(/^S/, "")) - 1];
            if (!w) continue;
            w.result = this.finalise(w, out, allowed);
            if (w.result.status !== "error") this.cache.set(w.key, w.result);
          }
        }),
      ),
    );

    // 5. Assemble per-id results.
    const results: TranslationResult[] = [...skipped];
    for (const w of work.values()) {
      const base: Result = w.result ?? { sourceText: w.text, translatedText: null, status: "error", evidence: "unverified", needsReview: true, references: [], note: "No result produced.", glosses: [], notFound: [], coverage: null };
      for (const id of w.ids) results.push({ id, ...base, cached: w.cached });
    }
    const order = new Map(request.items.map((i, idx) => [i.id, idx]));
    results.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

    return { sourceLanguage, targetLanguage, detectedLanguage: detected, results, provider: provider.name, model: this.isMock ? null : config.model, mock: this.isMock };
  }

  /** Shared lexicon (short ids), 2–3 examples and per-segment word lists for one model call. */
  private async buildBatch(items: WorkItem[], sourceLanguage: SourceLanguageCode, targetLanguage: TargetLanguageCode) {
    const lexicon: PromptLexiconEntry[] = [];
    const idOf = new Map<string, string>();
    const promptItems: PromptItem[] = items.map((w, index) => ({
      id: `S${index + 1}`,
      text: w.text,
      context: CONTEXT_HINTS[w.context] ?? CONTEXT_HINTS.other,
      words: w.lookup!.items.map((it) => ({
        word: it.surface,
        lex: it.entries.map((e) => {
          let id = idOf.get(e.id);
          if (!id) {
            id = `L${lexicon.length + 1}`;
            idOf.set(e.id, id);
            lexicon.push({ id, source: e.sourceText, duala: e.targetText!, status: e.validationStatus === "verified" ? "verified" : "pending", from: e.sourceName });
          }
          return id;
        }),
      })),
    }));
    const exampleEntries = await findExamples(this.opts.store, items.map((w) => w.lookup!), { sourceLanguage, targetLanguage, limit: 3 });
    const examples: PromptExample[] = exampleEntries.map((e) => ({ source: e.sourceText, duala: e.targetText! }));
    const allowed = new Set<string>(this.sheetWords);
    for (const l of lexicon) for (const t of dualaTokens(l.duala)) allowed.add(t);
    for (const ex of examples) for (const t of dualaTokens(ex.duala)) allowed.add(t);
    const lexById = new Map(lexicon.map((l) => [l.id, l]));
    return { prompt: { items: promptItems, lexicon, examples }, allowed, lexById };
  }

  private finalise(w: WorkItem, out: LlmOutput["items"][number] & { failed?: boolean }, allowed: Set<string>): Result {
    const lookup = w.lookup!;
    const base = { sourceText: w.text, notFound: notFoundOf(lookup), coverage: coverageOf(lookup) };
    if (out.failed) return { ...base, translatedText: null, status: "error", evidence: "unverified", needsReview: true, references: [], note: out.note, glosses: toGlosses(lookup).glosses };
    const chosen = new Map(out.glosses.filter((g) => g.duala).map((g) => [g.source.toLowerCase(), g.duala!]));
    const { glosses, used } = toGlosses(lookup, chosen);
    const kept = (note: string): Result => ({ ...base, translatedText: null, status: "uncertain", evidence: "unverified", needsReview: true, references: used.map(asRef), note, glosses });
    if (out.translation === null) return kept(out.note ?? "The model returned no translation: original text kept.");
    const check = validateTranslationText(w.text, out.translation);
    if (!check.ok) {
      this.logger.warn({ reason: check.reason }, "translation rejected by output validation");
      return kept(`Output rejected: ${check.reason}. Original text kept.`);
    }
    if (!this.isMock) {
      const composition = checkComposition(w.text, out.translation, allowed);
      if (!composition.ok) {
        this.logger.warn({ reason: composition.reason }, "translation rejected by the anti-invention check");
        return kept(`Translation rejected (anti-invention check): ${composition.reason}. Original text kept.`);
      }
    }
    const evidence = this.isMock ? "unverified" : evidenceFor(lookup, used);
    return {
      ...base,
      translatedText: out.translation,
      status: "translated",
      evidence,
      needsReview: evidence !== "high",
      references: used.map(asRef),
      note: out.note,
      glosses,
    };
  }

  private async runBatch(prompt: { items: PromptItem[]; lexicon: PromptLexiconEntry[]; examples: PromptExample[] }, tier: "fast" | "capable", source: SourceLanguageCode, target: TargetLanguageCode, domain?: string): Promise<(LlmOutput["items"][number] & { failed?: boolean })[]> {
    const { config, provider } = this.opts;
    const ids = prompt.items.map((i) => i.id);
    const system = buildSystemPrompt(source, target, this.opts.grammarSheet);
    const user = buildUserPrompt(prompt, source, target, domain);
    // Generous budget: reasoning models spend tokens before answering (an empty answer is malformed output).
    const maxTokens = Math.min(16_000, 8_000 + prompt.items.reduce((n, i) => n + i.text.length * 10, 0));
    const primaryModel = modelForTier(config, tier);
    const failedAll = (note: string, failed: boolean) => ids.map((id) => ({ id, translation: null, glosses: [], notFound: [], note, failed }));

    const attempt = async (model: string, usageTier: UsageEvent["tier"]) => {
      const started = Date.now();
      try {
        const res = await withRetry(
          () => provider.complete({ model, system, user, jsonSchema: LLM_OUTPUT_JSON_SCHEMA, maxTokens, timeoutMs: config.timeoutMs, effort: config.effort }),
          { maxRetries: config.maxRetries, sleep: this.opts.sleep, onRetry: (n, err) => this.logger.warn({ attempt: n, err: (err as Error).message }, "retrying provider call") },
        );
        this.opts.onUsage?.({ provider: provider.name, model: res.model, tier: usageTier, items: ids.length, inputTokens: res.usage?.inputTokens ?? 0, outputTokens: res.usage?.outputTokens ?? 0, durationMs: Date.now() - started, ok: true });
        if (res.refused) throw new ProviderError("The model declined this request", { retryable: false, provider: provider.name });
        return parseLlmOutput(res.text, ids).items;
      } catch (err) {
        this.opts.onUsage?.({ provider: provider.name, model, tier: usageTier, items: ids.length, inputTokens: 0, outputTokens: 0, durationMs: Date.now() - started, ok: false, error: (err as Error).message });
        throw err;
      }
    };

    try {
      try {
        return await attempt(primaryModel, tier);
      } catch (err) {
        if (err instanceof MalformedOutputError) {
          this.logger.warn({ model: primaryModel, rawLength: err.raw.length, rawStart: err.raw.slice(0, 200) }, "malformed model output, retrying once");
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
          return failedAll(`Translation failed: ${(fallbackErr as Error).message}`, true);
        }
      }
      this.logger.error({ err: (err as Error).message }, "translation batch failed");
      return failedAll(`Translation failed: ${err instanceof ProviderError ? err.message : "Translation service error"}`, true);
    }
  }
}
