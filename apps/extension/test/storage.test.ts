import { describe, expect, it } from "vitest";
import { addHistoryEntry, getClientId, getHistory, getSettings, saveSettings } from "../src/shared/storage";

describe("storage", () => {
  it("generates the anonymous client id once", async () => {
    const a = await getClientId();
    const b = await getClientId();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(8);
  });

  it("caps history at 50 entries and stores no page text", async () => {
    for (let i = 0; i < 60; i++) {
      await addHistoryEntry({ domain: `site${i}.example`, sourceLanguage: "en", targetLanguage: "dua", translatedCount: i, totalSegments: i + 1, status: "completed" });
    }
    const history = await getHistory();
    expect(history).toHaveLength(50);
    expect(history[0]!.domain).toBe("site59.example");
    for (const h of history) {
      expect(Object.keys(h).sort()).toEqual(["date", "domain", "id", "sourceLanguage", "status", "targetLanguage", "totalSegments", "translatedCount"]);
    }
  });

  it("validates and normalises settings", async () => {
    await expect(saveSettings({ backendUrl: "not a url" })).rejects.toThrow(/valid URL/);
    const s = await saveSettings({ backendUrl: "https://api.example.org/", sourceLanguage: "fr" });
    expect(s.backendUrl).toBe("https://api.example.org");
    expect((await getSettings()).sourceLanguage).toBe("fr");
  });
});
