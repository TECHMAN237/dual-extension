import type { EngineConfig } from "../config";
import { AnthropicProvider } from "./anthropic";
import { MockProvider } from "./mock";
import { OpenAIProvider } from "./openai";
import { OpenRouterProvider } from "./openrouter";
import type { LlmProvider } from "./types";

export * from "./types";
export { AnthropicProvider } from "./anthropic";
export { OpenAIProvider } from "./openai";
export { OpenRouterProvider, OPENROUTER_DEFAULT_BASE_URL, OPENROUTER_DEFAULT_HEADERS } from "./openrouter";
export { MockProvider } from "./mock";

/** Adapter factory: the only place that knows concrete provider classes. */
export function createProvider(config: EngineConfig): LlmProvider {
  switch (config.provider) {
    case "anthropic":
      return new AnthropicProvider({ apiKey: config.apiKey, baseUrl: config.baseUrl, maxRetries: 0, serverFallback: config.anthropicServerFallback });
    case "openai":
      return new OpenAIProvider({ apiKey: config.apiKey, baseUrl: config.baseUrl, maxRetries: 0 });
    case "openrouter":
      return new OpenRouterProvider({ apiKey: config.apiKey, baseUrl: config.baseUrl, maxRetries: 0 });
    case "mock":
      return new MockProvider();
  }
}
