import { describe, expect, it } from "vitest";
import { extractFromCsv, extractFromHtml, extractFromJson, extractPairsFromText, isAllowedByRobots, loadSeedSources, loadSeedUiTerms, toEntryInputs } from "../src";

const source = loadSeedSources().find((s) => s.id === "manual-linguist-entries")!;

describe("extractFromCsv", () => {
  it("reads pairs with default columns and keeps empty targets as null", () => {
    const pairs = extractFromCsv("source_text,target_text,category\nHello,T:hello,vocabulary\nSearch,,vocabulary\n");
    expect(pairs).toEqual([
      expect.objectContaining({ sourceText: "Hello", targetText: "T:hello", category: "vocabulary" }),
      expect.objectContaining({ sourceText: "Search", targetText: null }),
    ]);
  });
});

describe("extractFromHtml", () => {
  it("extracts two-column tables", () => {
    const html = `<table><tr><th>Mot</th><th>Sens</th></tr><tr><td>a</td><td>T:a</td></tr><tr><td>b</td><td>T:b</td></tr><tr><td>c</td><td>T:c</td></tr></table>`;
    const pairs = extractFromHtml(html);
    expect(pairs.map((p) => p.sourceText)).toEqual(["a", "b", "c"]);
  });
  it("extracts definition lists and ignores scripts", () => {
    const html = `<script>ignore me</script><dl><dt>x</dt><dd>T:x</dd><dt>y</dt><dd>T:y</dd><dt>z</dt><dd>T:z</dd></dl>`;
    expect(extractFromHtml(html, { strategy: "dl" })).toHaveLength(3);
  });
  it("supports custom selectors", () => {
    const html = `<div class="entry"><span class="hw">word</span><span class="gl">T:word</span></div>`;
    const pairs = extractFromHtml(html, { strategy: "custom", entrySelector: ".entry", headwordSelector: ".hw", glossSelector: ".gl" });
    expect(pairs[0]).toMatchObject({ sourceText: "word", targetText: "T:word" });
  });
});

describe("extractFromJson / text", () => {
  it("parses arrays and objects with entries", () => {
    expect(extractFromJson('[{"sourceText":"a","targetText":"T:a"}]')).toHaveLength(1);
    expect(extractFromJson('{"entries":[{"sourceText":"a"}]}')[0]?.targetText).toBeNull();
    expect(() => extractFromJson('{"nope":1}')).toThrow();
  });
  it("extracts 'word — gloss' lines", () => {
    const pairs = extractPairsFromText("foo — T:foo\nnot a pair\nbar : T:bar");
    expect(pairs).toHaveLength(2);
  });
});

describe("toEntryInputs", () => {
  it("marks extracted entries as pending with provenance and removes duplicates", () => {
    const report = toEntryInputs([{ sourceText: "a", targetText: "T:a" }, { sourceText: "a", targetText: "T:a" }, { sourceText: "", targetText: "x" }], {
      source: { ...source, type: "online_dictionary" },
      sourceLanguage: "fr",
      targetLanguage: "dua",
      documentReference: "https://example.org/page",
    });
    expect(report.extracted).toBe(1);
    expect(report.skipped).toBe(2);
    expect(report.entries[0]).toMatchObject({ origin: "extracted_unverified", validationStatus: "pending", reference: "https://example.org/page", sourceName: source.name });
  });
});

describe("isAllowedByRobots", () => {
  it("honours disallow rules", () => {
    const robots = "User-agent: *\nDisallow: /private/\nAllow: /private/open\n";
    expect(isAllowedByRobots(robots, "/public/page")).toBe(true);
    expect(isAllowedByRobots(robots, "/private/page")).toBe(false);
    expect(isAllowedByRobots(robots, "/private/open/page")).toBe(true);
  });
});

describe("seed data", () => {
  it("contains the resources from the research email and no invented Douala text", () => {
    const sources = loadSeedSources();
    expect(sources.map((s) => s.id)).toEqual(expect.arrayContaining(["dictionnaireduala-com", "glosbe-fr-dua", "mboasawa-dictionnaire-duala", "kemelang-duala"]));
    const terms = loadSeedUiTerms();
    expect(terms.length).toBeGreaterThan(20);
    expect(terms.every((t) => t.targetText === null)).toBe(true);
  });
});
