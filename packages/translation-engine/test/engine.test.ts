import { describe, expect, it, vi } from "vitest";
import type { KnowledgeEntry } from "@douala-ai/shared";
import { InMemoryKnowledgeStore, dualaTokens } from "@douala-ai/linguistic-knowledge";
import {
  MockProvider,
  ProviderError,
  TranslationEngine,
  buildSystemPrompt,
  checkComposition,
  coverageEvidence,
  engineConfigSchema,
  grammarSheetDualaWords,
  matchCase,
  parseLlmOutput,
  partitionTexts,
  validateTranslationText,
  withRetry,
  type CompletionRequest,
  type LlmProvider,
} from "../src";

// Test entries use placeholder "Duala" (D-…) so tests never depend on real vocabulary.
function entry(partial: Partial<KnowledgeEntry> & { sourceText: string; targetText: string | null }): KnowledgeEntry {
  return {
    id: partial.id ?? `id-${partial.sourceText}-${partial.targetText}`,
    sourceLanguage: "fr",
    targetLanguage: "dua",
    category: "vocabulary",
    context: null,
    example: null,
    note: null,
    sourceId: "test",
    sourceName: "Test source",
    sourceUrl: null,
    reference: "https://example.org/entry",
    origin: "extracted_unverified",
    validationStatus: "pending",
    reliability: "community",
    extractedAt: "2026-01-01T00:00:00.000Z",
    tags: [],
    ...partial,
  };
}

const kb = () =>
  new InMemoryKnowledgeStore({
    seedEntries: [
      entry({ sourceText: "consulter", targetText: "d-consulte" }),
      entry({ sourceText: "le solde", targetText: "d-solde" }),
      entry({ sourceText: "payer", targetText: "d-paye" }),
      entry({ sourceText: "s'il te plaît", targetText: "d-stp", category: "expression" }),
      entry({ sourceText: "maison", targetText: "d-maison", validationStatus: "verified", origin: "verified_source", reliability: "established" }),
      entry({ sourceText: "je veux manger", targetText: "d-je d-veux d-manger", category: "sentence_example" }),
      entry({ sourceText: "manger", targetText: "d-manger" }),
      entry({ sourceText: "pay", targetText: "d-pay", sourceLanguage: "en" }),
    ],
  });

/** Provider stub: `answer(item)` returns the translation and glosses; records every call. */
function stub(answer: (item: { id: string; text: string; words: { word: string; lex: string[] }[] }, lexicon: { id: string; duala: string }[]) => { translation: string | null; glosses?: { source: string; duala: string | null }[] }) {
  const calls: CompletionRequest[] = [];
  const provider: LlmProvider = {
    name: "stub",
    complete: vi.fn(async (req: CompletionRequest) => {
      calls.push(req);
      const pick = (tag: string) => JSON.parse(req.user.split(`<${tag}>\n`)[1]!.split(`\n</${tag}>`)[0]!);
      const items = pick("items") as { id: string; text: string; words: { word: string; lex: string[] }[] }[];
      const lexicon = pick("lexicon") as { id: string; duala: string }[];
      return {
        text: JSON.stringify({ items: items.map((i) => { const a = answer(i, lexicon); return { id: i.id, translation: a.translation, glosses: (a.glosses ?? []).map((g) => ({ ...g, entryId: null })), notFound: [], note: null }; }) }),
        model: "stub-model",
        stopReason: "end",
      };
    }),
  };
  return { provider, calls };
}

const config = engineConfigSchema.parse({ provider: "openrouter", apiKey: "k", model: "m", fastModel: "m", maxRetries: 1, batchSize: 10, concurrency: 1 });
const SHEET = "### G19 · Négation\nParticule avant le verbe.\n\n- Exemple : « na sí bí » = « je ne sais pas »\n- Source : https://example.org";
const noSleep = async () => {};

describe("word-by-word pipeline", () => {
  it("keeps the original text without calling the model when no content word is found", async () => {
    const { provider } = stub(() => ({ translation: "anything" }));
    const engine = new TranslationEngine({ config, provider, store: kb() });
    const res = await engine.translateBatch({ sourceLanguage: "fr", targetLanguage: "dua", items: [{ id: "1", text: "Lancez un transfert", context: "button" }] });
    expect(provider.complete).not.toHaveBeenCalled();
    expect(res.results[0]).toMatchObject({ translatedText: null, status: "uncertain", coverage: { found: 0, total: 2 }, notFound: ["Lancez", "transfert"] });
  });

  it("applies a single dictionary entry covering the whole segment directly (pending entries are usable)", async () => {
    const { provider } = stub(() => ({ translation: "x" }));
    const engine = new TranslationEngine({ config, provider, store: kb() });
    const res = await engine.translateBatch({ sourceLanguage: "fr", targetLanguage: "dua", items: [{ id: "a", text: "Solde", context: "heading" }, { id: "b", text: "Maison", context: "heading" }] });
    expect(provider.complete).not.toHaveBeenCalled();
    expect(res.results[0]).toMatchObject({ translatedText: "D-solde", status: "translated", evidence: "moderate", needsReview: true });
    expect(res.results[1]).toMatchObject({ translatedText: "D-maison", evidence: "high", needsReview: false });
    expect(res.results[0]!.glosses[0]).toMatchObject({ source: "Solde", duala: "d-solde", kind: "found", reference: "https://example.org/entry" });
  });

  it("composes with the model: lexicon, examples and grammar sheet in the prompt; not-found words kept as loans", async () => {
    const { provider, calls } = stub((item, lexicon) => {
      const duala = (w: { word: string; lex: string[] }) => (w.lex[0] ? lexicon.find((l) => l.id === w.lex[0])!.duala : w.word);
      return { translation: item.words.filter((w) => !["votre", "et", "un"].includes(w.word)).map(duala).join(" "), glosses: item.words.filter((w) => w.lex.length).map((w) => ({ source: w.word, duala: duala(w) })) };
    });
    const engine = new TranslationEngine({ config, provider, store: kb(), grammarSheet: SHEET });
    const res = await engine.translateBatch({ sourceLanguage: "fr", targetLanguage: "dua", items: [{ id: "1", text: "Consultez votre solde et lancez un transfert", context: "paragraph" }] });
    expect(provider.complete).toHaveBeenCalledTimes(1);
    expect(calls[0]!.system).toBe(buildSystemPrompt("fr", "dua", SHEET));
    expect(calls[0]!.system).toContain("=== GRAMMAR SHEET (Duala) ===");
    expect(calls[0]!.user).toContain('"source":"consulter","duala":"d-consulte"');
    const r = res.results[0]!;
    expect(r).toMatchObject({ translatedText: "d-consulte d-solde lancez transfert", status: "translated", coverage: { found: 2, total: 4 }, notFound: ["lancez", "transfert"], evidence: "low", needsReview: true });
    expect(r.glosses.filter((g) => g.kind === "found").map((g) => [g.source, g.lemma, g.duala])).toEqual([
      ["Consultez", "consulter", "d-consulte"],
      ["solde", "solde", "d-solde"],
    ]);
  });

  it("rejects a translation containing a Duala word absent from the lexicon (anti-invention)", async () => {
    const { provider } = stub(() => ({ translation: "d-consulte d-solde mbɔ́ŋgɛ" }));
    const engine = new TranslationEngine({ config, provider, store: kb() });
    const res = await engine.translateBatch({ sourceLanguage: "fr", targetLanguage: "dua", items: [{ id: "1", text: "Consultez votre solde maintenant", context: "button" }] });
    expect(res.results[0]).toMatchObject({ translatedText: null, status: "uncertain", evidence: "unverified" });
    expect(res.results[0]!.note).toMatch(/anti-invention.*mbɔ́ŋgɛ/);
  });

  it("accepts Duala forms of the grammar sheet and of the examples", async () => {
    const { provider } = stub(() => ({ translation: "na sí d-manger" }));
    const engine = new TranslationEngine({ config, provider, store: kb(), grammarSheet: SHEET });
    const res = await engine.translateBatch({ sourceLanguage: "fr", targetLanguage: "dua", items: [{ id: "1", text: "Je ne veux pas manger", context: "paragraph" }] });
    expect(res.results[0]).toMatchObject({ translatedText: "na sí d-manger", status: "translated" });
  });

  it("builds one lexicon for the whole batch (no repeated entries)", async () => {
    const { provider, calls } = stub((item) => ({ translation: item.text.includes("solde") ? "d-solde d-consulte" : "d-consulte" }));
    const engine = new TranslationEngine({ config, provider, store: kb() });
    await engine.translateBatch({ sourceLanguage: "fr", targetLanguage: "dua", items: [{ id: "1", text: "Consulter le solde", context: "button" }, { id: "2", text: "Consulter maintenant", context: "button" }] });
    expect(calls).toHaveLength(1);
    const lexicon = JSON.parse(calls[0]!.user.split("<lexicon>\n")[1]!.split("\n</lexicon>")[0]!) as { source: string }[];
    expect(lexicon.filter((l) => l.source === "consulter")).toHaveLength(1);
  });

  it("evidence follows dictionary coverage", () => {
    expect(coverageEvidence(4, 5, true)).toBe("high");
    expect(coverageEvidence(4, 5, false)).toBe("moderate");
    expect(coverageEvidence(2, 5, false)).toBe("low");
    expect(coverageEvidence(1, 5, false)).toBe("unverified");
    expect(coverageEvidence(0, 0, false)).toBe("unverified");
  });

  it("English segments use the English dictionary", async () => {
    const { provider } = stub(() => ({ translation: "x" }));
    const engine = new TranslationEngine({ config, provider, store: kb() });
    const res = await engine.translateBatch({ sourceLanguage: "en", targetLanguage: "dua", items: [{ id: "1", text: "Paid", context: "label" }] });
    expect(res.results[0]).toMatchObject({ translatedText: "D-pay", status: "translated" });
  });
});

describe("anti-invention check", () => {
  const allowed = new Set(["d-consulte", "d-solde", "na", "sí"].flatMap(dualaTokens));
  it("accepts documentation words and loans from the source", () => {
    expect(checkComposition("Consultez le solde Safinum", "d-consulte d-solde Safinum", allowed).ok).toBe(true);
  });
  it("rejects invented words, and translations made only of source words", () => {
    expect(checkComposition("Consultez le solde", "d-consulte inventé", allowed)).toMatchObject({ ok: false });
    expect(checkComposition("Consultez le solde", "Consultez le solde", allowed)).toMatchObject({ ok: false, reason: "no Duala word from the documentation" });
  });
  it("takes the Duala side of the grammar sheet examples and quoted Duala forms, not French glosses", () => {
    const words = grammarSheetDualaWords(`${SHEET}\n### G08 · Pronoms\nLe pronom « mbá » ; le mot français « pas » n'en fait pas partie.\n- Source : https://example.org`);
    expect(words.has("na")).toBe(true);
    expect(words.has("sí")).toBe(true);
    expect(words.has("mbá")).toBe(true);
    expect(words.has("pas")).toBe(false);
    expect(words.has("sais")).toBe(false);
  });
});

describe("TranslationEngine plumbing", () => {
  it("mock provider: visible placeholder, unverified, skips identifiers, de-duplicates and caches", async () => {
    const provider = new MockProvider();
    const spy = vi.spyOn(provider, "complete");
    const engine = new TranslationEngine({ config: engineConfigSchema.parse({ provider: "mock", model: "mock-model", fastModel: "mock-model", maxRetries: 1, batchSize: 5, concurrency: 2 }), provider, store: kb(), sleep: noSleep });
    const items = [
      { id: "1", text: "Payer la maison", context: "heading" as const },
      { id: "2", text: "Payer la maison", context: "heading" as const },
      { id: "3", text: "https://example.com", context: "link" as const },
    ];
    const first = await engine.translateBatch({ sourceLanguage: "fr", targetLanguage: "dua", items });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(first.results.find((r) => r.id === "3")?.status).toBe("skipped");
    expect(first.results.find((r) => r.id === "1")).toMatchObject({ translatedText: "[MOCK dua] Payer la maison", evidence: "unverified", needsReview: true });
    expect(first.results.find((r) => r.id === "2")?.translatedText).toBe("[MOCK dua] Payer la maison");
    const second = await engine.translateBatch({ sourceLanguage: "fr", targetLanguage: "dua", items: [items[0]!] });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(second.results[0]?.cached).toBe(true);
    expect(first.mock).toBe(true);
  });

  it("auto-detects the source language", async () => {
    const engine = new TranslationEngine({ config, provider: new MockProvider(), store: kb(), sleep: noSleep });
    const res = await engine.translateBatch({ sourceLanguage: "auto", targetLanguage: "dua", items: [{ id: "1", text: "Connectez-vous à votre compte pour voir vos messages", context: "paragraph" }] });
    expect(res.sourceLanguage).toBe("fr");
  });

  it("recovers from one malformed output by retrying", async () => {
    const provider = new MockProvider({ malformedOnce: true });
    const spy = vi.spyOn(provider, "complete");
    const engine = new TranslationEngine({ config: { ...config, provider: "mock" }, provider, store: kb(), sleep: noSleep });
    const res = await engine.translateBatch({ sourceLanguage: "fr", targetLanguage: "dua", items: [{ id: "1", text: "Payer la maison", context: "other" }] });
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
    const engine = new TranslationEngine({ config: { ...config, maxRetries: 2 }, provider: flaky, store: kb(), sleep: noSleep });
    const res = await engine.translateBatch({ sourceLanguage: "fr", targetLanguage: "dua", items: [{ id: "1", text: "Payer la maison", context: "other" }] });
    expect(calls).toBe(3);
    expect(res.results[0]?.status).toBe("error");
    expect(res.results[0]?.note).toContain("rate limited");
  });

  it("falls back to the configured fallback model when the primary fails", async () => {
    const models: string[] = [];
    const inner = stub(() => ({ translation: null }));
    const provider: LlmProvider = {
      name: "test",
      async complete(req) {
        models.push(req.model);
        if (req.model === "primary") throw new ProviderError("boom", { retryable: false, status: 500, provider: "test" });
        return inner.provider.complete(req);
      },
    };
    const engine = new TranslationEngine({ config: { ...config, model: "primary", fastModel: "primary", fallbackModel: "backup" }, provider, store: kb(), sleep: noSleep });
    const res = await engine.translateBatch({ sourceLanguage: "fr", targetLanguage: "dua", items: [{ id: "1", text: "Payer la maison", context: "other" }] });
    expect(models).toEqual(["primary", "backup"]);
    expect(res.results[0]).toMatchObject({ status: "uncertain", translatedText: null, needsReview: true });
  });
});

describe("helpers", () => {
  it("parseLlmOutput strips markdown fences and fills missing ids", () => {
    const out = parseLlmOutput('```json\n{"items":[{"id":"a","translation":"x","glosses":[],"notFound":[],"note":null}]}\n```', ["a", "b"]);
    expect(out.items).toHaveLength(2);
    expect(out.items[1]?.translation).toBeNull();
  });
  it("parseLlmOutput throws on garbage", () => {
    expect(() => parseLlmOutput("nope", ["a"])).toThrow();
  });
  it("validateTranslationText protects placeholders and URLs", () => {
    expect(validateTranslationText("Hello {name}", "D {name}").ok).toBe(true);
    expect(validateTranslationText("Hello {name}", "D name").ok).toBe(false);
  });
  it("matchCase copies capitalisation", () => {
    expect(matchCase("Search", "d-search")).toBe("D-search");
    expect(matchCase("SEARCH", "d-search")).toBe("D-SEARCH");
  });
  it("partitionTexts separates long texts", () => {
    const parts = partitionTexts([{ text: "Short label" }, { text: "One sentence. Two sentences." }], 5);
    expect(parts.map((p) => p.tier)).toEqual(["fast", "capable"]);
  });
  it("withRetry retries retryable errors only", async () => {
    let n = 0;
    await expect(withRetry(async () => { n++; throw new ProviderError("x", { retryable: false, provider: "p" }); }, { maxRetries: 3, sleep: noSleep })).rejects.toThrow();
    expect(n).toBe(1);
  });
});
