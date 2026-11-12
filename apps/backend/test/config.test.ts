import { describe, expect, it } from "vitest";
import { ConfigError, describeConfig, loadConfig } from "../src/config";
import { testEnv } from "./helpers";

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
