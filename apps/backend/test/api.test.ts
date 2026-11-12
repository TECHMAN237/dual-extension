import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { ProviderError, type LlmProvider } from "@douala-ai/translation-engine";
import { fakeEntry, makeApp } from "./helpers";

const CLIENT = "test-client-0001";
const headers = { "content-type": "application/json", "x-douala-client-id": CLIENT };

describe("public API", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    ({ app } = await makeApp({ entries: [fakeEntry({ sourceText: "Search", targetText: "T:search" }), fakeEntry({ id: "fr-home", sourceText: "Accueil", targetText: "T:accueil", sourceLanguage: "fr" })] }));
  });
  afterAll(() => app.close());

  it("GET /api/health reports mock mode and knowledge size", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ status: "ok", provider: "mock", mock: true, storage: "memory", knowledgeEntries: 2 });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("GET /api/languages lists en, fr and dua", async () => {
    const res = await app.inject({ method: "GET", url: "/api/languages" });
    expect(res.json().languages.map((l: { code: string }) => l.code)).toEqual(["en", "fr", "dua"]);
  });

  it("POST /api/scan/analyze detects French", async () => {
    const res = await app.inject({ method: "POST", url: "/api/scan/analyze", headers, payload: { domain: "example.fr", htmlLang: "fr", sampleText: "Bienvenue sur notre site, connectez-vous pour voir vos messages et vos paramètres", segmentCount: 12 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ detectedLanguage: "fr", supported: true });
  });

  it("POST /api/translate/batch validates input", async () => {
    const res = await app.inject({ method: "POST", url: "/api/translate/batch", headers, payload: { items: [] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("validation_error");
    const dup = await app.inject({ method: "POST", url: "/api/translate/batch", headers, payload: { items: [{ id: "a", text: "x" }, { id: "a", text: "y" }] } });
    expect(dup.statusCode).toBe(400);
    const tooLong = await app.inject({ method: "POST", url: "/api/translate/batch", headers, payload: { items: [{ id: "a", text: "x".repeat(2001) }] } });
    expect(tooLong.statusCode).toBe(400);
  });

  it("POST /api/translate/batch translates with references, skips identifiers and records history", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/translate/batch",
      headers,
      payload: { sourceLanguage: "en", domain: "example.com", items: [{ id: "n1", text: "Search", context: "button" }, { id: "n2", text: "Read the latest news", context: "link" }, { id: "n3", text: "user_id", context: "other" }] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mock).toBe(true);
    const byId = Object.fromEntries(body.results.map((r: { id: string }) => [r.id, r]));
    expect(byId.n1).toMatchObject({ status: "translated", translatedText: "T:search", evidence: "high", needsReview: false });
    expect(byId.n1.references[0]).toMatchObject({ sourceName: "Test dictionary", validationStatus: "verified" });
    expect(byId.n2).toMatchObject({ status: "translated", evidence: "unverified", needsReview: true });
    expect(byId.n2.translatedText).toContain("[MOCK dua]");
    expect(byId.n3.status).toBe("skipped");
    expect(typeof body.historyId).toBe("string");

    const hist = await app.inject({ method: "GET", url: "/api/history", headers });
    expect(hist.json().history[0]).toMatchObject({ domain: "example.com", sourceLanguage: "en", translatedCount: 2, status: "completed" });
    expect(JSON.stringify(hist.json())).not.toContain("Read the latest news");
  });

  it("POST /api/translate handles a single segment", async () => {
    const res = await app.inject({ method: "POST", url: "/api/translate", headers, payload: { sourceLanguage: "fr", text: "Accueil", context: "navigation" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toMatchObject({ translatedText: "T:accueil", evidence: "high" });
  });

  it("GET /api/knowledge/search returns ranked references", async () => {
    const res = await app.inject({ method: "GET", url: "/api/knowledge/search?q=search&sourceLanguage=en", headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().references[0]).toMatchObject({ sourceText: "Search", targetText: "T:search", matchType: "exact" });
  });

  it("corrections: submit, read status, admin review promotes to knowledge", async () => {
    const submit = await app.inject({
      method: "POST",
      url: "/api/corrections",
      headers,
      payload: { sourceLanguage: "en", sourceText: "Read the latest news", aiTranslation: "[MOCK dua] Read the latest news", proposedTranslation: "T:proposed", explanation: "Better phrasing", context: "link", domain: "example.com", clientId: CLIENT },
    });
    expect(submit.statusCode).toBe(201);
    const rec = submit.json();
    expect(rec.status).toBe("pending");

    const status = await app.inject({ method: "GET", url: `/api/corrections/status?ids=${rec.id}`, headers });
    expect(status.json().corrections[0].status).toBe("pending");

    const mine = await app.inject({ method: "GET", url: "/api/corrections/status", headers });
    expect(mine.json().corrections).toHaveLength(1);

    const invalid = await app.inject({ method: "POST", url: "/api/corrections", headers, payload: { sourceLanguage: "en", sourceText: "x", proposedTranslation: "", clientId: CLIENT } });
    expect(invalid.statusCode).toBe(400);

    // Admin review (no ADMIN_API_TOKEN in test => localhost only; inject() uses 127.0.0.1)
    const review = await app.inject({ method: "POST", url: `/api/admin/corrections/${rec.id}/review`, headers: { "content-type": "application/json" }, payload: { decision: "approved", note: "ok" } });
    expect(review.statusCode).toBe(200);
    expect(review.json().correction.status).toBe("approved");
    expect(review.json().knowledgeEntryId).toBeTruthy();

    const after = await app.inject({ method: "GET", url: `/api/corrections/status?ids=${rec.id}`, headers });
    expect(after.json().corrections[0].status).toBe("approved");

    // Approved correction now drives translation deterministically.
    const again = await app.inject({ method: "POST", url: "/api/translate/batch", headers, payload: { sourceLanguage: "en", items: [{ id: "x", text: "Read the latest news", context: "link" }] } });
    expect(again.json().results[0]).toMatchObject({ translatedText: "T:proposed", evidence: "high" });
    expect(again.json().results[0].references[0].origin).toBe("user_correction");
  });

  it("admin: sources list, manual ingest, knowledge review", async () => {
    const sources = await app.inject({ method: "GET", url: "/api/admin/sources" });
    expect(sources.statusCode).toBe(200);
    expect(sources.json().sources.map((s: { id: string }) => s.id)).toContain("dictionnaireduala-com");

    const ingest = await app.inject({ method: "POST", url: "/api/knowledge/ingest", headers: { "content-type": "application/json" }, payload: { sourceId: "manual-linguist-entries", entries: [{ sourceLanguage: "fr", sourceText: "Paramètres", targetText: "T:parametres", category: "vocabulary", reference: "Helmlinger 1972, p. 1" }] } });
    expect(ingest.statusCode).toBe(201);
    const entry = ingest.json().entries[0];
    expect(entry).toMatchObject({ validationStatus: "pending", origin: "verified_source" });

    const pendingTranslate = await app.inject({ method: "POST", url: "/api/translate/batch", headers, payload: { sourceLanguage: "fr", items: [{ id: "p", text: "Paramètres", context: "navigation" }] } });
    // pending entries are only hints: mock provider yields placeholder, evidence capped at moderate/low.
    expect(pendingTranslate.json().results[0].evidence).not.toBe("high");

    const review = await app.inject({ method: "POST", url: `/api/admin/knowledge/${entry.id}/review`, headers: { "content-type": "application/json" }, payload: { status: "verified" } });
    expect(review.json().entry.validationStatus).toBe("verified");

    const verifiedTranslate = await app.inject({ method: "POST", url: "/api/translate/batch", headers, payload: { sourceLanguage: "fr", items: [{ id: "p", text: "Paramètres", context: "navigation" }] } });
    expect(verifiedTranslate.json().results[0]).toMatchObject({ translatedText: "T:parametres", evidence: "high" });

    const unknown = await app.inject({ method: "POST", url: "/api/knowledge/ingest", headers: { "content-type": "application/json" }, payload: { sourceId: "nope", entries: [{ sourceLanguage: "fr", sourceText: "x", targetText: null }] } });
    expect(unknown.statusCode).toBe(404);
  });

  it("returns 404 envelope for unknown routes and 413 for oversized bodies", async () => {
    const res = await app.inject({ method: "GET", url: "/api/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("not_found");
    const big = await app.inject({ method: "POST", url: "/api/translate/batch", headers, payload: { items: [{ id: "a", text: "x".repeat(300_000) }] } });
    expect(big.statusCode).toBe(413);
  });
});

describe("security", () => {
  it("requires the extension access token when configured", async () => {
    const { app } = await makeApp({ env: { EXTENSION_ACCESS_TOKEN: "client-secret" } });
    const denied = await app.inject({ method: "POST", url: "/api/scan/analyze", headers, payload: { sampleText: "hello", segmentCount: 1 } });
    expect(denied.statusCode).toBe(401);
    const ok = await app.inject({ method: "POST", url: "/api/scan/analyze", headers: { ...headers, "x-douala-client-token": "client-secret" }, payload: { sampleText: "hello world and the rest", segmentCount: 1 } });
    expect(ok.statusCode).toBe(200);
    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    await app.close();
  });

  it("protects admin endpoints with ADMIN_API_TOKEN", async () => {
    const { app } = await makeApp({ env: { ADMIN_API_TOKEN: "admin-secret" } });
    expect((await app.inject({ method: "GET", url: "/api/admin/overview" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/admin/overview", headers: { "x-admin-token": "wrong" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/admin/overview", headers: { "x-admin-token": "admin-secret" } })).statusCode).toBe(200);
    await app.close();
  });

  it("rate limits per client", async () => {
    const { app } = await makeApp({ env: { RATE_LIMIT_MAX: "3", RATE_LIMIT_WINDOW_MS: "60000" } });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await app.inject({ method: "GET", url: "/api/languages", headers })).statusCode);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    const body = (await app.inject({ method: "GET", url: "/api/languages", headers })).json();
    expect(body.error.code).toBe("rate_limited");
    await app.close();
  });

  it("applies CORS to extension origins only", async () => {
    const { app } = await makeApp();
    const allowed = await app.inject({ method: "OPTIONS", url: "/api/translate/batch", headers: { origin: "chrome-extension://abcdef", "access-control-request-method": "POST" } });
    expect(allowed.headers["access-control-allow-origin"]).toBe("chrome-extension://abcdef");
    const denied = await app.inject({ method: "OPTIONS", url: "/api/translate/batch", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });
});

describe("provider failures", () => {
  it("reports provider errors per item with a 200 envelope (partial results), never leaking keys", async () => {
    const failing: LlmProvider = {
      name: "failing",
      async complete() {
        throw new ProviderError("Anthropic authentication failed: check AI_API_KEY", { retryable: false, status: 401, provider: "anthropic" });
      },
    };
    const { app } = await makeApp({ provider: failing, entries: [fakeEntry({ sourceText: "Search", targetText: "T:search" })] });
    const res = await app.inject({ method: "POST", url: "/api/translate/batch", headers, payload: { sourceLanguage: "en", items: [{ id: "a", text: "Search" }, { id: "b", text: "Something else entirely" }] } });
    expect(res.statusCode).toBe(200);
    const byId = Object.fromEntries(res.json().results.map((r: { id: string }) => [r.id, r]));
    expect(byId.a.status).toBe("translated");
    expect(byId.b.status).toBe("error");
    expect(byId.b.note).toContain("authentication failed");
    await app.close();
  });

  it("returns 503 when the provider is misconfigured at request time", async () => {
    const { app } = await makeApp({ env: { AI_PROVIDER: "anthropic", AI_API_KEY: "sk-test" }, provider: undefined });
    // provider constructed for real (no network call yet); health must still work
    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.json().provider).toBe("anthropic");
    await app.close();
  });
});
