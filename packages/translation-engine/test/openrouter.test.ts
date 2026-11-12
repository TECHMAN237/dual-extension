import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MODELS, OpenRouterProvider, ProviderConfigError, ProviderError, createProvider, engineConfigSchema } from "../src";

const baseConfig = { provider: "openrouter" as const, apiKey: "sk-or-test", ...DEFAULT_MODELS.openrouter };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const okBody = {
  id: "gen-1",
  object: "chat.completion",
  created: 0,
  model: "google/gemma-4-31b-it:free",
  choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: '{"translations":[]}' } }],
  usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
};

const request = { model: "google/gemma-4-31b-it:free", system: "sys", user: "usr", jsonSchema: { type: "object" }, maxTokens: 500, timeoutMs: 5000 };

afterEach(() => vi.unstubAllGlobals());

describe("OpenRouter provider", () => {
  it("has free default models", () => {
    expect(DEFAULT_MODELS.openrouter).toEqual({
      model: "google/gemma-4-31b-it:free",
      fastModel: "google/gemma-4-31b-it:free",
      fallbackModel: "google/gemma-4-26b-a4b-it:free",
    });
  });

  it("createProvider returns the OpenRouter provider", () => {
    const provider = createProvider(engineConfigSchema.parse(baseConfig));
    expect(provider).toBeInstanceOf(OpenRouterProvider);
    expect(provider.name).toBe("openrouter");
  });

  it("refuses to start without an API key", () => {
    expect(() => createProvider(engineConfigSchema.parse({ ...baseConfig, apiKey: undefined }))).toThrow(ProviderConfigError);
  });

  it("calls the OpenRouter endpoint with attribution headers, max_tokens and json_object", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, okBody));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenRouterProvider({ apiKey: "sk-or-test" });
    const res = await provider.complete(request);

    expect(res).toMatchObject({ text: '{"translations":[]}', model: "google/gemma-4-31b-it:free", stopReason: "stop", usage: { inputTokens: 12, outputTokens: 5 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string | URL, RequestInit];
    expect(String(url)).toBe("https://openrouter.ai/api/v1/chat/completions");
    const headers = new Headers(init.headers);
    expect(headers.get("http-referer")).toBe("https://github.com/TECHMAN237/dual-extension");
    expect(headers.get("x-title")).toBe("DOUALA AI");
    expect(headers.get("authorization")).toBe("Bearer sk-or-test");
    const body = JSON.parse(String(init.body));
    expect(body.max_tokens).toBe(500);
    expect(body.max_completion_tokens).toBeUndefined();
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("honours a custom base URL (AI_BASE_URL)", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, okBody));
    vi.stubGlobal("fetch", fetchMock);
    await new OpenRouterProvider({ apiKey: "k", baseUrl: "https://proxy.example/v1" }).complete(request);
    const [url] = fetchMock.mock.calls[0] as unknown as [string | URL];
    expect(String(url)).toBe("https://proxy.example/v1/chat/completions");
  });

  it.each([
    [429, true],
    [500, true],
    [503, true],
    [401, false],
    [404, false],
  ])("maps HTTP %i to a ProviderError (retryable=%s)", async (status, retryable) => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(status, { error: { message: "boom", code: status } })));
    const provider = new OpenRouterProvider({ apiKey: "k" });
    const err = await provider.complete(request).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).message).toContain("OpenRouter");
    expect((err as ProviderError).options).toMatchObject({ retryable, status, provider: "openrouter" });
  });
});
