import OpenAI from "openai";
import { ProviderConfigError, ProviderError, type CompletionRequest, type CompletionResponse, type LlmProvider } from "./types";

export const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_DEFAULT_HEADERS = {
  "HTTP-Referer": "https://github.com/TECHMAN237/dual-extension",
  "X-Title": "DOUALA AI",
} as const;

export interface OpenRouterProviderOptions {
  apiKey: string | undefined;
  /** Defaults to https://openrouter.ai/api/v1 (override with AI_BASE_URL). */
  baseUrl?: string;
  maxRetries?: number;
}

/**
 * OpenRouter adapter (OpenAI-compatible Chat Completions API).
 *
 * Free models do not reliably enforce JSON schemas, so only `json_object`
 * mode is requested. The engine validates the output with Zod and recovers
 * JSON wrapped in surrounding text (see output.ts).
 */
export class OpenRouterProvider implements LlmProvider {
  readonly name = "openrouter";
  private client: OpenAI;

  constructor(opts: OpenRouterProviderOptions) {
    if (!opts.apiKey) throw new ProviderConfigError("AI_API_KEY is required for the openrouter provider");
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseUrl ?? OPENROUTER_DEFAULT_BASE_URL,
      maxRetries: opts.maxRetries ?? 0,
      defaultHeaders: { ...OPENROUTER_DEFAULT_HEADERS },
    });
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    try {
      const completion = await this.client.chat.completions.create(
        {
          model: req.model,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          max_tokens: req.maxTokens,
          response_format: { type: "json_object" },
        },
        { timeout: req.timeoutMs },
      );
      const choice = completion.choices[0];
      const text = choice?.message?.content ?? "";
      const refused = Boolean(choice?.message?.refusal);
      return {
        text,
        model: completion.model,
        stopReason: choice?.finish_reason ?? null,
        usage: completion.usage ? { inputTokens: completion.usage.prompt_tokens, outputTokens: completion.usage.completion_tokens } : undefined,
        refused,
      };
    } catch (err) {
      throw toProviderError(err);
    }
  }
}

function toProviderError(err: unknown): ProviderError {
  if (err instanceof OpenAI.RateLimitError) return new ProviderError("OpenRouter rate limit exceeded (free models are rate-limited)", { retryable: true, status: 429, provider: "openrouter", cause: err });
  if (err instanceof OpenAI.AuthenticationError) return new ProviderError("OpenRouter authentication failed: check AI_API_KEY", { retryable: false, status: 401, provider: "openrouter", cause: err });
  if (err instanceof OpenAI.NotFoundError) return new ProviderError("OpenRouter model not found: check AI_MODEL", { retryable: false, status: 404, provider: "openrouter", cause: err });
  if (err instanceof OpenAI.BadRequestError) return new ProviderError(`OpenRouter rejected the request: ${err.message}`, { retryable: false, status: 400, provider: "openrouter", cause: err });
  if (err instanceof OpenAI.APIConnectionTimeoutError) return new ProviderError("OpenRouter request timed out", { retryable: true, provider: "openrouter", cause: err });
  if (err instanceof OpenAI.APIConnectionError) return new ProviderError("Could not connect to OpenRouter", { retryable: true, provider: "openrouter", cause: err });
  if (err instanceof OpenAI.APIError) {
    const status = typeof err.status === "number" ? err.status : undefined;
    return new ProviderError(`OpenRouter API error${status ? ` (${status})` : ""}: ${err.message}`, { retryable: status === undefined || status >= 500, status, provider: "openrouter", cause: err });
  }
  return new ProviderError(`OpenRouter provider failure: ${(err as Error)?.message ?? String(err)}`, { retryable: false, provider: "openrouter", cause: err });
}
