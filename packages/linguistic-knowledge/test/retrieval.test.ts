import { describe, expect, it } from "vitest";
import type { KnowledgeEntry } from "@douala-ai/shared";
import { InMemoryKnowledgeStore, deriveEvidenceLevel, retrieveReferences, scoreEntry } from "../src";

/**
 * Test fixtures use obviously fake target strings ("T:...") so that no invented
 * Douala vocabulary enters the repository.
 */
function entry(partial: Partial<KnowledgeEntry> & { sourceText: string }): KnowledgeEntry {
  return {
    id: partial.id ?? `id-${partial.sourceText}`,
    sourceLanguage: "en",
    targetLanguage: "dua",
    targetText: `T:${partial.sourceText}`,
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

describe("scoreEntry", () => {
  it("ranks exact matches above partial ones", () => {
    const exact = scoreEntry("Sign in", entry({ sourceText: "sign in" }))!;
    const partial = scoreEntry("Sign in to continue", entry({ sourceText: "sign in" }))!;
    const overlap = scoreEntry("Sign in", entry({ sourceText: "sign up" }))!;
    expect(exact.matchType).toBe("exact");
    expect(partial.matchType).toBe("contained");
    expect(exact.score).toBeGreaterThan(partial.score);
    expect(partial.score).toBeGreaterThan(overlap.score);
  });
  it("prefers verified entries over pending ones", () => {
    const v = scoreEntry("Home", entry({ sourceText: "Home" }))!;
    const p = scoreEntry("Home", entry({ sourceText: "Home", validationStatus: "pending", origin: "extracted_unverified" }))!;
    expect(v.score).toBeGreaterThan(p.score);
  });
});

describe("retrieveReferences", () => {
  it("returns ranked, de-duplicated references from the store", async () => {
    const store = new InMemoryKnowledgeStore({
      seedEntries: [
        entry({ id: "1", sourceText: "Search" }),
        entry({ id: "2", sourceText: "Search", sourceName: "Other", reliability: "community", validationStatus: "pending", origin: "extracted_unverified" }),
        entry({ id: "3", sourceText: "Advanced search" }),
        entry({ id: "4", sourceText: "Contact us" }),
      ],
    });
    const refs = await retrieveReferences(store, "Search", { sourceLanguage: "en", targetLanguage: "dua" });
    expect(refs[0]?.entry.id).toBe("1");
    expect(refs.map((r) => r.entry.id)).not.toContain("4");
    // duplicate pair (same source/target) collapsed
    expect(refs.filter((r) => r.entry.sourceText === "Search").length).toBe(1);
  });
  it("filters by source language and excludes rejected entries", async () => {
    const store = new InMemoryKnowledgeStore({
      seedEntries: [entry({ id: "fr", sourceText: "Menu", sourceLanguage: "fr" }), entry({ id: "rej", sourceText: "Menu", validationStatus: "rejected" })],
    });
    const refs = await retrieveReferences(store, "Menu", { sourceLanguage: "en", targetLanguage: "dua" });
    expect(refs).toHaveLength(0);
  });
});

describe("deriveEvidenceLevel", () => {
  it("is high for exact verified matches", async () => {
    const store = new InMemoryKnowledgeStore({ seedEntries: [entry({ sourceText: "Welcome" })] });
    const refs = await retrieveReferences(store, "Welcome", { sourceLanguage: "en", targetLanguage: "dua" });
    expect(deriveEvidenceLevel("Welcome", refs)).toBe("high");
  });
  it("is moderate for exact matches from established but unverified sources", async () => {
    const store = new InMemoryKnowledgeStore({ seedEntries: [entry({ sourceText: "Welcome", validationStatus: "pending", origin: "extracted_unverified", reliability: "established" })] });
    const refs = await retrieveReferences(store, "Welcome", { sourceLanguage: "en", targetLanguage: "dua" });
    expect(deriveEvidenceLevel("Welcome", refs)).toBe("moderate");
  });
  it("is unverified with no references or references without targets", async () => {
    expect(deriveEvidenceLevel("Anything", [])).toBe("unverified");
    const store = new InMemoryKnowledgeStore({ seedEntries: [entry({ sourceText: "Anything", targetText: null })] });
    const refs = await retrieveReferences(store, "Anything", { sourceLanguage: "en", targetLanguage: "dua" });
    expect(deriveEvidenceLevel("Anything", refs)).toBe("unverified");
  });
});
