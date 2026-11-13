import { describe, expect, it } from "vitest";
import { contentTokens, detectSourceLanguage, dictionaryKey, isUntranslatableText, normalizeForLookup, tokenize, translateBatchRequestSchema } from "../src";

describe("isUntranslatableText", () => {
  it("skips URLs, emails, numbers and identifiers", () => {
    expect(isUntranslatableText("https://example.com/path")).toBe(true);
    expect(isUntranslatableText("someone@example.com")).toBe(true);
    expect(isUntranslatableText("12,345.00 €")).toBe(true);
    expect(isUntranslatableText("user_id")).toBe(true);
    expect(isUntranslatableText("v1.2.3")).toBe(true);
    expect(isUntranslatableText("   ")).toBe(true);
  });
  it("keeps ordinary interface text", () => {
    expect(isUntranslatableText("Sign in")).toBe(false);
    expect(isUntranslatableText("Welcome to our website")).toBe(false);
    expect(isUntranslatableText("Rechercher")).toBe(false);
    // A sentence-final period does not turn a word into an identifier.
    expect(isUntranslatableText("Payer.")).toBe(false);
    expect(isUntranslatableText("file.txt")).toBe(true);
  });
});

describe("normalizeForLookup", () => {
  it("lower-cases, strips accents and punctuation", () => {
    expect(normalizeForLookup("  Bienvenue, à  TOUS ! ")).toBe("bienvenue a tous");
  });
});

describe("tokenize / contentTokens / dictionaryKey", () => {
  it("splits elisions and drops function words", () => {
    expect(tokenize("l'huilerie")).toEqual(["l", "huilerie"]);
    expect(contentTokens("Consulter les frais")).toEqual(["consulter", "frais"]);
    expect(contentTokens("Votre compte")).toEqual(["compte"]);
    expect(contentTokens("le compte-rendu")).toEqual(["compte", "rendu"]);
    expect(contentTokens("Sign in to your account")).toEqual(["sign", "account"]);
  });
  it("normalises case, accents, final punctuation, leading articles and simple plurals", () => {
    expect(dictionaryKey("Payer.")).toBe(dictionaryKey("payer"));
    expect(dictionaryKey("Bénéficiaire !")).toBe("beneficiaire");
    expect(dictionaryKey("le solde")).toBe(dictionaryKey("Solde"));
    expect(dictionaryKey("l'huilerie")).toBe("huilerie");
    expect(dictionaryKey("Transferts")).toBe(dictionaryKey("un transfert"));
    expect(dictionaryKey("les frais")).toBe(dictionaryKey("Frais"));
    expect(dictionaryKey("to buy")).toBe("buy");
    expect(dictionaryKey("Compte courant")).not.toBe(dictionaryKey("le compte-rendu"));
    expect(dictionaryKey("bus")).toBe("bus");
    // Short words ending in -s are not reduced: "pays" (country) must not become "pay".
    expect(dictionaryKey("pays")).toBe("pays");
    expect(dictionaryKey("Pay")).not.toBe(dictionaryKey("pays"));
  });
});

describe("detectSourceLanguage", () => {
  it("detects English", () => {
    const r = detectSourceLanguage("Sign in to your account to view all of the new features we have for you");
    expect(r.language).toBe("en");
  });
  it("detects French", () => {
    const r = detectSourceLanguage("Connectez-vous à votre compte pour voir toutes les nouveautés que nous avons pour vous");
    expect(r.language).toBe("fr");
  });
  it("uses the html lang hint when text is ambiguous", () => {
    expect(detectSourceLanguage("Menu", "fr-FR").language).toBe("fr");
  });
});

describe("translateBatchRequestSchema", () => {
  it("rejects duplicate ids", () => {
    const r = translateBatchRequestSchema.safeParse({
      items: [
        { id: "a", text: "Hello" },
        { id: "a", text: "World" },
      ],
    });
    expect(r.success).toBe(false);
  });
  it("applies defaults", () => {
    const r = translateBatchRequestSchema.parse({ items: [{ id: "a", text: "Hello" }] });
    expect(r.sourceLanguage).toBe("auto");
    expect(r.targetLanguage).toBe("dua");
    expect(r.items[0]?.context).toBe("other");
  });
});
