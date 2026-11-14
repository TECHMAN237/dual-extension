import { describe, expect, it } from "vitest";
import { InMemoryKnowledgeStore, VERIFIED_IMPORT_SOURCE_ID, ingestBuffer, loadSeedSources, toEntryInputs, writeEntriesKeepingReview } from "../src";

// Test-only placeholders ("T-…"), not Duala: the tests check the mechanism, not the language.
const csv = [
  "source_language,source_text,target_text,category,context,note",
  "fr,accueil,T-accueil,vocabulary,website_navigation,",
  "fr,menu,,vocabulary,website_navigation,",
].join("\n");

const sources = loadSeedSources();
const manual = sources.find((s) => s.id === VERIFIED_IMPORT_SOURCE_ID)!;
const mboasawa = sources.find((s) => s.id === "mboasawa-dictionnaire-duala")!;

describe("pnpm ingest --verified (entries checked by a speaker)", () => {
  it("imports filled rows as verified and skips rows without a Duala translation", async () => {
    const store = new InMemoryKnowledgeStore();
    const report = await ingestBuffer(Buffer.from(csv), "verified-by-speaker.csv", "text/csv", { store, source: manual, sourceLanguage: "fr", format: "csv", verified: true, reviewer: "A.M." });
    expect(report.extracted).toBe(1);
    expect(report.warnings.join(" ")).toMatch(/1 row\(s\) without a Duala translation were skipped/);
    const [e] = await store.listEntries({});
    expect(e).toMatchObject({ sourceText: "accueil", targetText: "T-accueil", validationStatus: "verified", origin: "verified_source", sourceId: VERIFIED_IMPORT_SOURCE_ID });
    expect(e!.note).toContain("Verified by a Duala speaker (A.M.)");
  });

  it("is refused for any other source (dictionary imports always stay pending)", async () => {
    const store = new InMemoryKnowledgeStore();
    await expect(ingestBuffer(Buffer.from(csv), "x.csv", "text/csv", { store, source: mboasawa, sourceLanguage: "fr", format: "csv", verified: true })).rejects.toThrow(/only allowed for the source "manual-linguist-entries"/);
    expect(await store.countEntries()).toBe(0);
  });

  it("without --verified the same file is imported as pending", async () => {
    const store = new InMemoryKnowledgeStore();
    await ingestBuffer(Buffer.from(csv), "verified-by-speaker.csv", "text/csv", { store, source: manual, sourceLanguage: "fr", format: "csv" });
    const entries = await store.listEntries({});
    expect(entries.every((e) => e.validationStatus === "pending")).toBe(true);
  });

  it("a verified import upgrades the same pending entry instead of duplicating it", async () => {
    const store = new InMemoryKnowledgeStore();
    const pending = toEntryInputs([{ sourceText: "accueil", targetText: "T-accueil" }], { source: manual, sourceLanguage: "fr", targetLanguage: "dua" });
    await writeEntriesKeepingReview(store, pending.entries);
    await ingestBuffer(Buffer.from(csv), "verified-by-speaker.csv", "text/csv", { store, source: manual, sourceLanguage: "fr", format: "csv", verified: true });
    const filled = (await store.listEntries({})).filter((e) => e.targetText === "T-accueil");
    expect(filled).toHaveLength(1);
    expect(filled[0]!.validationStatus).toBe("verified");
  });
});
