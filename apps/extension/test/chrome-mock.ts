import { vi } from "vitest";

type Listener = (message: unknown, sender: unknown, sendResponse: (r: unknown) => void) => boolean | void;

export interface ChromeMock {
  store: Record<string, unknown>;
  listeners: Set<Listener>;
  reset(): void;
  /** Deliver a runtime message to registered listeners (simulates content-script broadcasts). */
  emit(message: unknown): void;
}

export function installChromeMock(): ChromeMock {
  const store: Record<string, unknown> = {};
  const listeners = new Set<Listener>();
  const chromeStub = {
    runtime: {
      sendMessage: vi.fn(async () => undefined as unknown),
      onMessage: {
        addListener: (fn: Listener) => listeners.add(fn),
        removeListener: (fn: Listener) => listeners.delete(fn),
        hasListener: (fn: Listener) => listeners.has(fn),
      },
      onInstalled: { addListener: vi.fn() },
      openOptionsPage: vi.fn(async () => undefined),
      getManifest: () => ({ version: "0.1.0", name: "DOUALA AI" }),
      id: "test-extension",
      lastError: undefined,
    },
    storage: {
      local: {
        get: vi.fn(async (key?: string | string[] | null) => {
          if (!key) return { ...store };
          const keys = Array.isArray(key) ? key : [key];
          const out: Record<string, unknown> = {};
          for (const k of keys) if (k in store) out[k] = structuredClone(store[k]);
          return out;
        }),
        set: vi.fn(async (obj: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(obj)) store[k] = structuredClone(v);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
        }),
        clear: vi.fn(async () => {
          for (const k of Object.keys(store)) delete store[k];
        }),
      },
    },
    tabs: {
      query: vi.fn(async () => [{ id: 1, url: "https://example.com/page", active: true }]),
      sendMessage: vi.fn(async () => undefined as unknown),
    },
    scripting: { executeScript: vi.fn(async () => []) },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = chromeStub;
  return {
    store,
    listeners,
    reset() {
      for (const k of Object.keys(store)) delete store[k];
      listeners.clear();
      chromeStub.runtime.sendMessage.mockReset();
      chromeStub.runtime.sendMessage.mockImplementation(async () => undefined);
      chromeStub.tabs.sendMessage.mockReset();
      chromeStub.scripting.executeScript.mockReset();
    },
    emit(message) {
      for (const l of [...listeners]) l(message, {}, () => undefined);
    },
  };
}
