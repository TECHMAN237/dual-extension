import { describe, expect, it } from "vitest";
import type { KnowledgeEntry } from "@douala-ai/shared";
import { InMemoryKnowledgeStore, findExamples, lemmaCandidates, lookupSegments, tokenizeSegment } from "../src";

// Placeholder "Duala" (D-…): these tests check the mechanism, not the language.
function entry(sourceText: string, targetText: string, extra: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: `id-${sourceText}-${targetText}`,
    sourceLanguage: "fr",
    targetLanguage: "dua",
    sourceText,
    targetText,
    category: "vocabulary",
    context: null,
    example: null,
    note: null,
    sourceId: "t",
    sourceName: "T",
    sourceUrl: null,
    reference: null,
    origin: "extracted_unverified",
    validationStatus: "pending",
    reliability: "community",
    extractedAt: "2026-01-01T00:00:00.000Z",
    tags: [],
    ...extra,
  };
}

const store = new InMemoryKnowledgeStore({
  seedEntries: [
    entry("consulter", "D-consulte"),
    entry("lancer", "D-lance"),
    entry("effectuer", "D-effectue"),
    entry("le compte", "D-compte"),
    entry("le compte rendu", "D-rapport"),
    entry("l'eau", "D-eau"),
    entry("s'il te plaît", "D-stp", { category: "expression" }),
    entry("cheval", "D-cheval"),
    entry("sécurisé", "D-sur"),
    entry("exprime la surprise", "D-oh", { category: "contextual_meaning" }),
    entry("je bois l'eau", "D-je D-bois D-eau", { category: "sentence_example" }),
    entry("pay", "D-pay", { sourceLanguage: "en" }),
    entry("carry", "D-carry", { sourceLanguage: "en" }),
    entry("buy", "D-buy", { sourceLanguage: "en" }),
  ],
});

const fr = { sourceLanguage: "fr" as const, targetLanguage: "dua" as const };
const words = async (text: string, lang = fr) => (await lookupSegments(store, [text], lang))[0]!;

describe("lemmaCandidates", () => {
  it("reduces French conjugated verbs to the infinitive, plurals and feminines to the dictionary form", () => {
    expect(lemmaCandidates("consultez", "fr")).toContain("consulter");
    expect(lemmaCandidates("lancez", "fr")).toContain("lancer");
    expect(lemmaCandidates("effectué", "fr")).toContain("effectuer");
    expect(lemmaCandidates("comptes", "fr")).toContain("compte");
    expect(lemmaCandidates("chevaux", "fr")).toContain("cheval");
    expect(lemmaCandidates("sécurisée", "fr")).toContain("securise");
    expect(lemmaCandidates("ont", "fr")).toContain("avoir");
  });
  it("handles English -s, -es, -ies, -ing, -ed and irregular forms", () => {
    expect(lemmaCandidates("pays", "en")).toContain("pay");
    expect(lemmaCandidates("carries", "en")).toContain("carry");
    expect(lemmaCandidates("buying", "en")).toContain("buy");
    expect(lemmaCandidates("stopped", "en")).toContain("stop");
    expect(lemmaCandidates("paid", "en")).toContain("pay");
  });
});

describe("tokenizeSegment", () => {
  it("separates elisions and drops punctuation", () => {
    expect(tokenizeSegment("L'eau, c'est qu'il faut !").map((t) => t.surface)).toEqual(["L'", "eau", "c'", "est", "qu'", "il", "faut"]);
    expect(tokenizeSegment("aujourd'hui").map((t) => t.surface)).toEqual(["aujourd'hui"]);
    expect(tokenizeSegment("jusqu'au 30").map((t) => t.surface)).toEqual(["jusqu'", "au", "30"]);
  });
});

describe("lookupSegments", () => {
  it("finds conjugated verbs and plurals; function words are kept but not looked up", async () => {
    const r = await words("Consultez vos comptes et lancez un transfert");
    expect(r.items.map((i) => [i.surface, i.kind, i.entries[0]?.targetText ?? null])).toEqual([
      ["Consultez", "found", "D-consulte"],
      ["vos", "function_word", null],
      ["comptes", "found", "D-compte"],
      ["et", "function_word", null],
      ["lancez", "found", "D-lance"],
      ["un", "function_word", null],
      ["transfert", "not_found", null],
    ]);
    expect([r.found, r.total]).toEqual([3, 4]);
  });

  it("matches multi-word expressions first, the longest first", async () => {
    const r = await words("Lisez le compte rendu");
    expect(r.items.find((i) => i.kind === "found")).toMatchObject({ surface: "le compte rendu", entries: [expect.objectContaining({ targetText: "D-rapport" })] });
    const stp = await words("Donne-moi de l'eau, s'il te plaît");
    expect(stp.items.filter((i) => i.kind === "found").map((i) => i.surface)).toEqual(["l'eau", "s'il te plaît"]);
  });

  it("treats capitalised words inside a sentence and acronyms as names; never uses definitions", async () => {
    const r = await words("Payez avec Safinum Pay et l'ANATT");
    expect(r.items.filter((i) => i.kind === "name").map((i) => i.surface)).toEqual(["Safinum", "Pay", "ANATT"]);
    expect((await words("la surprise")).found).toBe(0);
  });

  it("works for English", async () => {
    const r = await words("He paid and is buying", { sourceLanguage: "en", targetLanguage: "dua" });
    expect(r.items.filter((i) => i.kind === "found").map((i) => i.entries[0]!.targetText)).toEqual(["D-pay", "D-buy"]);
  });

  it("finds sentence examples containing the found words", async () => {
    const r = await words("Boire de l'eau");
    const ex = await findExamples(store, [r], fr);
    expect(ex.map((e) => e.targetText)).toEqual(["D-je D-bois D-eau"]);
  });
});
