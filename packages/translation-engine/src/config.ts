import { z } from "zod";

export const PROVIDER_NAMES = ["anthropic", "openai", "mock"] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

/**
 * Engine configuration. Built from environment variables by the backend
 * (see apps/backend/src/config.ts) so that provider and model can be changed
 * without touching business logic.
 */
export const engineConfigSchema = z.object({
  provider: z.enum(PROVIDER_NAMES),
  apiKey: z.string().optional(),
  /** Primary (most capable) model id used for ambiguous or long segments. */
  model: z.string().min(1),
  /** Fast/cheap model used for ordinary short interface strings. Defaults to `model`. */
  fastModel: z.string().min(1).optional(),
  /** Model tried when the primary call fails (provider error, malformed output). */
  fallbackModel: z.string().min(1).optional(),
  /** Custom API base URL (OpenAI-compatible gateways, proxies). */
  baseUrl: z.string().url().optional(),
  timeoutMs: z.number().int().positive().default(45_000),
  maxRetries: z.number().int().min(0).max(6).default(2),
  /** Maximum segments per LLM request. */
  batchSize: z.number().int().min(1).max(60).default(20),
  /** Maximum concurrent LLM requests. */
  concurrency: z.number().int().min(1).max(16).default(3),
  cacheTtlSeconds: z.number().int().min(0).default(6 * 60 * 60),
  cacheMaxEntries: z.number().int().min(0).default(5000),
  /** Maximum references attached to each segment prompt. */
  maxReferencesPerItem: z.number().int().min(0).max(20).default(6),
  /** Effort hint for providers that support it (Anthropic `output_config.effort`). */
  effort: z.enum(["low", "medium", "high"]).default("low"),
  /** Enable the Anthropic server-side refusal fallback (beta). */
  anthropicServerFallback: z.boolean().default(true),
});
export type EngineConfig = z.infer<typeof engineConfigSchema>;

export const DEFAULT_MODELS: Record<ProviderName, { model: string; fastModel: string; fallbackModel?: string }> = {
  // Verified against the Claude API reference (Nov 2026): claude-opus-5-5 (capable), claude-sonnet-5-5 (fast).
  anthropic: { model: "claude-opus-5-5", fastModel: "claude-sonnet-5-5", fallbackModel: "claude-sonnet-5-5" },
  // Users must verify current OpenAI model ids in https://platform.openai.com/docs/models before use.
  openai: { model: "gpt-5", fastModel: "gpt-5-mini" },
  mock: { model: "mock-model", fastModel: "mock-model" },
};
