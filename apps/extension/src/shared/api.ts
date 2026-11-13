import type {
  CorrectionRecord,
  CorrectionSubmission,
  HealthResponse,
  LanguageDefinition,
  ScanAnalyzeRequest,
  ScanAnalyzeResponse,
  TranslateBatchRequest,
  TranslateBatchResponse,
} from "@douala-ai/shared";
import { getClientId, getSettings } from "./storage";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ClientOptions {
  backendUrl: string;
  accessToken?: string;
  clientId: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Backend HTTP client. Runs in the popup, options page and background worker
 * (extension origin). It never holds AI provider credentials.
 */
export class BackendClient {
  constructor(private readonly opts: ClientOptions) {}

  get baseUrl(): string {
    return this.opts.backendUrl.replace(/\/+$/, "");
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown, timeoutMs?: number): Promise<T> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs ?? this.opts.timeoutMs ?? 60_000);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Douala-Client-Id": this.opts.clientId,
    };
    if (this.opts.accessToken) headers["X-Douala-Client-Token"] = this.opts.accessToken;
    let res: Response;
    try {
      res = await fetchImpl(`${this.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal });
    } catch (err) {
      if ((err as Error).name === "AbortError") throw new ApiError("The backend did not respond in time.", 0, "timeout");
      throw new ApiError(`Cannot reach the backend at ${this.baseUrl}. Is it running?`, 0, "network");
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const envelope = json as { error?: { code?: string; message?: string } } | null;
      throw new ApiError(envelope?.error?.message ?? `Backend error ${res.status}`, res.status, envelope?.error?.code ?? `http_${res.status}`);
    }
    return json as T;
  }

  health(timeoutMs = 8_000): Promise<HealthResponse> {
    return this.request<HealthResponse>("GET", "/api/health", undefined, timeoutMs);
  }

  languages(): Promise<{ languages: LanguageDefinition[] }> {
    return this.request("GET", "/api/languages", undefined, 8_000);
  }

  scanAnalyze(body: ScanAnalyzeRequest): Promise<ScanAnalyzeResponse> {
    return this.request("POST", "/api/scan/analyze", body, 10_000);
  }

  translateBatch(body: TranslateBatchRequest): Promise<TranslateBatchResponse> {
    return this.request("POST", "/api/translate/batch", body, 120_000);
  }

  submitCorrection(body: CorrectionSubmission): Promise<CorrectionRecord> {
    return this.request("POST", "/api/corrections", body, 15_000);
  }

  correctionStatus(ids: string[]): Promise<{ corrections: CorrectionRecord[] }> {
    const query = encodeURIComponent(ids.join(","));
    return this.request("GET", `/api/corrections/status?ids=${query}`, undefined, 15_000);
  }
}

export interface WakeUpOptions {
  /** Total time allowed for the server to wake up (Render free plan: ~30–60 s). */
  totalMs?: number;
  /** Call `onWaking` when the first answer takes longer than this. */
  wakingAfterMs?: number;
  /** Pause between attempts after a network error or a 5xx. */
  retryDelayMs?: number;
  /** Called once, as soon as the server looks asleep. */
  onWaking?: () => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Errors that can happen while a sleeping host starts: no answer, connection refused, 502/503/504. */
function isWakeUpError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true;
  return err.status === 0 || err.status === 408 || err.status === 429 || err.status >= 500;
}

/**
 * Health check that tolerates a sleeping free-tier server: keeps trying for up to
 * `totalMs` and reports "waking" instead of failing straight away.
 * Auth/config errors (4xx) fail immediately.
 */
export async function healthWithWakeUp(client: Pick<BackendClient, "health">, opts: WakeUpOptions = {}): Promise<HealthResponse> {
  const totalMs = opts.totalMs ?? 60_000;
  const retryDelayMs = opts.retryDelayMs ?? 3_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const deadline = now() + totalMs;
  let waking = false;
  const markWaking = () => {
    if (!waking) {
      waking = true;
      opts.onWaking?.();
    }
  };
  const wakingTimer = setTimeout(markWaking, opts.wakingAfterMs ?? 3_000);
  try {
    for (;;) {
      const remaining = deadline - now();
      try {
        return await client.health(Math.max(1_000, remaining));
      } catch (err) {
        if (!isWakeUpError(err) || deadline - now() <= retryDelayMs) throw err;
        markWaking();
        await sleep(retryDelayMs);
      }
    }
  } finally {
    clearTimeout(wakingTimer);
  }
}

/** Build a client from stored settings. */
export async function createClient(fetchImpl?: typeof fetch): Promise<BackendClient> {
  const [settings, clientId] = await Promise.all([getSettings(), getClientId()]);
  return new BackendClient({ backendUrl: settings.backendUrl, accessToken: settings.accessToken, clientId, fetchImpl });
}
