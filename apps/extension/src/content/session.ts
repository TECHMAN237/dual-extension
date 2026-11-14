import { detectSourceLanguage, type SourceLanguageCode, type SourceLanguageSelection, type TranslateBatchResponse, type TranslationItem, type TranslationResult } from "@douala-ai/shared";
import { chunkItems, runWithConcurrency } from "../shared/batching";
import type { ScanResult, SessionSnapshot, SessionSummary, TranslatedSegmentInfo } from "../shared/messages";
import { DynamicContentObserver, type TimerClear, type TimerSet } from "./observer";
import { sampleText, scanSegments, type Segment } from "./scanner";
import { createInitialState, resetCounts, setLanguages, setStatus, snapshot, type SessionState } from "./state";
import { TranslationRegistry } from "./translator";

/** Backend access used by the session; abstracted so tests can stub it. */
export interface SessionBackend {
  translateBatch(request: { sourceLanguage: SourceLanguageSelection; targetLanguage: "dua"; domain: string; items: TranslationItem[] }): Promise<TranslateBatchResponse>;
  scanAnalyze(request: { domain: string; htmlLang?: string; sampleText: string; segmentCount: number }): Promise<{ detectedLanguage: SourceLanguageCode | null; confidence: "high" | "medium" | "low" }>;
  sessionComplete(summary: SessionSummary): Promise<void>;
}

export interface SessionOptions {
  backend: SessionBackend;
  onProgress: (state: SessionSnapshot) => void;
  root?: Node;
  concurrency?: number;
  debounceMs?: number;
  setTimeoutImpl?: TimerSet;
  clearTimeoutImpl?: TimerClear;
}

interface SegmentRecord {
  segment: Segment;
  result: TranslationResult | null;
}

/**
 * One page session: scan → translate (batched, concurrent) → dynamic
 * follow-up → restore. Owns the registry and the mutation observer.
 */
export class PageSession {
  readonly state: SessionState = createInitialState();
  readonly registry = new TranslationRegistry();
  private counter = 0;
  private scanned = new Map<string, Segment>();
  private records = new Map<string, SegmentRecord>();
  /** text|context → result, so identical dynamic content never triggers a new request. */
  private memory = new Map<string, TranslationResult>();
  private observer: DynamicContentObserver;
  private dynamicEnabled = false;
  private inFlight = 0;
  private scanGeneration = 0;
  private pendingAnalysis: Promise<void> = Promise.resolve();

  constructor(private readonly opts: SessionOptions) {
    const root = opts.root ?? document.body;
    this.observer = new DynamicContentObserver({
      root,
      debounceMs: opts.debounceMs,
      setTimeoutImpl: opts.setTimeoutImpl,
      clearTimeoutImpl: opts.clearTimeoutImpl,
      scan: (node) => scanSegments(node, { nextId: () => this.nextId(), isKnown: (n, attr) => this.registry.has(n, attr) }),
      onSegments: (segments) => void this.translateDynamic(segments),
      onNavigate: () => this.handleNavigation(),
    });
  }

  private nextId(): string {
    this.counter += 1;
    return `d-${this.counter}`;
  }

  private emit(): void {
    this.state.updatedAt = Date.now();
    this.opts.onProgress(snapshot(this.state));
  }

  getSnapshot(): SessionSnapshot {
    return snapshot(this.state);
  }

  /* ----------------------------------------------------------------------- */
  /* Scan                                                                     */
  /* ----------------------------------------------------------------------- */

  async scan(): Promise<ScanResult> {
    setStatus(this.state, "scanning");
    this.state.navigated = false;
    this.state.domain = location.hostname;
    this.state.url = location.href;
    this.state.htmlLang = document.documentElement.getAttribute("lang");
    this.emit();

    this.registry.prune();
    const root = this.opts.root ?? document.body;
    const segments = scanSegments(root, { nextId: () => this.nextId(), isKnown: (n, attr) => this.registry.has(n, attr) });
    this.scanned = new Map(segments.map((s) => [s.id, s]));
    // Total = new segments + already translated ones still on the page.
    this.state.totalSegments = segments.length + this.registry.size;

    const sample = sampleText(segments);
    const local = detectSourceLanguage(sample, this.state.htmlLang);
    this.state.detectedLanguage = local.language;
    this.state.detectionConfidence = local.language ? local.confidence : null;
    // The scan never waits for the server: local detection is enough to show the
    // language and to translate. The server check runs in the background (it also
    // wakes a sleeping free-tier server) and only refines the result if it answers.
    const scanId = ++this.scanGeneration;
    this.pendingAnalysis = this.opts.backend
      .scanAnalyze({ domain: this.state.domain, htmlLang: this.state.htmlLang ?? undefined, sampleText: sample.slice(0, 5000), segmentCount: segments.length })
      .then((remote) => {
        // Ignore stale answers (a newer scan started) and never change the language mid-translation.
        if (scanId !== this.scanGeneration || !remote.detectedLanguage) return;
        if (this.state.status !== "scanned" && this.state.status !== "translated") return;
        if (remote.detectedLanguage === this.state.detectedLanguage && remote.confidence === this.state.detectionConfidence) return;
        this.state.detectedLanguage = remote.detectedLanguage;
        this.state.detectionConfidence = remote.confidence;
        this.emit();
      })
      .catch(() => {
        /* backend unreachable or asleep: keep the local detection */
      });

    setStatus(this.state, this.registry.size > 0 ? "translated" : "scanned");
    this.emit();
    return {
      domain: this.state.domain,
      url: this.state.url,
      htmlLang: this.state.htmlLang,
      detectedLanguage: this.state.detectedLanguage,
      detectionConfidence: this.state.detectionConfidence,
      totalSegments: this.state.totalSegments,
      analyzedByBackend: false,
    };
  }

  /** Resolves when the background server language check of the last scan has settled (tests). */
  whenAnalysisSettled(): Promise<void> {
    return this.pendingAnalysis;
  }

  /* ----------------------------------------------------------------------- */
  /* Translate                                                                */
  /* ----------------------------------------------------------------------- */

  async translate(sourceLanguage: SourceLanguageSelection, translateDynamicContent: boolean): Promise<SessionSnapshot> {
    if (this.state.status === "translating") return this.getSnapshot();
    if (this.scanned.size === 0 && this.registry.size === 0) await this.scan();
    const resolved: SourceLanguageCode | null = sourceLanguage === "auto" ? this.state.detectedLanguage : sourceLanguage;
    setLanguages(this.state, sourceLanguage, resolved, "dua");
    resetCounts(this.state);
    setStatus(this.state, "translating");
    this.dynamicEnabled = translateDynamicContent;
    this.emit();

    const segments = [...this.scanned.values()].filter((s) => s.node.isConnected && !this.registry.has(s.node, s.kind === "attr" ? s.attr : undefined));
    this.scanned.clear();
    await this.translateSegments(segments, false);

    if ((this.state.status as string) === "translating") {
      const failedCompletely = this.state.errorCount > 0 && this.state.translatedCount === 0;
      setStatus(this.state, failedCompletely ? "error" : "translated");
      if (failedCompletely && !this.state.errorMessage) this.state.errorMessage = "No segment could be translated.";
    }
    this.emit();
    void this.opts.backend.sessionComplete(this.summary()).catch(() => undefined);
    if (translateDynamicContent) this.observer.start();
    return this.getSnapshot();
  }

  private memoryKey(seg: Segment): string {
    return `${seg.context}\u0000${seg.text}`;
  }

  private async translateSegments(segments: Segment[], incremental: boolean): Promise<void> {
    if (segments.length === 0) return;
    // Fast path: reuse results for identical text already translated in this session.
    const needRequest: Segment[] = [];
    for (const seg of segments) {
      const known = this.memory.get(this.memoryKey(seg));
      if (known) {
        this.applyResult(seg, { ...known, id: seg.id, cached: true });
      } else {
        needRequest.push(seg);
      }
    }
    if (needRequest.length === 0) {
      this.emit();
      return;
    }

    // Collapse identical texts into a single request item.
    const representatives = new Map<string, Segment[]>();
    for (const seg of needRequest) {
      const key = this.memoryKey(seg);
      const list = representatives.get(key);
      if (list) list.push(seg);
      else representatives.set(key, [seg]);
    }
    const items: TranslationItem[] = [];
    const bySegmentId = new Map<string, Segment[]>();
    for (const list of representatives.values()) {
      const rep = list[0]!;
      items.push({ id: rep.id, text: rep.text, context: rep.context });
      bySegmentId.set(rep.id, list);
    }
    this.state.requestedCount += needRequest.length;
    this.emit();

    const batches = chunkItems(items);
    this.inFlight += batches.length;
    const tasks = batches.map((batch) => async () => {
      try {
        const response = await this.opts.backend.translateBatch({
          sourceLanguage: this.state.sourceLanguage,
          targetLanguage: "dua",
          domain: this.state.domain,
          items: batch,
        });
        this.state.mock = response.mock;
        this.state.provider = response.provider;
        this.state.model = response.model;
        if (this.state.sourceLanguage === "auto" && !this.state.resolvedSourceLanguage) this.state.resolvedSourceLanguage = response.sourceLanguage;
        const resultsById = new Map(response.results.map((r) => [r.id, r]));
        for (const item of batch) {
          const result = resultsById.get(item.id) ?? { id: item.id, sourceText: item.text, translatedText: null, status: "error" as const, evidence: "unverified" as const, needsReview: true, references: [], note: "Missing result", cached: false };
          for (const seg of bySegmentId.get(item.id) ?? []) this.applyResult(seg, { ...result, id: seg.id });
          if (result.status !== "error") this.memory.set(`${item.context}\u0000${item.text}`, result);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.state.errorMessage = message;
        for (const item of batch) {
          for (const seg of bySegmentId.get(item.id) ?? []) {
            this.applyResult(seg, { id: seg.id, sourceText: item.text, translatedText: null, status: "error", evidence: "unverified", needsReview: true, references: [], note: message, cached: false });
          }
        }
      } finally {
        this.inFlight -= 1;
        this.emit();
      }
    });
    await runWithConcurrency(tasks, this.opts.concurrency ?? 2);
    if (incremental) this.emit();
  }

  private applyResult(seg: Segment, result: TranslationResult): void {
    this.state.completedCount += 1;
    if (result.coverage) {
      this.state.wordsFound += result.coverage.found;
      this.state.wordsTotal += result.coverage.total;
    }
    this.records.set(seg.id, { segment: seg, result });
    if (result.status === "translated" && result.translatedText) {
      const applied = this.observer.ignoreOwnMutations(() => this.registry.apply(seg, result.translatedText!, result));
      if (applied) {
        this.state.translatedCount += 1;
        this.state.evidence[result.evidence] += 1;
        return;
      }
      // Node changed under us: count as error but do not touch the DOM.
      this.records.set(seg.id, { segment: seg, result: { ...result, status: "error", translatedText: null, note: "Page content changed before the translation could be applied." } });
      this.state.errorCount += 1;
      return;
    }
    // Track non-applied segments so the observer does not re-request them.
    this.registry.track(seg);
    if (result.status === "uncertain") this.state.uncertainCount += 1;
    else if (result.status === "skipped") this.state.skippedCount += 1;
    else this.state.errorCount += 1;
  }

  private async translateDynamic(segments: Segment[]): Promise<void> {
    if (!this.dynamicEnabled || this.state.status === "restoring" || this.state.status === "idle") return;
    const fresh = segments.filter((s) => s.node.isConnected);
    if (fresh.length === 0) return;
    this.state.totalSegments += fresh.length;
    await this.translateSegments(fresh, true);
  }

  private handleNavigation(): void {
    // SPA route change: keep what is still on screen, forget what left, ask for a rescan.
    this.registry.prune();
    this.state.navigated = true;
    this.state.url = location.href;
    this.state.domain = location.hostname;
    this.emit();
  }

  /* ----------------------------------------------------------------------- */
  /* Restore                                                                  */
  /* ----------------------------------------------------------------------- */

  restore(): SessionSnapshot {
    setStatus(this.state, "restoring");
    this.emit();
    this.observer.stop();
    this.dynamicEnabled = false;
    this.observer.ignoreOwnMutations(() => this.registry.restore());
    this.records.clear();
    this.scanned.clear();
    this.memory.clear();
    resetCounts(this.state);
    this.state.totalSegments = 0;
    this.state.navigated = false;
    setStatus(this.state, "idle");
    this.emit();
    return this.getSnapshot();
  }

  /* ----------------------------------------------------------------------- */
  /* Queries                                                                  */
  /* ----------------------------------------------------------------------- */

  listTranslations(): TranslatedSegmentInfo[] {
    const out: TranslatedSegmentInfo[] = [];
    for (const [id, rec] of this.records) {
      if (!rec.result) continue;
      if (rec.result.status === "skipped") continue;
      out.push({
        id,
        sourceText: rec.segment.text,
        translatedText: rec.result.translatedText,
        status: rec.result.status,
        evidence: rec.result.evidence,
        needsReview: rec.result.needsReview,
        references: rec.result.references,
        note: rec.result.note,
        context: rec.segment.context,
        glosses: rec.result.glosses ?? [],
        notFound: rec.result.notFound ?? [],
        coverage: rec.result.coverage ?? null,
      });
    }
    return out;
  }

  summary(): SessionSummary {
    const { translatedCount, uncertainCount, errorCount, totalSegments } = this.state;
    const status: SessionSummary["status"] = errorCount === 0 ? "completed" : translatedCount > 0 ? "partial" : "failed";
    return {
      domain: this.state.domain,
      sourceLanguage: this.state.resolvedSourceLanguage ?? "en",
      targetLanguage: "dua",
      totalSegments,
      translatedCount,
      uncertainCount,
      errorCount,
      status,
    };
  }

  /** Stop observers (used when the page unloads). */
  dispose(): void {
    this.observer.stop();
  }
}
