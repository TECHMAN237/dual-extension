import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadSeedSources, toEntryInputs, wikipediaTablePairs } from "../src";

const wikitext = readFileSync(new URL("./fixtures/wikipedia-fr-duala-tables.wikitext", import.meta.url), "utf8");

describe("Wikipédia (fr) « Duala (langue) » tables (real extract, CC BY-SA 4.0)", () => {
  const pairs = wikipediaTablePairs(wikitext, 241045385);
  const find = (fr: string) => pairs.filter((p) => p.sourceText === fr).map((p) => p.targetText);

  it("reads French → Duala rows from every table, splitting alternatives", () => {
    expect(find("eau")).toEqual(["madíɓá"]);
    expect(find("terre")).toEqual(["wásē", "minyáŋgádú"]);
    expect(find("Janvier")).toEqual(["Dimɔ́di"]);
    expect(find("dix")).toEqual(["ɗôm"]);
    expect(pairs.every((p) => p.reference === "https://fr.wikipedia.org/wiki/Duala_(langue)")).toBe(true);
    expect(pairs[0]!.note).toContain("révision 241045385, CC BY-SA 4.0");
  });

  it("moves plural/agreement forms and stems to the note", () => {
    const coeur = pairs.find((p) => p.sourceText === "le cœur")!;
    expect(coeur.targetText).toBe("muléma");
    expect(coeur.note).toContain("Formes (pluriel / accord) : miléma");
    expect(find("grand")).toEqual(["éndɛ̄nɛ", "ɓondɛ́nɛ"]);
    expect(pairs.find((p) => p.sourceText === "grand")!.note).toContain("Radical (prend le préfixe de la classe du nom) : -ndɛ̄nɛ");
  });

  it("keeps the phrases; real sentences become examples after the audit", () => {
    const source = loadSeedSources().find((s) => s.id === "wikipedia-duala")!;
    const entries = toEntryInputs(pairs, { source, sourceLanguage: "fr", targetLanguage: "dua" }).entries;
    const neg = entries.find((e) => e.sourceText === "je ne veux pas manger")!;
    expect(neg).toMatchObject({ targetText: "na sí ma púlá dá", category: "sentence_example", validationStatus: "pending" });
    expect(entries.find((e) => e.sourceText === "je sais")).toMatchObject({ targetText: "na bi", category: "expression" });
  });
});
