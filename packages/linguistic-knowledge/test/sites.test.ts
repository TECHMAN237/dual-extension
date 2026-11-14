import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  InMemoryKnowledgeStore,
  PoliteSession,
  SiteBlockedError,
  isAllowedByRobots,
  loadSeedSources,
  looksLikeChallenge,
  mboasawaPairs,
  parseMboasawaLetterPage,
  parseMboasawaWordPage,
  splitSenses,
  stableEntryId,
  toEntryInputs,
  wikitextToPlain,
  wiktionaryPairs,
  writeEntriesKeepingReview,
  type WiktionaryPage,
} from "../src";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("splitSenses", () => {
  it("creates one sense per meaning and keeps descriptions whole", () => {
    expect(splitSenses("maison, demeure ; foyer").map((s) => s.text)).toEqual(["maison", "demeure", "foyer"]);
    expect(splitSenses("la digue, le barrage d'un cours d'eau").map((s) => s.text)).toEqual(["la digue", "le barrage d'un cours d'eau"]);
    expect(splitSenses("Exprime la surprise, le désespoir ou la douleur.").map((s) => s.text)).toEqual(["exprime la surprise, le désespoir ou la douleur"]);
    expect(splitSenses("Il y a (indique l’existence).")).toEqual([{ text: "il y a", note: "indique l’existence" }]);
    expect(splitSenses("red ironwood, meni oil tree (Lophira alata)", { lowercaseFirst: false })).toEqual([
      { text: "red ironwood", note: null },
      { text: "meni oil tree", note: "Lophira alata" },
    ]);
    expect(splitSenses("Hausa person", { lowercaseFirst: false })[0]!.text).toBe("Hausa person");
    expect(splitSenses("partager, partager")).toHaveLength(1);
  });
});

describe("Mboa Sawa extractor (real HTML extracts in test/fixtures)", () => {
  it("lists the Duala headwords of a letter page and follows its pagination", () => {
    const page = parseMboasawaLetterPage(fixture("mboasawa-letter-A.html"), "https://mboasawa.com/fr/mboasawa-2/dictionnaire-duala/?lettre=A");
    expect(page.words.slice(0, 4)).toEqual([
      { headword: "ā", url: "https://mboasawa.com/fr/dictionnaire-duala/a/" },
      { headword: "aba", url: "https://mboasawa.com/fr/dictionnaire-duala/aba/" },
      { headword: "aba !", url: "https://mboasawa.com/fr/dictionnaire-duala/aba-2/" },
      { headword: "abaŋɛ", url: "https://mboasawa.com/fr/dictionnaire-duala/aban%c9%9b/" },
    ]);
    expect(page.nextPage).toBe("https://mboasawa.com/fr/dictionnaire-duala/?lettre=A&mboa_page=2");
  });

  it("reads a word page and inverts the pair: French source, Duala target with exact spelling", () => {
    const url = "https://mboasawa.com/fr/dictionnaire-duala/aban%c9%9b/";
    const word = parseMboasawaWordPage(fixture("mboasawa-word-abane.html"));
    expect(word).toEqual({ headword: "abaŋɛ", translation: "partager" });
    expect(mboasawaPairs(word!, url)).toEqual([{ sourceText: "partager", targetText: "abaŋɛ", category: "vocabulary", note: null, example: null, reference: url, tags: ["mboasawa"] }]);
  });

  it("splits senses, moves grammatical abbreviations to the note and skips placeholders", () => {
    const pairs = mboasawaPairs({ headword: "m’boki", translation: "la cuve, le fouloir, l'huilerie" }, "https://x/");
    expect(pairs.map((p) => [p.sourceText, p.targetText])).toEqual([
      ["la cuve", "m’boki"],
      ["le fouloir", "m’boki"],
      ["l'huilerie", "m’boki"],
    ]);
    const interj = mboasawaPairs({ headword: "aba !", translation: "interj. expr. la surprise" }, "https://x/");
    expect(interj[0]).toMatchObject({ sourceText: "expr. la surprise", note: "Mboa Sawa: interj." });
    expect(mboasawaPairs({ headword: "ábu", translation: "Traduction à compléter" }, "https://x/")).toEqual([]);
    expect(mboasawaPairs({ headword: "ábu", translation: "" }, "https://x/")).toEqual([]);
  });
});

describe("Wiktionary extractor (real wikitext extracts, CC BY-SA 4.0)", () => {
  const fr = JSON.parse(fixture("wiktionary-fr-sample.json")) as { pages: WiktionaryPage[] };
  const en = JSON.parse(fixture("wiktionary-en-sample.json")) as { pages: WiktionaryPage[] };
  const page = (set: { pages: WiktionaryPage[] }, title: string) => set.pages.find((p) => p.title === title)!;

  it("fr: reads only the {{langue|dua}} section, one entry per sense, with attribution", () => {
    const pairs = wiktionaryPairs("fr", page(fr, "aba"));
    const vocab = pairs.filter((p) => p.category === "vocabulary").map((p) => [p.sourceText, p.targetText]);
    expect(vocab).toEqual([
      ["partager", "aba"],
      ["séparer", "aba"],
      ["désunir", "aba"],
      ["divorcer", "aba"],
      ["exprime la surprise, le désespoir ou la douleur", "aba"],
    ]);
    expect(pairs[0]!.reference).toBe("https://fr.wiktionary.org/wiki/aba");
    expect(pairs[0]!.note).toContain("CC BY-SA 4.0");
    expect(pairs[0]!.note).toContain("révision 39758907");
    const examples = pairs.filter((p) => p.category === "sentence_example").map((p) => [p.sourceText, p.targetText]);
    expect(examples).toContainEqual(["partager la nourriture", "aba da"]);
  });

  it("fr: ignores other languages on the same page and inflected forms", () => {
    const be = wiktionaryPairs("fr", page(fr, "bɛ"));
    expect(be.filter((p) => p.category === "vocabulary").map((p) => p.sourceText)).toEqual(["être", "vivre", "se porter"]);
    expect(be.every((p) => p.targetText === "bɛ" || p.category === "sentence_example")).toBe(true);
    expect(be.find((p) => p.category === "sentence_example")).toMatchObject({ sourceText: "être courageux", targetText: "bɛ ŋgiń’a muléma" });
    expect(wiktionaryPairs("fr", page(fr, "babakwedi"))).toEqual([]);
  });

  it("en: English senses, scientific names as notes, Helmlinger page references, derived terms", () => {
    const b = wiktionaryPairs("en", page(en, "bongo̱si"));
    expect(b.map((p) => [p.sourceText, p.targetText])).toEqual([
      ["red ironwood", "bongo̱si"],
      ["meni oil tree", "bongo̱si"],
    ]);
    expect(b[1]!.note).toContain("Lophira alata");
    expect(b[0]!.note).toContain("cites Helmlinger (1972), p. 49");
    const nd = wiktionaryPairs("en", page(en, "ndabo"));
    expect(nd.filter((p) => p.category === "vocabulary").map((p) => p.sourceText)).toEqual(["house", "building"]);
    expect(nd.filter((p) => p.category === "expression").map((p) => [p.sourceText, p.targetText])).toContainEqual(["a hospital", "ndabo a baboedi"]);
    expect(nd.filter((p) => p.category === "expression").map((p) => p.targetText)).toEqual(expect.arrayContaining(["ndabo a mitin", "ndabo a Loba"]));
  });

  it("turns wikitext into plain text without inventing anything", () => {
    expect(wikitextToPlain("[[partager|Partager]], {{lien|désunir|fr}} {{term|AGLC}}.<ref>x</ref>")).toBe("Partager, désunir .");
    expect(wikitextToPlain("{{vern|meni oil tree}} ({{taxlink|Lophira alata|species}})")).toBe("meni oil tree (Lophira alata)");
    // Meinhof orthography written with HTML entities: &#817; = U+0331 combining macron below.
    expect(wikitextToPlain("ba de&#817;be&#817;le&#817; ńango")).toBe("ba de̱be̱le̱ ńango");
  });
});

describe("robots.txt", () => {
  it("supports wildcards, end anchors and multi-agent groups", () => {
    const kemelang = "User-agent: claude\nUser-agent: anthropic\nDisallow: /\n\nUser-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /*?*=\n";
    expect(isAllowedByRobots(kemelang, "/duala/", "claude/1.0")).toBe(false);
    expect(isAllowedByRobots(kemelang, "/duala/", "anthropic/1.0")).toBe(false);
    expect(isAllowedByRobots(kemelang, "/duala/", "DoualaAI-Ingestion/0.1")).toBe(true);
    expect(isAllowedByRobots(kemelang, "/search?q=x", "DoualaAI-Ingestion/0.1")).toBe(false);
    expect(isAllowedByRobots("User-agent: *\nDisallow: /*.pdf$\n", "/a/b.pdf", "x/1")).toBe(false);
    expect(isAllowedByRobots("User-agent: *\nDisallow: /*.pdf$\n", "/a/b.pdf?x", "x/1")).toBe(true);
    const mboasawa = "User-agent: *\nDisallow: /application/\nDisallow: /temporary/\n";
    expect(isAllowedByRobots(mboasawa, "/fr/mboasawa-2/dictionnaire-duala/?lettre=A", "DoualaAI-Ingestion/0.1")).toBe(true);
  });
});

describe("PoliteSession", () => {
  const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html" } });

  it("waits at least 3 s between requests to the same host and reads robots.txt once", async () => {
    let t = 0;
    const waits: number[] = [];
    const fetchImpl = vi.fn(async (url: string) => (url.endsWith("/robots.txt") ? html("User-agent: *\nDisallow: /private/") : html("<p>ok</p>")));
    const s = new PoliteSession({ fetchImpl: fetchImpl as unknown as typeof fetch, now: () => t, sleep: async (ms) => void (waits.push(ms), (t += ms)) });
    await s.getText("https://example.org/a");
    await s.getText("https://example.org/b");
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual(["https://example.org/robots.txt", "https://example.org/a", "https://example.org/b"]);
    expect(waits.every((w) => w >= 3_000)).toBe(true);
    expect(waits).toHaveLength(2);
    await expect(s.getText("https://example.org/private/x")).rejects.toBeInstanceOf(SiteBlockedError);
  });

  it.each([
    ["403", html("forbidden", 403)],
    ["429", html("slow down", 429)],
    ["CAPTCHA", html('<html><head><title>Just a moment...</title></head><body><div class="cf-chl-widget"></div></body></html>')],
  ])("stops at the first %s without retrying", async (_label, response) => {
    const fetchImpl = vi.fn(async (url: string) => (url.endsWith("/robots.txt") ? html("", 404) : response.clone()));
    const s = new PoliteSession({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => undefined });
    await expect(s.getText("https://example.org/a")).rejects.toBeInstanceOf(SiteBlockedError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("detects challenge pages but not ordinary pages that mention the word", () => {
    expect(looksLikeChallenge('<script src="https://www.google.com/recaptcha/api.js"></script>')).toBe(true);
    expect(looksLikeChallenge("<p>Notre formulaire n'utilise pas de captcha.</p>")).toBe(false);
  });
});

describe("re-ingestion", () => {
  const source = loadSeedSources().find((s) => s.id === "mboasawa-dictionnaire-duala")!;

  it("uses deterministic UUIDs and never undoes a human review", async () => {
    const ctx = { source, sourceLanguage: "fr" as const, targetLanguage: "dua" as const };
    const first = toEntryInputs([{ sourceText: "partager", targetText: "abaŋɛ", reference: "https://x/1" }], ctx);
    const again = toEntryInputs([{ sourceText: "partager", targetText: "abaŋɛ", reference: "https://x/1" }], ctx);
    expect(first.entries[0]!.id).toBe(again.entries[0]!.id);
    expect(first.entries[0]!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(first.entries[0]!.id).toBe(stableEntryId({ sourceId: source.id, sourceLanguage: "fr", targetLanguage: "dua", category: "vocabulary", sourceText: "partager", targetText: "abaŋɛ" }));

    const store = new InMemoryKnowledgeStore();
    await writeEntriesKeepingReview(store, first.entries);
    await store.updateEntryStatus(first.entries[0]!.id!, "verified", "checked against Helmlinger p. 3");
    await writeEntriesKeepingReview(store, again.entries);
    expect(await store.countEntries()).toBe(1);
    const [e] = await store.getEntries([first.entries[0]!.id!]);
    expect(e).toMatchObject({ validationStatus: "verified", note: "checked against Helmlinger p. 3" });
  });
});
