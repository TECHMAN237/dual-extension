import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { grammarPairsBySource, parseGrammarSheet } from "../src";

const sheet = readFileSync(new URL("../../../data/knowledge/grammaire-douala.md", import.meta.url), "utf8");

describe("grammar sheet data/knowledge/grammaire-douala.md", () => {
  const rules = parseGrammarSheet(sheet);

  it("every rule cites at least one https source; undocumented points say so", () => {
    expect(rules.length).toBeGreaterThanOrEqual(20);
    for (const r of rules) {
      expect(r.sources.length, r.id).toBeGreaterThan(0);
      for (const s of r.sources) expect(s, r.id).toMatch(/^https:\/\//);
      expect(r.text.length, r.id).toBeGreaterThan(20);
    }
    expect(rules.filter((r) => !r.documented).map((r) => r.id)).toEqual(expect.arrayContaining(["G07", "G14"]));
  });

  it("documented rules become grammar_rule pairs grouped by their first source", () => {
    const bySource = grammarPairsBySource(rules);
    const all = [...bySource.values()].flat();
    expect(all.every((p) => p.category === "grammar_rule" && p.targetText === null && p.reference?.startsWith("https://"))).toBe(true);
    expect(bySource.get("wals-duala")!.map((p) => p.sourceText)).toContain("G17 · Ordre des mots : sujet, verbe, objet");
    expect(all.find((p) => p.sourceText.startsWith("G19"))!.example).toContain("na sí bí");
  });
});
