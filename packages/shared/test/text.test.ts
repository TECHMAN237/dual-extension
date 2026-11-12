import { describe, expect, it } from "vitest";
import { detectSourceLanguage, isUntranslatableText, normalizeForLookup, translateBatchRequestSchema } from "../src";

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
  });
});

describe("normalizeForLookup", () => {
  it("lower-cases, strips accents and punctuation", () => {
    expect(normalizeForLookup("  Bienvenue, à  TOUS ! ")).toBe("bienvenue a tous");
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
