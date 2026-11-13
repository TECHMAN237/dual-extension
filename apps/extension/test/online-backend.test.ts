import { afterEach, describe, expect, it, vi } from "vitest";
import type { HealthResponse } from "@douala-ai/shared";
import { ApiError, healthWithWakeUp } from "../src/shared/api";
import { PageSession, type SessionBackend } from "../src/content/session";
import { LOCAL_BACKEND_URL, isLocalBackend, migrateStoredSettings, resolveBuildBackendUrl } from "../src/shared/storage";
import { chromeMock } from "./setup";

const PROD = "https://douala-ai-backend.onrender.com";
const health: HealthResponse = { status: "ok", version: "0.1.0", provider: "openrouter", model: "google/gemma-4-31b-it:free", mock: false, storage: "supabase", knowledgeEntries: 48, uptimeSeconds: 1 } as HealthResponse;

describe("scan never waits for the server", () => {
  function backend(scanAnalyze: SessionBackend["scanAnalyze"]): SessionBackend {
    return { translateBatch: vi.fn(), scanAnalyze: vi.fn(scanAnalyze), sessionComplete: vi.fn(async () => undefined) } as unknown as SessionBackend;
  }

  it("answers with the local detection while the server is still asleep", async () => {
    document.documentElement.setAttribute("lang", "fr");
    document.body.innerHTML = `<h1>Bienvenue sur notre site</h1><p>Lisez les dernières nouvelles de la région aujourd'hui.</p><button>Se connecter</button>`;
    const b = backend(() => new Promise(() => undefined)); // never answers
    const session = new PageSession({ backend: b, onProgress: () => undefined });
    const result = await session.scan(); // resolves although scanAnalyze is still pending
    expect(result.detectedLanguage).toBe("fr");
    expect(result.totalSegments).toBeGreaterThanOrEqual(3);
    expect(session.getSnapshot().status).toBe("scanned");
    expect(b.scanAnalyze).toHaveBeenCalledTimes(1); // still sent: it wakes the server up
  });

  it("applies a later server answer through a progress update", async () => {
    document.documentElement.removeAttribute("lang");
    document.body.innerHTML = `<h1>Welcome</h1>`;
    let answer!: (v: Awaited<ReturnType<SessionBackend["scanAnalyze"]>>) => void;
    const onProgress = vi.fn();
    const session = new PageSession({ backend: backend(() => new Promise((r) => (answer = r))), onProgress });
    await session.scan();
    const before = onProgress.mock.calls.length;
    answer({ detectedLanguage: "en", confidence: "high" });
    await session.whenAnalysisSettled();
    expect(session.getSnapshot()).toMatchObject({ detectedLanguage: "en", detectionConfidence: "high" });
    expect(onProgress.mock.calls.length).toBe(before + 1);
  });

  it("keeps the local detection when the server fails", async () => {
    document.documentElement.setAttribute("lang", "fr");
    document.body.innerHTML = `<h1>Bienvenue sur notre site</h1><p>Lisez les dernières nouvelles de la région.</p>`;
    const session = new PageSession({ backend: backend(async () => Promise.reject(new Error("asleep"))), onProgress: () => undefined });
    await session.scan();
    await session.whenAnalysisSettled();
    expect(session.getSnapshot().detectedLanguage).toBe("fr");
  });
});

describe("healthWithWakeUp", () => {
  const noSleep = async () => undefined;

  it("reports 'waking' and retries network errors / 503 until the server answers", async () => {
    const calls: number[] = [];
    const errors = [new ApiError("Cannot reach the backend", 0, "network"), new ApiError("Backend error 503", 503, "http_503")];
    const client = {
      health: vi.fn(async (timeoutMs?: number) => {
        calls.push(timeoutMs ?? 0);
        const e = errors.shift();
        if (e) throw e;
        return health;
      }),
    };
    const onWaking = vi.fn();
    await expect(healthWithWakeUp(client, { onWaking, sleep: noSleep })).resolves.toEqual(health);
    expect(client.health).toHaveBeenCalledTimes(3);
    expect(onWaking).toHaveBeenCalledTimes(1);
    // Each attempt may wait for the rest of the 60 s budget (Render holds requests while booting).
    expect(calls[0]).toBeGreaterThan(55_000);
  });

  it("shows 'waking' when the first answer is slow, without failing", async () => {
    vi.useFakeTimers();
    try {
      let resolve!: (h: HealthResponse) => void;
      const client = { health: vi.fn(() => new Promise<HealthResponse>((r) => (resolve = r))) };
      const onWaking = vi.fn();
      const pending = healthWithWakeUp(client, { onWaking, wakingAfterMs: 3_000 });
      await vi.advanceTimersByTimeAsync(2_999);
      expect(onWaking).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2);
      expect(onWaking).toHaveBeenCalledTimes(1);
      resolve(health);
      await expect(pending).resolves.toEqual(health);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up after the time budget and does not retry auth errors", async () => {
    let t = 0;
    const down = { health: vi.fn(async () => Promise.reject(new ApiError("Cannot reach the backend", 0, "network"))) };
    await expect(healthWithWakeUp(down, { totalMs: 60_000, retryDelayMs: 3_000, now: () => t, sleep: async (ms) => void (t += ms) })).rejects.toThrow(/Cannot reach/);
    expect(t).toBeLessThanOrEqual(60_000);
    expect(down.health.mock.calls.length).toBeGreaterThan(5);

    const unauthorized = { health: vi.fn(async () => Promise.reject(new ApiError("unauthorized", 401, "unauthorized"))) };
    await expect(healthWithWakeUp(unauthorized, { sleep: noSleep })).rejects.toThrow("unauthorized");
    expect(unauthorized.health).toHaveBeenCalledTimes(1);
  });
});

describe("default backend URL", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("reads VITE_DEFAULT_BACKEND_URL and falls back to localhost", () => {
    expect(resolveBuildBackendUrl(`${PROD}/`)).toBe(PROD);
    expect(resolveBuildBackendUrl(undefined)).toBeNull();
    expect(resolveBuildBackendUrl("  ")).toBeNull();
    expect(resolveBuildBackendUrl("not a url")).toBeNull();
    expect(resolveBuildBackendUrl("ftp://x.example")).toBeNull();
    expect(isLocalBackend(LOCAL_BACKEND_URL)).toBe(true);
    expect(isLocalBackend("http://127.0.0.1:8787")).toBe(true);
    expect(isLocalBackend(PROD)).toBe(false);
  });

  it("migrates only the old localhost default, only once, and only when the build knows a production URL", () => {
    expect(migrateStoredSettings({ backendUrl: "http://localhost:8787" }, undefined, PROD)).toEqual({ backendUrl: PROD });
    expect(migrateStoredSettings({ backendUrl: "http://localhost:8787/" }, 1, PROD)).toEqual({ backendUrl: PROD });
    expect(migrateStoredSettings({ backendUrl: "http://localhost:3000" }, undefined, PROD)).toBeNull();
    expect(migrateStoredSettings({ backendUrl: "https://my-own-server.example" }, undefined, PROD)).toBeNull();
    expect(migrateStoredSettings({ backendUrl: "http://localhost:8787" }, 2, PROD)).toBeNull();
    expect(migrateStoredSettings({ backendUrl: "http://localhost:8787" }, undefined, null)).toBeNull();
  });

  it("uses the production URL for new installs and for settings saved by older versions", async () => {
    vi.stubEnv("VITE_DEFAULT_BACKEND_URL", PROD);
    vi.resetModules();
    const storage = await import("../src/shared/storage");
    expect(storage.DEFAULT_BACKEND_URL).toBe(PROD);
    expect((await storage.getSettings()).backendUrl).toBe(PROD);

    chromeMock.store.settings = { backendUrl: "http://localhost:8787", sourceLanguage: "fr" };
    delete chromeMock.store.settingsVersion;
    const migrated = await storage.getSettings();
    expect(migrated.backendUrl).toBe(PROD);
    expect(migrated.sourceLanguage).toBe("fr");
    expect((chromeMock.store.settings as { backendUrl: string }).backendUrl).toBe(PROD);
  });

  it("keeps a URL the user chose by hand, including localhost chosen after the upgrade", async () => {
    vi.stubEnv("VITE_DEFAULT_BACKEND_URL", PROD);
    vi.resetModules();
    const storage = await import("../src/shared/storage");

    chromeMock.store.settings = { backendUrl: "https://my-own-server.example" };
    delete chromeMock.store.settingsVersion;
    expect((await storage.getSettings()).backendUrl).toBe("https://my-own-server.example");

    await storage.saveSettings({ backendUrl: "http://localhost:8787" });
    expect((await storage.getSettings()).backendUrl).toBe("http://localhost:8787");
  });

  it("does not pin the default server, so a rebuild with a new URL moves installs that use it", async () => {
    vi.stubEnv("VITE_DEFAULT_BACKEND_URL", PROD);
    vi.resetModules();
    const v1 = await import("../src/shared/storage");
    await v1.saveSettings({ sourceLanguage: "fr" }); // e.g. changing the language in the popup
    expect(chromeMock.store.settings).not.toHaveProperty("backendUrl");
    await v1.saveSettings({ backendUrl: PROD }); // "Utiliser le serveur par défaut"
    expect(chromeMock.store.settings).not.toHaveProperty("backendUrl");

    vi.stubEnv("VITE_DEFAULT_BACKEND_URL", "https://douala-ai-backend-x1y2.onrender.com");
    vi.resetModules();
    const v2 = await import("../src/shared/storage");
    const s = await v2.getSettings();
    expect(s.backendUrl).toBe("https://douala-ai-backend-x1y2.onrender.com");
    expect(s.sourceLanguage).toBe("fr");
  });

  it("keeps localhost when the build has no production URL", async () => {
    vi.resetModules();
    const storage = await import("../src/shared/storage");
    expect(storage.PRODUCTION_BACKEND_URL).toBeNull();
    chromeMock.store.settings = { backendUrl: "http://localhost:8787" };
    expect((await storage.getSettings()).backendUrl).toBe("http://localhost:8787");
  });
});
