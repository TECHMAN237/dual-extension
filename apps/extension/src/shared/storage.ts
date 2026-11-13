import type { SourceLanguageSelection, TargetLanguageCode } from "@douala-ai/shared";
import type { CorrectionRecord } from "@douala-ai/shared";

/* ------------------------------------------------------------------------- */
/* Settings                                                                   */
/* ------------------------------------------------------------------------- */

export interface Settings {
  /** Backend base URL (no trailing slash). AI provider keys live on the backend only. */
  backendUrl: string;
  /** Optional client access token required by some backend deployments. Not an AI key. */
  accessToken: string;
  sourceLanguage: SourceLanguageSelection;
  targetLanguage: TargetLanguageCode;
  autoDetect: boolean;
  translateDynamicContent: boolean;
  correctionsEnabled: boolean;
  keepHistory: boolean;
  historyLimit: number;
}

/** Local development backend (`pnpm dev:backend`). */
export const LOCAL_BACKEND_URL = "http://localhost:8787";

/** Turn the build-time VITE_DEFAULT_BACKEND_URL into a usable URL, or null when absent/invalid. */
export function resolveBuildBackendUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return normalizeBackendUrl(value);
}

/**
 * Production backend baked in at build time from apps/extension/.env.production
 * (VITE_DEFAULT_BACKEND_URL). Null in development builds and tests.
 */
export const PRODUCTION_BACKEND_URL: string | null = resolveBuildBackendUrl(import.meta.env.VITE_DEFAULT_BACKEND_URL as string | undefined);

/** Backend used by a fresh install and by "Use the default server". */
export const DEFAULT_BACKEND_URL = PRODUCTION_BACKEND_URL ?? LOCAL_BACKEND_URL;
export const MAX_HISTORY = 50;

/**
 * Settings schema version. v1 builds always stored http://localhost:8787 (the only default),
 * so on upgrade that exact value is replaced by the production URL once. From v2 on, a
 * localhost URL in storage was chosen by the user and is kept.
 */
export const SETTINGS_VERSION = 2;

export const DEFAULT_SETTINGS: Settings = {
  backendUrl: DEFAULT_BACKEND_URL,
  accessToken: "",
  sourceLanguage: "auto",
  targetLanguage: "dua",
  autoDetect: true,
  translateDynamicContent: true,
  correctionsEnabled: true,
  keepHistory: true,
  historyLimit: MAX_HISTORY,
};

const KEYS = {
  settings: "settings",
  settingsVersion: "settingsVersion",
  clientId: "clientId",
  history: "history",
  corrections: "submittedCorrections",
} as const;

async function read<T>(key: string): Promise<T | undefined> {
  const result = await chrome.storage.local.get(key);
  return result[key] as T | undefined;
}

async function write(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export function normalizeBackendUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function validateSettings(partial: Partial<Settings>): string[] {
  const errors: string[] = [];
  if (partial.backendUrl !== undefined) {
    try {
      const u = new URL(partial.backendUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") errors.push("Backend URL must start with http:// or https://");
    } catch {
      errors.push("Backend URL is not a valid URL");
    }
  }
  if (partial.historyLimit !== undefined && (!Number.isInteger(partial.historyLimit) || partial.historyLimit < 1 || partial.historyLimit > MAX_HISTORY)) {
    errors.push(`History limit must be between 1 and ${MAX_HISTORY}`);
  }
  if (partial.accessToken !== undefined && partial.accessToken.length > 512) errors.push("Access token is too long");
  return errors;
}

/**
 * Pure migration step (exported for tests): settings saved by a v1 build with the old
 * localhost default move to the production backend. Returns null when nothing changes.
 */
export function migrateStoredSettings(stored: Partial<Settings>, storedVersion: number | undefined, productionUrl: string | null): Partial<Settings> | null {
  if ((storedVersion ?? 1) >= SETTINGS_VERSION || !productionUrl) return null;
  if (stored.backendUrl === undefined || normalizeBackendUrl(stored.backendUrl) !== LOCAL_BACKEND_URL) return null;
  return { ...stored, backendUrl: productionUrl };
}

export async function getSettings(): Promise<Settings> {
  let stored = (await read<Partial<Settings>>(KEYS.settings)) ?? {};
  const version = await read<number>(KEYS.settingsVersion);
  if ((version ?? 1) < SETTINGS_VERSION && PRODUCTION_BACKEND_URL) {
    // Only builds that know a production URL migrate (and mark storage as migrated).
    const migrated = migrateStoredSettings(stored, version, PRODUCTION_BACKEND_URL);
    if (migrated) {
      stored = migrated;
      await write(KEYS.settings, stored);
    }
    await write(KEYS.settingsVersion, SETTINGS_VERSION);
  }
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  merged.backendUrl = normalizeBackendUrl(merged.backendUrl || DEFAULT_BACKEND_URL);
  merged.historyLimit = Math.min(MAX_HISTORY, Math.max(1, merged.historyLimit || MAX_HISTORY));
  return merged;
}

export async function saveSettings(partial: Partial<Settings>): Promise<Settings> {
  const errors = validateSettings(partial);
  if (errors.length > 0) throw new Error(errors.join(". "));
  const current = await getSettings();
  const next: Settings = { ...current, ...partial };
  if (partial.backendUrl !== undefined) next.backendUrl = normalizeBackendUrl(partial.backendUrl);
  // The default server is not pinned in storage: it follows the build, so rebuilding with a
  // new VITE_DEFAULT_BACKEND_URL moves every install that uses the default. Only a custom URL is kept.
  const toStore: Partial<Settings> = { ...next };
  if (toStore.backendUrl === DEFAULT_BACKEND_URL) delete toStore.backendUrl;
  await write(KEYS.settings, toStore);
  // Whatever is stored from now on (including localhost) is the user's choice.
  await write(KEYS.settingsVersion, SETTINGS_VERSION);
  return next;
}

/** True when the URL points at this machine (no sleeping cloud server to wake up). */
export function isLocalBackend(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------------- */
/* Anonymous client id                                                        */
/* ------------------------------------------------------------------------- */

function uuid(): string {
  const c = globalThis.crypto as Crypto;
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Random, anonymous identifier generated once per browser profile. Never derived from personal data. */
export async function getClientId(): Promise<string> {
  const existing = await read<string>(KEYS.clientId);
  if (existing && existing.length >= 8) return existing;
  const id = uuid();
  await write(KEYS.clientId, id);
  return id;
}

/* ------------------------------------------------------------------------- */
/* History (no page content is ever stored)                                   */
/* ------------------------------------------------------------------------- */

export interface HistoryEntry {
  id: string;
  domain: string;
  sourceLanguage: string;
  targetLanguage: string;
  date: string;
  translatedCount: number;
  totalSegments: number;
  status: "completed" | "partial" | "failed";
}

export async function getHistory(): Promise<HistoryEntry[]> {
  return (await read<HistoryEntry[]>(KEYS.history)) ?? [];
}

export async function addHistoryEntry(entry: Omit<HistoryEntry, "id" | "date">): Promise<HistoryEntry[]> {
  const settings = await getSettings();
  if (!settings.keepHistory) return getHistory();
  const history = await getHistory();
  const next: HistoryEntry = { ...entry, id: uuid(), date: new Date().toISOString() };
  const limit = Math.min(MAX_HISTORY, settings.historyLimit);
  const updated = [next, ...history].slice(0, limit);
  await write(KEYS.history, updated);
  return updated;
}

export async function clearHistory(): Promise<void> {
  await write(KEYS.history, []);
}

/* ------------------------------------------------------------------------- */
/* Submitted corrections (ids + status only)                                  */
/* ------------------------------------------------------------------------- */

export interface SubmittedCorrection {
  id: string;
  domain: string | null;
  sourceText: string;
  proposedTranslation: string;
  status: CorrectionRecord["status"];
  createdAt: string;
  updatedAt: string;
}

export async function getSubmittedCorrections(): Promise<SubmittedCorrection[]> {
  return (await read<SubmittedCorrection[]>(KEYS.corrections)) ?? [];
}

export async function addSubmittedCorrection(record: CorrectionRecord): Promise<SubmittedCorrection[]> {
  const list = await getSubmittedCorrections();
  const entry: SubmittedCorrection = {
    id: record.id,
    domain: record.domain,
    sourceText: record.sourceText,
    proposedTranslation: record.proposedTranslation,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
  const updated = [entry, ...list.filter((c) => c.id !== record.id)].slice(0, 200);
  await write(KEYS.corrections, updated);
  return updated;
}

export async function updateSubmittedCorrections(records: CorrectionRecord[]): Promise<SubmittedCorrection[]> {
  const list = await getSubmittedCorrections();
  const byId = new Map(records.map((r) => [r.id, r]));
  const updated = list.map((c) => {
    const r = byId.get(c.id);
    return r ? { ...c, status: r.status, updatedAt: r.updatedAt } : c;
  });
  await write(KEYS.corrections, updated);
  return updated;
}

export async function clearAllLocalData(): Promise<void> {
  await chrome.storage.local.remove([KEYS.settings, KEYS.settingsVersion, KEYS.history, KEYS.corrections, KEYS.clientId]);
}
