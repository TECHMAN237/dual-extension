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
    mock: false,
    provider: null,
    model: null,
    navigated: false,
    errorMessage: null,
    updatedAt: Date.now(),
    ...partial,
  };
}

function mockBackground(state: { session: SessionSnapshot }) {
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
        return { ok: true, data: [] };
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
