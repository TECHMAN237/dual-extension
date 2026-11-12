/** Provider-agnostic completion request. */
export interface CompletionRequest {
  model: string;
  system: string;
  user: string;
  /** JSON schema the provider should enforce when supported. */
  jsonSchema?: Record<string, unknown>;
  maxTokens: number;
  timeoutMs: number;
  effort?: "low" | "medium" | "high";
}

export interface CompletionResponse {
  text: string;
  model: string;
  stopReason: string | null;
  usage?: { inputTokens: number; outputTokens: number };
  /** True when the provider refused (safety) rather than failing. */
  refused?: boolean;
}

export interface LlmProvider {
  readonly name: string;
  complete(req: CompletionRequest): Promise<CompletionResponse>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly options: { retryable: boolean; status?: number; provider: string; cause?: unknown },
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigError";
  }
}
