import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ConfigError, describeConfig, loadConfig } from "../src/config";
import { testEnv } from "./helpers";

/** Minimal KEY=VALUE parser matching Node's --env-file for our example files (empty values stay ""). */
function readEnvFile(relativePath: string): Record<string, string> {
  const text = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

describe("loadConfig with the openrouter provider", () => {
  it("accepts openrouter with the free default models and rate-limit friendly defaults", () => {
    const c = loadConfig(testEnv({ AI_PROVIDER: "openrouter", AI_API_KEY: "sk-or-test" }));
    expect(c.engine.provider).toBe("openrouter");
    expect(c.engine.model).toBe("google/gemma-4-31b-it:free");
    expect(c.engine.fastModel).toBe("google/gemma-4-31b-it:free");
    expect(c.engine.fallbackModel).toBe("google/gemma-4-26b-a4b-it:free");
    expect(c.engine.concurrency).toBe(1);
    expect(c.engine.batchSize).toBe(30);
  });
  it("keeps explicit AI_CONCURRENCY / AI_BATCH_SIZE and the usual defaults for other providers", () => {
    const c = loadConfig(testEnv({ AI_PROVIDER: "openrouter", AI_API_KEY: "sk-or-test", AI_CONCURRENCY: "2", AI_BATCH_SIZE: "10" }));
    expect(c.engine.concurrency).toBe(2);
    expect(c.engine.batchSize).toBe(10);
    const m = loadConfig(testEnv());
    expect(m.engine.concurrency).toBe(3);
    expect(m.engine.batchSize).toBe(20);
  });
  it("refuses openrouter without an API key", () => {
    expect(() => loadConfig(testEnv({ AI_PROVIDER: "openrouter" }))).toThrow(ConfigError);
    expect(() => loadConfig(testEnv({ AI_PROVIDER: "openrouter" }))).toThrow(/AI_API_KEY is required when AI_PROVIDER=openrouter/);
  });
});

describe("shipped .env.example files", () => {
  it.each(["../../../.env.example", "../.env.example"])("%s loads without errors", (path) => {
    const c = loadConfig({ ...readEnvFile(path), NODE_ENV: "test" });
    expect(c.engine.provider).toBe("mock");
  });
  it("an OpenRouter .env (example + placeholder key) loads with the free models", () => {
    const env = {
      ...readEnvFile("../.env.example"),
      NODE_ENV: "test",
      AI_PROVIDER: "openrouter",
      AI_API_KEY: "placeholder",
      AI_BASE_URL: "https://openrouter.ai/api/v1",
    };
    const c = loadConfig(env);
    expect(c.engine.model).toBe("google/gemma-4-31b-it:free");
    expect(c.engine.concurrency).toBe(1);
    expect(c.engine.batchSize).toBe(30);
  });
});

describe("loadConfig", () => {
  it("defaults to the mock provider with in-memory storage", () => {
    const c = loadConfig(testEnv());
    expect(c.engine.provider).toBe("mock");
    expect(c.storage).toBe("memory");
    expect(c.engine.model).toBe("mock-model");
  });
  it("fails clearly when a real provider has no API key", () => {
    expect(() => loadConfig(testEnv({ AI_PROVIDER: "anthropic" }))).toThrow(ConfigError);
    expect(() => loadConfig(testEnv({ AI_PROVIDER: "anthropic" }))).toThrow(/AI_API_KEY is required/);
  });
  it("uses verified default models for anthropic and allows overrides", () => {
    const c = loadConfig(testEnv({ AI_PROVIDER: "anthropic", AI_API_KEY: "sk-test" }));
    expect(c.engine.model).toBe("claude-opus-5-5");
    expect(c.engine.fastModel).toBe("claude-sonnet-5-5");
    const o = loadConfig(testEnv({ AI_PROVIDER: "anthropic", AI_API_KEY: "sk-test", AI_MODEL: "custom-model", AI_FAST_MODEL: "custom-fast" }));
    expect(o.engine.model).toBe("custom-model");
    expect(o.engine.fastModel).toBe("custom-fast");
  });
  it("requires Supabase variables together and selects supabase storage", () => {
    expect(() => loadConfig(testEnv({ SUPABASE_URL: "https://x.supabase.co" }))).toThrow(/must be set together/);
    const c = loadConfig(testEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service" }));
    expect(c.storage).toBe("supabase");
  });
  it("rejects mock provider and missing admin token in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production", AI_PROVIDER: "mock" })).toThrow(/production/);
  });
  it("never includes secrets in the config description", () => {
    const c = loadConfig(testEnv({ AI_PROVIDER: "openai", AI_API_KEY: "sk-secret-value", ADMIN_API_TOKEN: "admin-secret" }));
    const described = JSON.stringify(describeConfig(c));
    expect(described).not.toContain("sk-secret-value");
    expect(described).not.toContain("admin-secret");
    expect(described).toContain('"apiKeyConfigured":true');
  });
});
