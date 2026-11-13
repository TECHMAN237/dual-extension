import { describe, expect, it, vi } from "vitest";
import type { KnowledgeEntry } from "@douala-ai/shared";
import { InMemoryKnowledgeStore, retrieveReferences } from "@douala-ai/linguistic-knowledge";
import { TranslationEngine, buildSystemPrompt, checkAssistedTranslation, engineConfigSchema, type CompletionRequest, type LlmProvider } from "../src";

function entry(partial: Partial<KnowledgeEntry> & { sourceText: string; targetText: string | null }): KnowledgeEntry {
  return {
    id: partial.id ?? `id-${partial.sourceText}-${partial.targetText}`,
    sourceLanguage: "fr",
    targetLanguage: "dua",
    category: "vocabulary",
    context: null,
    example: null,
    note: null,
    sourceId: "wiktionary-dua",
    sourceName: "Wiktionary",
    sourceUrl: null,
    reference: "https://fr.wiktionary.org/wiki/x",
    origin: "extracted_unverified",
    validationStatus: "pending",
    reliability: "community",
    extractedAt: "2026-11-13T00:00:00.000Z",
    tags: [],
    ...partial,
  };
}

/** Provider stub: answers each segment with `answer(text)` and records every call. */
function stubProvider(answer: (text: string) => string | null) {
  const calls: CompletionRequest[] = [];
  const provider: LlmProvider = {
    name: "stub",
    complete: vi.fn(async (req: CompletionRequest) => {
      calls.push(req);
      const items = JSON.parse(req.user.split("<items>\n")[1]!.split("\n</items>")[0]!) as { id: string; text: string; references: { id: string }[] }[];
      return {
        text: JSON.stringify({ items: items.map((i) => ({ id: i.id, translation: answer(i.text), evidence: "low", usedReferenceIds: i.references.map((r) => r.id), note: null })) }),
        model: "stub-model",
        stopReason: "end",
      };
    }),
  };
  return { provider, calls };
}

const base = { provider: "openrouter" as const, apiKey: "k", model: "m", fastModel: "m", maxRetries: 0, batchSize: 10, concurrency: 1 };
const assisted = engineConfigSchema.parse({ ...base, translationMode: "assisted" });
const strict = engineConfigSchema.parse({ ...base, translationMode: "strict" });

const kb = () =>
  new InMemoryKnowledgeStore({
    seedEntries: [
      entry({ sourceText: "payer", targetText: "sáwa" }),
      entry({ sourceText: "le transfert", targetText: "T-transfert" }),
      entry({ sourceText: "le compte-rendu", targetText: "bolángi" }),
      entry({ sourceText: "les toilettes", targetText: "ndábo a mbúsa", category: "expression" }),
      entry({ sourceText: "acheter", targetText: "anda" }),
      entry({ sourceText: "acheter", targetText: "anda-bis", id: "alt", sourceId: "mboasawa", sourceName: "Mboa Sawa", reliability: "unknown" }),
      entry({ sourceText: "vendre", targetText: "andisɛ", reliability: "established" }),
      entry({ sourceText: "maison", targetText: "V-ndabo", validationStatus: "verified", origin: "verified_source", reliability: "established" }),
      entry({ sourceText: "il a fouillé toute la maison à la recherche de son argent", targetText: "phrase douala", category: "sentence_example" }),
    ],
  });

describe("direct dictionary layer (both modes)", () => {
  it.each([["assisted", assisted], ["strict", strict]] as const)("%s: applies an exact PENDING entry without calling the model", async (_m, config) => {
    const { provider } = stubProvider(() => "should not be used");
    const engine = new TranslationEngine({ config, provider, store: kb() });
    const res = await engine.translateBatch({ sourceLanguage: "fr", targetLanguage: "dua", items: [{ id: "1", text: "Payer.", context: "button" }] });
    expect(provider.complete).not.toHaveBeenCalled();
    expect(res.results[0]).toMatchObject({ translatedText: "Sáwa", status: "translated", evidence: "low", needsReview: true });
    expect(res.results[0]!.references[0]).toMatchObject({ sourceText: "payer", targetText: "sáwa", reference: "https://fr.wiktionary.org/wiki/x" });
  });

  it("normalises articles, accents, case and simple plurals", async () => {
    const { provider } = stubProvider(() => null);
    const engine = new TranslationEngine({ config: assisted, provider, store: kb() });
    const res = await engine.translateBatch({ sourceLanguage: "fr", targetLanguage: "dua", items: [{ id: "1", text: "TRANSFERTS", context: "heading" }] });
    expect(res.results[0]!.translatedText).toBe("T-TRANSFERT");
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it("evidence: high if verified, moderate if established, low otherwise; picks the most reliable and lists the others", async () => {
    const { provider } = stubProvider(() => null);
    const engine = new TranslationEngine({ config: assisted, provider, store: kb() });
    const res = await engine.translateBatch({
      sourceLanguage: "fr",
      targetLanguage: "dua",
      items: [
        { id: "v", text: "Maison", context: "heading" },
        { id: "e", text: "vendre", context: "button" },
        { id: "a", text: "Acheter", context: "button" },
      ],
    });
    const by = Object.fromEntries(res.results.map((r) => [r.id, r]));
    expect(by.v).toMatchObject({ translatedText: "V-ndabo", evidence: "high", needsReview: false });
    expect(by.e).toMatchObject({ translatedText: "andisɛ", evidence: "moderate", needsReview: true });
    expect(by.a).toMatchObject({ translatedText: "Anda", evidence: "low" });
    expect(by.a!.note).toContain("anda-bis (Mboa Sawa)");
  });
});

describe("cleaner retrieval", () => {
  it("function words never create a reference; weak overlaps and long examples are dropped", async () => {
    const store = kb();
    const opts = { sourceLanguage: "fr" as const, targetLanguage: "dua" as const };
    const compte = await retrieveReferences(store, "Compte courant", opts);
    expect(compte.map((r) => r.entry.sourceText)).not.toContain("le compte-rendu");
    const frais = await retrieveReferences(store, "Consulter les frais", opts);
    expect(frais.map((r) => r.entry.sourceText)).not.toContain("les toilettes");
    const argent = await retrieveReferences(store, "Argent", opts);
    expect(argent.map((r) => r.entry.category)).not.toContain("sentence_example");
  });
});

describe("assisted mode", () => {
  it("translates only with an anchored word, keeping other words as loans", async () => {
    const { provider } = stubProvider((text) => (text === "Payer la facture" ? "Sáwa la facture" : null));
    const engine = new TranslationEngine({ config: assisted, provider, store: kb() });
    const res = await engine.translateBatch({ sourceLanguage: "fr", targetLanguage: "dua", items: [{ id: "1", text: "Payer la facture", context: "button" }] });
    expect(res.results[0]).toMatchObject({ translatedText: "Sáwa la facture", status: "translated", evidence: "low", needsReview: true });
    expect(res.results[0]!.references.map((r) => r.targetText)).toEqual(["sáwa"]);
  });

  it("does not call the model when no content word has a reference", async () => {
    const { provider } = stubProvider(() => "anything");
    const engine = new TranslationEngine({ config: assisted, provider, store: kb() });
    const res = await engine.translateBatch({ sourceLanguage: "fr", targetLanguage: "dua", items: [{ id: "1", text: "Consulter les frais", context: "link" }] });
    expect(provider.complete).not.toHaveBeenCalled();
    expect(res.results[0]).toMatchObject({ translatedText: null, status: "uncertain" });
  });

  it.each([
    ["no Duala word from the references", "Payer la facture"],
    ["an invented Duala word", "Sáwa mbɔ́ŋgɛ facture"],
    ["the Duala word with altered tones", "Sawa la facture"],
  ])("rejects an output with %s (becomes uncertain)", async (_label, output) => {
    const { provider } = stubProvider(() => output);
    const engine = new TranslationEngine({ config: assisted, provider, store: kb() });
    const res = await engine.translateBatch({ sourceLanguage: "fr", targetLanguage: "dua", items: [{ id: "1", text: "Payer la facture", context: "button" }] });
    expect(provider.complete).toHaveBeenCalledTimes(1);
    expect(res.results[0]).toMatchObject({ translatedText: null, status: "uncertain", evidence: "unverified" });
    expect(res.results[0]!.note).toMatch(/anti-invention/);
  });

  it("uses the assisted system prompt", async () => {
    const { provider, calls } = stubProvider(() => null);
    const engine = new TranslationEngine({ config: assisted, provider, store: kb() });
    await engine.translateBatch({ sourceLanguage: "fr", targetLanguage: "dua", items: [{ id: "1", text: "Payer la facture", context: "button" }] });
    expect(calls[0]!.system).toBe(buildSystemPrompt("fr", "dua", "assisted"));
    expect(calls[0]!.system).toContain("NEVER write a Duala word that is not in the references");
  });

  it("checkAssistedTranslation accepts loans and reference words only", () => {
    expect(checkAssistedTranslation("Acheter ou vendre", "Anda ou andisɛ", ["anda", "andisɛ"]).ok).toBe(true);
    expect(checkAssistedTranslation("Acheter ou vendre", "Acheter ou vendre", ["anda", "andisɛ"]).ok).toBe(false);
    expect(checkAssistedTranslation("Acheter ou vendre", "Anda na andisɛ", ["anda", "andisɛ"]).ok).toBe(false);
  });
});

describe("strict mode is unchanged", () => {
  it("still sends segments without evidence to the model and keeps its null", async () => {
    const { provider, calls } = stubProvider(() => null);
    const engine = new TranslationEngine({ config: strict, provider, store: kb() });
    const res = await engine.translateBatch({ sourceLanguage: "fr", targetLanguage: "dua", items: [{ id: "1", text: "Consulter les frais", context: "link" }] });
    expect(provider.complete).toHaveBeenCalledTimes(1);
    expect(calls[0]!.system).toBe(buildSystemPrompt("fr", "dua", "strict"));
    expect(calls[0]!.system).toContain("Never invent vocabulary");
    expect(res.results[0]).toMatchObject({ translatedText: null, status: "uncertain" });
  });
});

describe("plan (coverage)", () => {
  it("classifies texts without calling the model", async () => {
    const { provider } = stubProvider(() => "x");
    const engine = new TranslationEngine({ config: assisted, provider, store: kb() });
    const plan = await engine.plan(["Payer", "Payer la facture", "Consulter les frais", "Safinum Pay"], "fr");
    expect(plan.map((p) => p.route)).toEqual(["dictionary", "assisted", "kept", "kept"]);
    expect(plan[0]!.translation).toBe("Sáwa");
    expect(plan[1]!.anchors).toEqual([{ word: "payer", duala: "sáwa" }]);
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it("never anchors a brand or proper name, nor a short word through the plural rule", async () => {
    const store = new InMemoryKnowledgeStore({ seedEntries: [entry({ sourceText: "pays", targetText: "D-pays" }), entry({ sourceText: "payer", targetText: "sáwa" })] });
    const engine = new TranslationEngine({ config: assisted, provider: stubProvider(() => null).provider, store });
    const plan = await engine.plan(["Safinum Pay", "Pay", "Payer avec Safinum Pay"], "fr");
    expect(plan[0]!.route).toBe("kept");
    expect(plan[1]!.route).toBe("kept");
    expect(plan[2]!.anchors).toEqual([{ word: "payer", duala: "sáwa" }]);
  });
});
