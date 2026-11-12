import { describe, expect, it, vi } from "vitest";
import type { KnowledgeEntry } from "@douala-ai/shared";
import { InMemoryKnowledgeStore } from "@douala-ai/linguistic-knowledge";
import { MockProvider, ProviderError, TranslationEngine, engineConfigSchema, matchCase, parseLlmOutput, partitionItems, validateTranslationText, withRetry, type LlmProvider } from "../src";

function entry(partial: Partial<KnowledgeEntry> & { sourceText: string; targetText: string | null }): KnowledgeEntry {
  return {
    id: partial.id ?? `id-${partial.sourceText}`,
    sourceLanguage: "en",
    targetLanguage: "dua",
    category: "vocabulary",
    context: null,
    example: null,
    note: null,
    sourceId: "test",
    sourceName: "Test source",
    sourceUrl: null,
    reference: null,
    origin: "verified_source",
    validationStatus: "verified",
    reliability: "academic",
    extractedAt: "2026-01-01T00:00:00.000Z",
    tags: [],
    ...partial,
  };
}

const config = engineConfigSchema.parse({ provider: "mock", model: "mock-model", fastModel: "mock-model", maxRetries: 1, batchSize: 5, concurrency: 2 });
const noSleep = async () => {};

describe("TranslationEngine (mock provider)", () => {
  it("uses verified exact references without calling the model and returns high evidence", async () => {
    const store = new InMemoryKnowledgeStore({ seedEntries: [entry({ sourceText: "search", targetText: "T:search" })] });
    const provider = new MockProvider();
    const spy = vi.spyOn(provider, "complete");
    const engine = new TranslationEngine({ config, provider, store, sleep: noSleep });
    const res = await engine.translateBatch({ sourceLanguage: "en", targetLanguage: "dua", items: [{ id: "a", text: "Search", context: "button" }] });
    expect(res.results[0]).toMatchObject({ id: "a", translatedText: "T:search", status: "translated", evidence: "high", needsReview: false });
    expect(res.results[0]?.references[0]?.sourceName).toBe("Test source");
    expect(spy).not.toHaveBeenCalled();
    expect(res.mock).toBe(true);
  });

  it("skips untranslatable items, de-duplicates identical texts and caches results", async () => {
    const store = new InMemoryKnowledgeStore();
    const provider = new MockProvider();
    const spy = vi.spyOn(provider, "complete");
    const engine = new TranslationEngine({ config, provider, store, sleep: noSleep });
    const items = [
      { id: "1", text: "Welcome", context: "heading" as const },
      { id: "2", text: "Welcome", context: "heading" as const },
      { id: "3", text: "https://example.com", context: "link" as const },
      { id: "4", text: "12345", context: "other" as const },
    ];
    const first = await engine.translateBatch({ sourceLanguage: "en", targetLanguage: "dua", items });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(first.results.find((r) => r.id === "3")?.status).toBe("skipped");
    expect(first.results.find((r) => r.id === "4")?.status).toBe("skipped");
    expect(first.results.find((r) => r.id === "1")?.translatedText).toBe("[MOCK dua] Welcome");
    expect(first.results.find((r) => r.id === "1")?.evidence).toBe("unverified");
    expect(first.results.find((r) => r.id === "1")?.needsReview).toBe(true);
    expect(first.results.find((r) => r.id === "2")?.translatedText).toBe("[MOCK dua] Welcome");

    const second = await engine.translateBatch({ sourceLanguage: "en", targetLanguage: "dua", items: [items[0]!] });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(second.results[0]?.cached).toBe(true);
  });

  it("auto-detects the source language", async () => {
    const engine = new TranslationEngine({ config, provider: new MockProvider(), store: new InMemoryKnowledgeStore(), sleep: noSleep });
    const res = await engine.translateBatch({ sourceLanguage: "auto", targetLanguage: "dua", items: [{ id: "1", text: "Connectez-vous à votre compte pour voir vos messages", context: "paragraph" }] });
    expect(res.sourceLanguage).toBe("fr");
    expect(res.detectedLanguage?.language).toBe("fr");
  });

  it("recovers from one malformed output by retrying", async () => {
    const provider = new MockProvider({ malformedOnce: true });
    const spy = vi.spyOn(provider, "complete");
    const engine = new TranslationEngine({ config, provider, store: new InMemoryKnowledgeStore(), sleep: noSleep });
    const res = await engine.translateBatch({ sourceLanguage: "en", targetLanguage: "dua", items: [{ id: "1", text: "Hello there", context: "other" }] });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(res.results[0]?.status).toBe("translated");
  });

  it("reports provider errors per item without throwing, and retries retryable errors", async () => {
    let calls = 0;
    const flaky: LlmProvider = {
      name: "flaky",
      async complete() {
        calls++;
        throw new ProviderError("rate limited", { retryable: true, status: 429, provider: "flaky" });
      },
    };
    const engine = new TranslationEngine({ config: { ...config, maxRetries: 2 }, provider: flaky, store: new InMemoryKnowledgeStore(), sleep: noSleep });
    const res = await engine.translateBatch({ sourceLanguage: "en", targetLanguage: "dua", items: [{ id: "1", text: "Hello there", context: "other" }] });
    expect(calls).toBe(3);
    expect(res.results[0]?.status).toBe("error");
    expect(res.results[0]?.note).toContain("rate limited");
  });

  it("falls back to the configured fallback model when the primary fails", async () => {
    const models: string[] = [];
    const provider: LlmProvider = {
      name: "test",
      async complete(req) {
        models.push(req.model);
        if (req.model === "primary") throw new ProviderError("boom", { retryable: false, status: 500, provider: "test" });
        return { text: JSON.stringify({ items: [{ id: req.user.match(/"id":"([^"]+)"/)![1], translation: null, evidence: "unverified", usedReferenceIds: [], note: "no evidence" }] }), model: req.model, stopReason: "end_turn" };
      },
    };
    const engine = new TranslationEngine({ config: { ...config, model: "primary", fastModel: "primary", fallbackModel: "backup" }, provider, store: new InMemoryKnowledgeStore(), sleep: noSleep });
    const res = await engine.translateBatch({ sourceLanguage: "en", targetLanguage: "dua", items: [{ id: "1", text: "Hello there", context: "other" }] });
    expect(models).toEqual(["primary", "backup"]);
    expect(res.results[0]).toMatchObject({ status: "uncertain", translatedText: null, needsReview: true });
  });

  it("never lets the model claim more evidence than the references support", async () => {
    const provider: LlmProvider = {
      name: "overconfident",
      async complete(req) {
        const id = req.user.match(/"id":"([^"]+)"/)![1];
        return { text: JSON.stringify({ items: [{ id, translation: "T:anything", evidence: "high", usedReferenceIds: [], note: null }] }), model: "m", stopReason: "end_turn" };
      },
    };
    const engine = new TranslationEngine({ config, provider, store: new InMemoryKnowledgeStore(), sleep: noSleep });
    const res = await engine.translateBatch({ sourceLanguage: "en", targetLanguage: "dua", items: [{ id: "1", text: "Hello there", context: "other" }] });
    expect(res.results[0]?.evidence).toBe("unverified");
    expect(res.results[0]?.needsReview).toBe(true);
  });
});

describe("parseLlmOutput", () => {
  it("strips markdown fences and fills missing ids", () => {
    const out = parseLlmOutput('```json\n{"items":[{"id":"a","translation":"x","evidence":"low","usedReferenceIds":[],"note":null}]}\n```', ["a", "b"]);
    expect(out.items).toHaveLength(2);
    expect(out.items[1]?.translation).toBeNull();
  });
  it("throws on garbage", () => {
    expect(() => parseLlmOutput("nope", ["a"])).toThrow();
  });
});

describe("validateTranslationText", () => {
  it("rejects altered placeholders and empty output", () => {
    expect(validateTranslationText("Hello {name}", "Bonjour").ok).toBe(false);
    expect(validateTranslationText("Hello {name}", "Bonjour {name}").ok).toBe(true);
    expect(validateTranslationText("Hello", "   ").ok).toBe(false);
  });
});

describe("router / helpers", () => {
  it("routes long or unreferenced segments to the capable tier", () => {
    const short = { id: "1", text: "Save", context: "a button label", references: [{ id: "r", source: "Save", target: "T", category: "vocabulary", match: "exact" as const, status: "verified" as const, origin: "verified_source", from: "x" }] };
    const long = { id: "2", text: "This is a long paragraph with many words. It has two sentences in it.", context: "body text", references: [] };
    const batches = partitionItems([short, long], 10);
    expect(batches.map((b) => b.tier).sort()).toEqual(["capable", "fast"]);
  });
  it("matchCase preserves capitalisation style", () => {
    expect(matchCase("SEARCH", "foo bar")).toBe("FOO BAR");
    expect(matchCase("Search", "foo bar")).toBe("Foo bar");
    expect(matchCase("search", "Foo")).toBe("Foo");
  });
  it("withRetry only retries retryable errors", async () => {
    let n = 0;
    await expect(
      withRetry(async () => {
        n++;
        throw new ProviderError("x", { retryable: false, provider: "t" });
      }, { maxRetries: 3, sleep: noSleep }),
    ).rejects.toThrow();
    expect(n).toBe(1);
  });
});
