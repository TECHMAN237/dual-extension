import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/popup/App";
import type { SessionSnapshot } from "../src/shared/messages";
import { chromeMock } from "./setup";

function snapshot(partial: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    status: "idle",
    domain: "example.com",
    url: "https://example.com/",
    htmlLang: "en",
    sourceLanguage: "auto",
    resolvedSourceLanguage: null,
    targetLanguage: "dua",
    detectedLanguage: null,
    detectionConfidence: null,
    totalSegments: 0,
    requestedCount: 0,
    translatedCount: 0,
    uncertainCount: 0,
    skippedCount: 0,
    errorCount: 0,
    completedCount: 0,
    evidence: { high: 0, moderate: 0, low: 0, unverified: 0 },
    wordsFound: 0,
    wordsTotal: 0,
    mock: false,
    provider: null,
    model: null,
    navigated: false,
    errorMessage: null,
    updatedAt: Date.now(),
    ...partial,
  };
}

function mockBackground(state: { session: SessionSnapshot; translations?: unknown[] }) {
  const sendMessage = chrome.runtime.sendMessage as unknown as ReturnType<typeof vi.fn>;
  sendMessage.mockImplementation(async (message: { type: string; sourceLanguage?: string }) => {
    switch (message.type) {
      case "GET_STATE":
        return { ok: true, data: state.session };
      case "SCAN":
        state.session = snapshot({ status: "scanned", detectedLanguage: "en", detectionConfidence: "high", totalSegments: 12 });
        return { ok: true, data: { domain: "example.com", totalSegments: 12 } };
      case "TRANSLATE":
        state.session = snapshot({ status: "translated", detectedLanguage: "en", detectionConfidence: "high", totalSegments: 12, requestedCount: 12, completedCount: 12, translatedCount: 10, uncertainCount: 2, evidence: { high: 3, moderate: 2, low: 1, unverified: 4 }, mock: true });
        return { ok: true, data: state.session };
      case "RESTORE":
        state.session = snapshot();
        return { ok: true, data: state.session };
      case "LIST_TRANSLATIONS":
        return { ok: true, data: state.translations ?? [] };
      default:
        return { ok: true, data: null };
    }
  });
  return sendMessage;
}

function mockFetchHealth(mock = false) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ status: "ok", version: "0.1.0", provider: mock ? "mock" : "anthropic", model: mock ? null : "claude-opus-5-5", mock, storage: "memory", knowledgeEntries: 48, uptimeSeconds: 10 }), { status: 200, headers: { "Content-Type": "application/json" } })),
  );
}

describe("popup", () => {
  it("renders the brand, connection status and website card", async () => {
    mockFetchHealth();
    mockBackground({ session: snapshot({ detectedLanguage: "fr", detectionConfidence: "medium" }) });
    render(<App />);
    expect(screen.getByText(/douala ai/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("connection-status")).toHaveTextContent("Connected"));
    expect(screen.getByText("example.com")).toBeInTheDocument();
    expect(screen.getByTestId("detected-language")).toHaveTextContent("French");
  });

  it("changes the stored source language from the select", async () => {
    mockFetchHealth();
    mockBackground({ session: snapshot() });
    render(<App />);
    const select = (await screen.findByLabelText("From")) as HTMLSelectElement;
    await userEvent.selectOptions(select, "fr");
    await waitFor(() => expect((chromeMock.store.settings as { sourceLanguage: string }).sourceLanguage).toBe("fr"));
    expect(select.value).toBe("fr");
  });

  it("scans, translates and restores through the background, showing counts, evidence and the mock banner", async () => {
    mockFetchHealth(true);
    const state = { session: snapshot() };
    const sendMessage = mockBackground(state);
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("connection-status")).toHaveTextContent("Mock mode"));

    const translate = screen.getByTestId("translate-button");
    const restore = screen.getByTestId("restore-button");
    expect(translate).toBeDisabled();
    expect(restore).toBeDisabled();

    await userEvent.click(screen.getByTestId("scan-button"));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: "SCAN" }));
    await waitFor(() => expect(screen.getByTestId("segment-count")).toHaveTextContent("12"));
    expect(screen.getByTestId("detected-language")).toHaveTextContent("English");
    await waitFor(() => expect(translate).toBeEnabled());

    await userEvent.click(translate);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: "TRANSLATE", sourceLanguage: "auto" }));
    await waitFor(() => expect(screen.getByTestId("progress-panel")).toHaveTextContent("Translation complete"));
    expect(screen.getByTestId("progress-panel")).toHaveTextContent("10");
    expect(screen.getByText("2 kept original")).toBeInTheDocument();
    expect(screen.getByText("3 high")).toBeInTheDocument();
    expect(screen.getByText("4 unverified")).toBeInTheDocument();
    expect(screen.getByText(/Mock mode\./)).toBeInTheDocument();
    expect(restore).toBeEnabled();

    await userEvent.click(restore);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: "RESTORE" }));
    await waitFor(() => expect(restore).toBeDisabled());
  });

  it("updates live from PROGRESS broadcasts and shows unsupported pages gracefully", async () => {
    mockFetchHealth();
    const sendMessage = chrome.runtime.sendMessage as unknown as ReturnType<typeof vi.fn>;
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === "GET_STATE") return { ok: false, error: "This page cannot be translated (browser or extension page).", code: "unsupported_page" };
      return { ok: true, data: null };
    });
    render(<App />);
    await screen.findByText(/cannot be translated/);
    expect(screen.getByTestId("scan-button")).toBeDisabled();
  });

  it("shows the detected language in the 'From' selector after a scan (and keeps it in the Website card)", async () => {
    mockFetchHealth();
    const state = { session: snapshot() };
    mockBackground(state);
    render(<App />);
    const option = await screen.findByTestId("auto-detect-option");
    // Before any scan: plain label.
    await screen.findByText("example.com");
    expect(option).toHaveTextContent(/^Auto detect$/);

    // Scan detects English.
    await userEvent.click(screen.getByTestId("scan-button"));
    await waitFor(() => expect(screen.getByTestId("auto-detect-option")).toHaveTextContent("Auto detect · English"));
    expect(screen.getByTestId("detected-language")).toHaveTextContent("English");
    expect((screen.getByLabelText("From") as HTMLSelectElement).value).toBe("auto");

    // A French page.
    chromeMock.emit({ type: "PROGRESS", state: snapshot({ status: "scanned", detectedLanguage: "fr", detectionConfidence: "high", totalSegments: 8 }) });
    await waitFor(() => expect(screen.getByTestId("auto-detect-option")).toHaveTextContent("Auto detect · French"));
    expect(screen.getByTestId("detected-language")).toHaveTextContent("French");

    // Scanned, but the language could not be detected.
    chromeMock.emit({ type: "PROGRESS", state: snapshot({ status: "scanned", detectedLanguage: null, totalSegments: 3 }) });
    await waitFor(() => expect(screen.getByTestId("auto-detect-option")).toHaveTextContent("Auto detect · inconnue"));
  });

  it("shows 'Réveil du serveur…' instead of Offline while a cloud server wakes up", async () => {
    chromeMock.store.settings = { backendUrl: "https://douala-ai-backend.onrender.com" };
    chromeMock.store.settingsVersion = 2;
    const okBody = JSON.stringify({ status: "ok", version: "0.1.0", provider: "openrouter", model: "google/gemma-4-31b-it:free", mock: false, storage: "supabase", knowledgeEntries: 48, uptimeSeconds: 1 });
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue(new Response(okBody, { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    mockBackground({ session: snapshot() });
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("connection-status")).toHaveTextContent("Réveil du serveur…"));
    expect(screen.getByTestId("connection-status")).not.toHaveTextContent("Offline");
    await waitFor(() => expect(screen.getByTestId("connection-status")).toHaveTextContent("Connected"), { timeout: 6000 });
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://douala-ai-backend.onrender.com/api/health");
  }, 10_000);

  it("explains a slow first translation while the server wakes up", async () => {
    chromeMock.store.settings = { backendUrl: "https://douala-ai-backend.onrender.com" };
    chromeMock.store.settingsVersion = 2;
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined))); // health never answers yet
    const state = { session: snapshot() };
    const sendMessage = mockBackground(state);
    let finishTranslate!: () => void;
    const base = sendMessage.getMockImplementation() as (message: { type: string }) => Promise<unknown>;
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type !== "TRANSLATE") return base(message);
      await new Promise<void>((r) => (finishTranslate = r));
      return base(message);
    });
    render(<App />);
    await userEvent.click(await screen.findByTestId("scan-button"));
    await waitFor(() => expect(screen.getByTestId("translate-button")).toBeEnabled());
    await userEvent.click(screen.getByTestId("translate-button"));
    expect(screen.queryByTestId("wake-notice")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("wake-notice")).toHaveTextContent("Réveil du serveur, la première traduction peut prendre une minute"), { timeout: 6000 });
    finishTranslate();
    await waitFor(() => expect(screen.getByTestId("progress-panel")).toHaveTextContent("Translation complete"));
    expect(screen.queryByTestId("wake-notice")).toBeNull();
  }, 12_000);

  it("shows the share of words found in the dictionary after a translation", async () => {
    mockFetchHealth();
    mockBackground({ session: snapshot({ status: "translated", totalSegments: 4, requestedCount: 4, completedCount: 4, translatedCount: 3, wordsFound: 30, wordsTotal: 40 }) });
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("dictionary-coverage")).toHaveTextContent("Mots trouvés dans le dictionnaire : 75 %"));
    expect(screen.getByTestId("dictionary-coverage")).toHaveTextContent("30/40");
  });

  it("shows the word-by-word detail of each segment in the Corrections tab", async () => {
    mockFetchHealth();
    const gloss = (source: string, duala: string | null, kind: "found" | "not_found" | "function_word") => ({ source, lemma: kind === "found" ? source.toLowerCase().replace("consultez", "consulter") : null, duala, entryId: duala ? "e1" : null, status: duala ? "pending" : null, sourceName: duala ? "Mboa Sawa" : null, reference: duala ? "https://example.org/w" : null, kind });
    mockBackground({
      session: snapshot({ status: "translated", totalSegments: 1, requestedCount: 1, completedCount: 1, translatedCount: 1, wordsFound: 1, wordsTotal: 2 }),
      translations: [
        { id: "s1", sourceText: "Consultez votre solde", translatedText: "D-consulte solde", status: "translated", evidence: "low", needsReview: true, references: [], note: null, context: "button", coverage: { found: 1, total: 2 }, notFound: ["solde"], glosses: [gloss("Consultez", "D-consulte", "found"), gloss("votre", null, "function_word"), gloss("solde", null, "not_found")] },
      ],
    });
    render(<App />);
    await userEvent.click(await screen.findByRole("tab", { name: "Corrections" }));
    const detail = await screen.findByTestId("word-glosses");
    expect(detail).toHaveTextContent("Mot à mot · 1/2 trouvés");
    expect(detail).toHaveTextContent("Consultez → D-consulte");
    expect(detail).toHaveTextContent("forme : consulter");
    expect(detail).toHaveTextContent("solde → non trouvé");
    expect(detail).not.toHaveTextContent("votre");
  });

  it("applies PROGRESS messages from the content script", async () => {
    mockFetchHealth();
    mockBackground({ session: snapshot() });
    render(<App />);
    await screen.findByText("example.com");
    chromeMock.emit({ type: "PROGRESS", state: snapshot({ status: "translating", totalSegments: 20, requestedCount: 20, completedCount: 5, translatedCount: 5 }) });
    await waitFor(() => expect(screen.getByTestId("progress-panel")).toHaveTextContent("Translating"));
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
  });
});
