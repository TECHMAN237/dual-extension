import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranslateBatchResponse } from "@douala-ai/shared";
import { DynamicContentObserver } from "../src/content/observer";
import { scanSegments } from "../src/content/scanner";
import { PageSession, type SessionBackend } from "../src/content/session";

const flushMicrotasks = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function fakeBackend(): SessionBackend & { translateBatch: ReturnType<typeof vi.fn> } {
  const translateBatch = vi.fn(async (req: Parameters<SessionBackend["translateBatch"]>[0]): Promise<TranslateBatchResponse> => ({
    sourceLanguage: "en",
    targetLanguage: "dua",
    detectedLanguage: { language: "en", confidence: "high" },
    provider: "mock",
    model: null,
    mock: true,
    results: req.items.map((i) => ({ id: i.id, sourceText: i.text, translatedText: `T:${i.text}`, status: "translated" as const, evidence: "unverified" as const, needsReview: true, references: [], note: null, cached: false })),
  }));
  return {
    translateBatch,
    scanAnalyze: vi.fn(async () => ({ detectedLanguage: "en" as const, confidence: "high" as const })),
    sessionComplete: vi.fn(async () => undefined),
  };
}

describe("DynamicContentObserver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reports newly inserted segments once after the debounce window", async () => {
    document.body.innerHTML = `<div id="root"><p>Existing</p></div>`;
    const root = document.getElementById("root")!;
    const onSegments = vi.fn();
    let n = 0;
    const observer = new DynamicContentObserver({ root, scan: (node) => scanSegments(node, { nextId: () => `d-${++n}` }), onSegments, debounceMs: 400 });
    observer.start();
    const p = document.createElement("p");
    p.textContent = "Inserted later";
    root.appendChild(p);
    const q = document.createElement("span");
    q.textContent = "Another one";
    root.appendChild(q);
    await flushMicrotasks();
    vi.advanceTimersByTime(300);
    expect(onSegments).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(onSegments).toHaveBeenCalledTimes(1);
    expect(onSegments.mock.calls[0]![0].map((s: { text: string }) => s.text)).toEqual(["Inserted later", "Another one"]);
    observer.stop();
  });

  it("ignores mutations made through ignoreOwnMutations and stops after disconnect", async () => {
    document.body.innerHTML = `<div id="root"><p id="p">Existing</p></div>`;
    const root = document.getElementById("root")!;
    const onSegments = vi.fn();
    let n = 0;
    const observer = new DynamicContentObserver({ root, scan: (node) => scanSegments(node, { nextId: () => `d-${++n}` }), onSegments, debounceMs: 100 });
    observer.start();
    observer.ignoreOwnMutations(() => {
      document.getElementById("p")!.firstChild!.nodeValue = "Translated by us";
    });
    await flushMicrotasks();
    vi.advanceTimersByTime(200);
    expect(onSegments).not.toHaveBeenCalled();
    observer.stop();
    const p = document.createElement("p");
    p.textContent = "After stop";
    root.appendChild(p);
    await flushMicrotasks();
    vi.advanceTimersByTime(200);
    expect(onSegments).not.toHaveBeenCalled();
  });
});

describe("PageSession dynamic translation", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("translates new content incrementally, reuses cached results for identical text and stops after restore", async () => {
    document.body.innerHTML = `<div id="root"><h1>Hello</h1><p>Welcome to the site</p></div>`;
    const root = document.getElementById("root")!;
    const backend = fakeBackend();
    const progress = vi.fn();
    const session = new PageSession({ backend, onProgress: progress, root, debounceMs: 100 });
    await session.scan();
    expect(session.state.totalSegments).toBe(2);
    await session.translate("auto", true);
    expect(backend.translateBatch).toHaveBeenCalledTimes(1);
    expect(root.querySelector("h1")!.textContent).toBe("T:Hello");
    expect(session.state.status).toBe("translated");
    expect(session.state.translatedCount).toBe(2);

    // Our own writes must not be re-scanned.
    await flushMicrotasks();
    vi.advanceTimersByTime(200);
    expect(backend.translateBatch).toHaveBeenCalledTimes(1);

    // Identical text (same interface context) inserted dynamically: translated from memory, no new request.
    const dup = document.createElement("p");
    dup.textContent = "Welcome to the site";
    root.appendChild(dup);
    await flushMicrotasks();
    vi.advanceTimersByTime(200);
    await flushMicrotasks();
    expect(dup.textContent).toBe("T:Welcome to the site");
    expect(backend.translateBatch).toHaveBeenCalledTimes(1);

    // New text: one incremental request.
    const fresh = document.createElement("p");
    fresh.textContent = "Brand new sentence";
    root.appendChild(fresh);
    await flushMicrotasks();
    vi.advanceTimersByTime(200);
    await flushMicrotasks();
    await flushMicrotasks();
    expect(backend.translateBatch).toHaveBeenCalledTimes(2);
    expect(fresh.textContent).toBe("T:Brand new sentence");
    expect(session.state.translatedCount).toBe(4);

    // Restore everything and stop observing.
    session.restore();
    expect(root.querySelector("h1")!.textContent).toBe("Hello");
    expect(fresh.textContent).toBe("Brand new sentence");
    expect(session.state.status).toBe("idle");
    const late = document.createElement("p");
    late.textContent = "Inserted after restore";
    root.appendChild(late);
    await flushMicrotasks();
    vi.advanceTimersByTime(200);
    await flushMicrotasks();
    expect(backend.translateBatch).toHaveBeenCalledTimes(2);
    expect(late.textContent).toBe("Inserted after restore");
  });

  it("does not watch dynamic content when the setting is off and keeps originals for uncertain results", async () => {
    document.body.innerHTML = `<div id="root"><p>Keep me</p><p>Translate me</p></div>`;
    const root = document.getElementById("root")!;
    const backend = fakeBackend();
    backend.translateBatch.mockImplementation(async (req: Parameters<SessionBackend["translateBatch"]>[0]) => ({
      sourceLanguage: "en" as const,
      targetLanguage: "dua" as const,
      detectedLanguage: null,
      provider: "mock",
      model: null,
      mock: false,
      results: req.items.map((i) => (i.text === "Keep me"
        ? { id: i.id, sourceText: i.text, translatedText: null, status: "uncertain" as const, evidence: "unverified" as const, needsReview: true, references: [], note: "no evidence", cached: false }
        : { id: i.id, sourceText: i.text, translatedText: `T:${i.text}`, status: "translated" as const, evidence: "high" as const, needsReview: false, references: [], note: null, cached: false })),
    }));
    const session = new PageSession({ backend, onProgress: vi.fn(), root, debounceMs: 100 });
    await session.translate("en", false);
    expect(root.textContent).toBe("Keep meT:Translate me");
    expect(session.state.uncertainCount).toBe(1);
    expect(session.state.evidence.high).toBe(1);
    const p = document.createElement("p");
    p.textContent = "Dynamic";
    root.appendChild(p);
    await flushMicrotasks();
    vi.advanceTimersByTime(200);
    await flushMicrotasks();
    expect(backend.translateBatch).toHaveBeenCalledTimes(1);
    expect(session.listTranslations().map((t) => t.status).sort()).toEqual(["translated", "uncertain"]);
  });
});
