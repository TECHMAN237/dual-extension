import { z } from "zod";
import { DEFAULT_MODELS, PROVIDER_NAMES, engineConfigSchema, type EngineConfig } from "@douala-ai/translation-engine";
import { resolveKnowledgeFile } from "./paths";

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "boolean" ? v : ["1", "true", "yes", "on"].includes(v.toLowerCase())));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  AI_PROVIDER: z.enum(PROVIDER_NAMES).default("mock"),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  AI_FAST_MODEL: z.string().optional(),
  AI_FALLBACK_MODEL: z.string().optional(),
  AI_BASE_URL: z.string().url().optional(),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(6).default(2),
  // Defaults depend on the provider (see PROVIDER_LIMIT_DEFAULTS).
  AI_BATCH_SIZE: z.coerce.number().int().min(1).max(60).optional(),
  AI_CONCURRENCY: z.coerce.number().int().min(1).max(16).optional(),
  AI_EFFORT: z.enum(["low", "medium", "high"]).default("low"),
  AI_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(21_600),
  AI_ANTHROPIC_SERVER_FALLBACK: bool.default(true),

  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  /** Production only: accept in-memory storage (data lost on every restart). For short tests. */
  ALLOW_EPHEMERAL_STORAGE: bool.default(false),

  CORS_ALLOWED_ORIGINS: z.string().default("chrome-extension://*"),
  EXTENSION_ACCESS_TOKEN: z.string().optional(),
  ADMIN_API_TOKEN: z.string().optional(),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  MAX_BODY_BYTES: z.coerce.number().int().positive().default(256 * 1024),

  /** Knowledge base file. Default data/knowledge/douala.json; relative paths start at the repository root. */
  LOCAL_KNOWLEDGE_FILE: z.string().optional(),
  SEED_UI_TERMS: bool.default(true),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Batch size / concurrency used when AI_BATCH_SIZE / AI_CONCURRENCY are not set.
 * OpenRouter free models are rate-limited per minute, so we send fewer, larger
 * requests one at a time.
 */
const DEFAULT_LIMITS = { batchSize: 20, concurrency: 3 };
const PROVIDER_LIMIT_DEFAULTS: Partial<Record<Env["AI_PROVIDER"], { batchSize: number; concurrency: number }>> = {
  openrouter: { batchSize: 30, concurrency: 1 },
};

export interface AppConfig {
  env: Env;
  engine: EngineConfig;
  storage: "memory" | "supabase";
  /** Absolute path of the versioned knowledge file (memory storage). */
  knowledgeFile: string;
  corsOrigins: string[];
  version: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Validate configuration on startup and produce clear, actionable errors.
 * Secrets are never echoed back.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  // `KEY=` lines in an env file arrive as "" (Node --env-file); treat them as unset
  // so the documented "copy .env.example and fill what you need" workflow works.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ""));
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new ConfigError(`Invalid environment configuration:\n${lines.join("\n")}\nSee .env.example and docs/AI_CONFIGURATION.md.`);
  }
  const env = parsed.data;
  const problems: string[] = [];

  if (env.AI_PROVIDER !== "mock" && !env.AI_API_KEY) {
    problems.push(`AI_API_KEY is required when AI_PROVIDER=${env.AI_PROVIDER}. Set it in apps/backend/.env (never in the extension). Use AI_PROVIDER=mock to run without a key.`);
  }
  const supabaseVars = [env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY].filter(Boolean).length;
  if (supabaseVars === 1) {
    problems.push("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set together (or both left empty for local in-memory mode).");
  }
  if (env.NODE_ENV === "production" && !env.ADMIN_API_TOKEN) {
    problems.push("ADMIN_API_TOKEN is required in production to protect administrative endpoints.");
  }
  if (env.NODE_ENV === "production" && env.AI_PROVIDER === "mock") {
    problems.push("AI_PROVIDER=mock is not allowed in production. Configure a real provider.");
  }
  if (env.NODE_ENV === "production" && supabaseVars === 0 && !env.ALLOW_EPHEMERAL_STORAGE) {
    problems.push(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production: hosts such as Render's free plan wipe the disk on restart, so validated words and corrections would be lost. See docs/DEPLOYMENT.md (set ALLOW_EPHEMERAL_STORAGE=true only for a throw-away test).",
    );
  }
  if (problems.length > 0) {
    throw new ConfigError(`Configuration problems:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  }

  const defaults = DEFAULT_MODELS[env.AI_PROVIDER];
  const limits = PROVIDER_LIMIT_DEFAULTS[env.AI_PROVIDER] ?? DEFAULT_LIMITS;
  const engine = engineConfigSchema.parse({
    provider: env.AI_PROVIDER,
    apiKey: env.AI_API_KEY,
    model: env.AI_MODEL ?? defaults.model,
    fastModel: env.AI_FAST_MODEL ?? defaults.fastModel,
    fallbackModel: env.AI_FALLBACK_MODEL ?? defaults.fallbackModel,
    baseUrl: env.AI_BASE_URL,
    timeoutMs: env.AI_TIMEOUT_MS,
    maxRetries: env.AI_MAX_RETRIES,
    batchSize: env.AI_BATCH_SIZE ?? limits.batchSize,
    concurrency: env.AI_CONCURRENCY ?? limits.concurrency,
    cacheTtlSeconds: env.AI_CACHE_TTL_SECONDS,
    effort: env.AI_EFFORT,
    anthropicServerFallback: env.AI_ANTHROPIC_SERVER_FALLBACK,
  });

  return {
    env,
    engine,
    storage: supabaseVars === 2 ? "supabase" : "memory",
    knowledgeFile: resolveKnowledgeFile(env.LOCAL_KNOWLEDGE_FILE),
    corsOrigins: env.CORS_ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
    version: "0.1.0",
  };
}

/** Safe summary for logs: no secrets. */
export function describeConfig(config: AppConfig): Record<string, unknown> {
  return {
    nodeEnv: config.env.NODE_ENV,
    port: config.env.PORT,
    provider: config.engine.provider,
    model: config.engine.model,
    fastModel: config.engine.fastModel,
    fallbackModel: config.engine.fallbackModel ?? null,
    baseUrl: config.engine.baseUrl ?? null,
    storage: config.storage,
    knowledgeFile: config.storage === "memory" ? config.knowledgeFile : null,
    corsOrigins: config.corsOrigins,
    apiKeyConfigured: Boolean(config.engine.apiKey),
    adminTokenConfigured: Boolean(config.env.ADMIN_API_TOKEN),
    extensionTokenRequired: Boolean(config.env.EXTENSION_ACCESS_TOKEN),
  };
}
