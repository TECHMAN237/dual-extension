import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyGloss, cleanMboasawaGloss, cleanMboasawaHeadword, loadSeedSources, mboasawaPairs, mboasawaRestUrl, parseMboasawaRestPost, toEntryInputs, wiktionaryTranslationPairs, type MboasawaRestPost, type WiktionaryPage } from "../src";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

describe("Mboa Sawa through the WordPress REST API (real extract)", () => {
  const posts = fixture("mboasawa-rest-sample.json").posts as MboasawaRestPost[];

  it("builds paged API URLs with only the needed fields", () => {
    expect(mboasawaRestUrl(3)).toBe("https://mboasawa.com/fr/wp-json/wp/v2/dictionnaire?per_page=100&page=3&orderby=id&order=asc&_fields=id,link,title,content");
  });

  it("reads the headword, the gloss before ### and keeps the unsegmented examples verbatim", () => {
    const w = parseMboasawaRestPost(posts[0]!)!;
    expect(w).toMatchObject({ headword: "umbisę", translation: "faire frapper; faire sonner", url: "https://mboasawa.com/fr/dictionnaire-duala/umbise-3/" });
    expect(w.examples).toBe("~ nqęń faire sonner les cloches");
    const pairs = mboasawaPairs(w, w.url);
    expect(pairs.map((p) => [p.sourceText, p.targetText])).toEqual([
      ["faire frapper", "umbisę"],
      ["faire sonner", "umbisę"],
    ]);
    expect(pairs[0]!.reference).toBe(w.url);
    expect(pairs[0]!.example).toBe("~ nqęń faire sonner les cloches");
  });

  it("decodes HTML entities in titles and glosses", () => {
    const w = parseMboasawaRestPost(posts[1]!)!;
    expect(w.headword).toBe("úmɓęlę");
    expect(w.examples).toContain("il m’a tourné le dos");
  });
});

describe("Wiktionary translation tables (real extracts, CC BY-SA 4.0)", () => {
  const pages = fixture("wiktionary-translations-sample.json").pages as WiktionaryPage[];
  const page = (t: string) => pages.find((p) => p.title === t)!;

  it("fr: French page word → Duala, with the sense in the note, only inside the French section", () => {
    const pairs = wiktionaryTranslationPairs("fr", page("maison"));
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ sourceText: "maison", targetText: "n’dabo", category: "vocabulary", reference: "https://fr.wiktionary.org/wiki/maison" });
    expect(pairs[0]!.note).toContain("Sens : Bâtiment servant de logis");
    expect(pairs[0]!.note).toContain("CC BY-SA 4.0");
  });

  it("en: /translations subpages give the English word; unchecked translations are skipped", () => {
    expect(wiktionaryTranslationPairs("en", page("water/translations")).map((p) => [p.sourceText, p.targetText])).toEqual([["water", "madíbá"]]);
    expect(wiktionaryTranslationPairs("en", page("I love you"))).toEqual([]);
  });
});

describe("gloss audit", () => {
  it("keeps short senses, turns descriptions into definitions and sentence pairs into examples", () => {
    expect(classifyGloss("être dur", "lɛ ŋgaŋ")).toBe("sense");
    expect(classifyGloss("exprime la surprise, le désespoir ou la douleur", "aba")).toBe("definition");
    expect(classifyGloss("aliment à base de maïs moulu enveloppé dans des feuilles et cuit", "abolo")).toBe("definition");
    expect(classifyGloss("sorte de poisson", "x")).toBe("definition");
    expect(classifyGloss("entrer dans la maison", "só̱lo̱ ó ndábo")).toBe("sentence");
  });

  it("is applied on import: definitions become contextual_meaning with the description in the note", () => {
    const source = loadSeedSources().find((s) => s.id === "wiktionary-dua")!;
    const r = toEntryInputs(
      [
        { sourceText: "partager", targetText: "aba" },
        { sourceText: "exprime la surprise, le désespoir ou la douleur", targetText: "aba" },
      ],
      { source, sourceLanguage: "fr", targetLanguage: "dua" },
    );
    expect(r.entries.map((e) => e.category)).toEqual(["vocabulary", "contextual_meaning"]);
    expect(r.entries[1]!.note).toContain("Définition, pas un équivalent de traduction");
  });
});

describe("Mboa Sawa gloss and headword cleaning (real glosses)", () => {
  it("separates senses from descriptions, cross-references and etymologies", () => {
    expect(cleanMboasawaGloss("b) conj. indique une opposition : mais")).toEqual({ senses: "mais", note: "conj. indique une opposition", kind: "sense" });
    expect(cleanMboasawaGloss("f. réfl. de sóla – se détacher de qch")).toEqual({ senses: "se détacher de qch", note: "f. réfl. de sóla", kind: "sense" });
    expect(cleanMboasawaGloss("voir : ituta").kind).toBe("crossref");
    expect(cleanMboasawaGloss("(de l’angl. ‘threepenny’) 25 centimes")).toEqual({ senses: "25 centimes", note: "de l’angl. ‘threepenny’", kind: "sense" });
    expect(cleanMboasawaGloss("un arbre : Dialium guineense Willd").kind).toBe("definition");
    expect(cleanMboasawaGloss("réponse : Ńamɓé").kind).toBe("definition");
    expect(cleanMboasawaGloss("interrog. de lieu : où?")).toMatchObject({ senses: "où?", kind: "sense" });
  });

  it("moves homonym numbers and form markers of the headword to the note, spelling unchanged", () => {
    expect(cleanMboasawaHeadword("ndalala (2)")).toEqual({ headword: "ndalala", note: "homonyme n° 2" });
    expect(cleanMboasawaHeadword("ɓɔɓea -edi")).toEqual({ headword: "ɓɔɓea", note: "marque de forme : -edi" });
    expect(cleanMboasawaHeadword("ɓopánda / mi-ɓopánda")).toEqual({ headword: "ɓopánda", note: "autre forme (pluriel) : mi-ɓopánda" });
    expect(cleanMboasawaHeadword("kápɛkápɛ ná").headword).toBe("kápɛkápɛ ná");
  });

  it("cross-references and descriptions become definitions, never translations", () => {
    const pairs = mboasawaPairs({ headword: "itoto", translation: "voir : ituta" }, "https://x/");
    expect(pairs).toEqual([expect.objectContaining({ sourceText: "voir : ituta", category: "contextual_meaning" })]);
    expect(classifyGloss("qui sait nager", "muŋgę")).toBe("definition");
    expect(classifyGloss("qui", "ɓéna")).toBe("sense");
    expect(classifyGloss("salutation Dla", "njétúśę")).toBe("definition");
  });
});
