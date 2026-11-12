import Anthropic from "@anthropic-ai/sdk";
import { ProviderConfigError, ProviderError, type CompletionRequest, type CompletionResponse, type LlmProvider } from "./types";

export interface AnthropicProviderOptions {
  apiKey: string | undefined;
  baseUrl?: string;
  maxRetries?: number;
  /** Server-side refusal fallback (beta). Routes declined requests to a default fallback model. */
  serverFallback?: boolean;
}

/**
 * Anthropic adapter using the official SDK.
 * Structured JSON is requested through `output_config.format` (JSON schema),
 * and the engine still validates the output with Zod before use.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  private serverFallback: boolean;

  constructor(opts: AnthropicProviderOptions) {
    if (!opts.apiKey) throw new ProviderConfigError("AI_API_KEY is required for the anthropic provider");
    this.client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseUrl, maxRetries: opts.maxRetries ?? 0 });
    this.serverFallback = opts.serverFallback ?? true;
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    try {
      const params = {
        model: req.model,
        max_tokens: req.maxTokens,
        system: [{ type: "text" as const, text: req.system, cache_control: { type: "ephemeral" as const } }],
        messages: [{ role: "user" as const, content: req.user }],
        output_config: {
          ...(req.effort ? { effort: req.effort } : {}),
          ...(req.jsonSchema ? { format: { type: "json_schema" as const, schema: req.jsonSchema } } : {}),
        },
      };
      const response = this.serverFallback
        ? await this.client.beta.messages.create(
            { ...params, stream: false, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" },
            { timeout: req.timeoutMs },
          )
        : await this.client.messages.create({ ...params, stream: false }, { timeout: req.timeoutMs });

      const text = response.content
        .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("");
      const refused = response.stop_reason === "refusal";
      return {
        text,
        model: response.model,
        stopReason: response.stop_reason,
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
        refused,
      };
    } catch (err) {
      throw toProviderError(err);
    }
  }
}

function toProviderError(err: unknown): ProviderError {
  if (err instanceof Anthropic.RateLimitError) return new ProviderError("Anthropic rate limit exceeded", { retryable: true, status: 429, provider: "anthropic", cause: err });
  if (err instanceof Anthropic.AuthenticationError) return new ProviderError("Anthropic authentication failed: check AI_API_KEY", { retryable: false, status: 401, provider: "anthropic", cause: err });
  if (err instanceof Anthropic.NotFoundError) return new ProviderError("Anthropic model not found: check AI_MODEL", { retryable: false, status: 404, provider: "anthropic", cause: err });
  if (err instanceof Anthropic.BadRequestError) return new ProviderError(`Anthropic rejected the request: ${err.message}`, { retryable: false, status: 400, provider: "anthropic", cause: err });
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError("Anthropic request timed out", { retryable: true, provider: "anthropic", cause: err });
  if (err instanceof Anthropic.APIConnectionError) return new ProviderError("Could not connect to Anthropic", { retryable: true, provider: "anthropic", cause: err });
  if (err instanceof Anthropic.APIError) {
    const status = typeof err.status === "number" ? err.status : undefined;
    return new ProviderError(`Anthropic API error${status ? ` (${status})` : ""}: ${err.message}`, { retryable: status === undefined || status >= 500 || status === 408 || status === 409, status, provider: "anthropic", cause: err });
  }
  return new ProviderError(`Anthropic provider failure: ${(err as Error)?.message ?? String(err)}`, { retryable: false, provider: "anthropic", cause: err });
}
