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

  health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("GET", "/api/health", undefined, 8_000);
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

/** Build a client from stored settings. */
export async function createClient(fetchImpl?: typeof fetch): Promise<BackendClient> {
  const [settings, clientId] = await Promise.all([getSettings(), getClientId()]);
  return new BackendClient({ backendUrl: settings.backendUrl, accessToken: settings.accessToken, clientId, fetchImpl });
}
