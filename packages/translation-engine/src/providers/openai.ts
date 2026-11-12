import OpenAI from "openai";
import { ProviderConfigError, ProviderError, type CompletionRequest, type CompletionResponse, type LlmProvider } from "./types";

export interface OpenAIProviderOptions {
  apiKey: string | undefined;
  baseUrl?: string;
  maxRetries?: number;
}

/**
 * OpenAI (and OpenAI-compatible gateway) adapter using the Chat Completions API
 * with JSON-schema response format when a schema is provided.
 */
export class OpenAIProvider implements LlmProvider {
  readonly name = "openai";
  private client: OpenAI;

  constructor(opts: OpenAIProviderOptions) {
    if (!opts.apiKey) throw new ProviderConfigError("AI_API_KEY is required for the openai provider");
    this.client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseUrl, maxRetries: opts.maxRetries ?? 0 });
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
          max_completion_tokens: req.maxTokens,
          ...(req.jsonSchema
            ? { response_format: { type: "json_schema", json_schema: { name: "translation_batch", schema: req.jsonSchema, strict: false } } }
            : { response_format: { type: "json_object" } }),
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
  if (err instanceof OpenAI.RateLimitError) return new ProviderError("OpenAI rate limit exceeded", { retryable: true, status: 429, provider: "openai", cause: err });
  if (err instanceof OpenAI.AuthenticationError) return new ProviderError("OpenAI authentication failed: check AI_API_KEY", { retryable: false, status: 401, provider: "openai", cause: err });
  if (err instanceof OpenAI.NotFoundError) return new ProviderError("OpenAI model not found: check AI_MODEL", { retryable: false, status: 404, provider: "openai", cause: err });
  if (err instanceof OpenAI.BadRequestError) return new ProviderError(`OpenAI rejected the request: ${err.message}`, { retryable: false, status: 400, provider: "openai", cause: err });
  if (err instanceof OpenAI.APIConnectionTimeoutError) return new ProviderError("OpenAI request timed out", { retryable: true, provider: "openai", cause: err });
  if (err instanceof OpenAI.APIConnectionError) return new ProviderError("Could not connect to OpenAI", { retryable: true, provider: "openai", cause: err });
  if (err instanceof OpenAI.APIError) {
    const status = typeof err.status === "number" ? err.status : undefined;
    return new ProviderError(`OpenAI API error${status ? ` (${status})` : ""}: ${err.message}`, { retryable: status === undefined || status >= 500, status, provider: "openai", cause: err });
  }
  return new ProviderError(`OpenAI provider failure: ${(err as Error)?.message ?? String(err)}`, { retryable: false, provider: "openai", cause: err });
}
