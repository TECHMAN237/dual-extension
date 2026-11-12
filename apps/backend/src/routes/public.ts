import type { FastifyInstance } from "fastify";
import {
  LANGUAGES,
  LIMITS,
  correctionStatusQuerySchema,
  correctionSubmissionSchema,
  detectSourceLanguage,
  knowledgeSearchQuerySchema,
  scanAnalyzeRequestSchema,
  translateBatchRequestSchema,
  translateSingleRequestSchema,
  type HealthResponse,
  type ScanAnalyzeResponse,
} from "@douala-ai/shared";
import { retrieveReferences, toTranslationReference } from "@douala-ai/linguistic-knowledge";
import { z } from "zod";
import type { Container } from "../container";
import { HttpError, getClientId, requireClientToken } from "../plugins/security";

/**
 * Public API used by the browser extension. All handlers validate input with
 * Zod and never expose provider secrets or stack traces.
 */
export async function registerPublicRoutes(app: FastifyInstance, c: Container): Promise<void> {
  const clientAuth = requireClientToken(c.config);

  app.get("/api/health", async (): Promise<HealthResponse> => ({
    status: "ok",
    version: c.config.version,
    provider: c.provider.name,
    model: c.engine.isMock ? null : c.config.engine.model,
    mock: c.engine.isMock,
    storage: c.store.kind,
    knowledgeEntries: await c.store.countEntries(),
    uptimeSeconds: Math.round((Date.now() - c.startedAt) / 1000),
  }));

  app.get("/api/languages", async () => ({ languages: LANGUAGES, limits: LIMITS }));

  app.post("/api/scan/analyze", { preHandler: clientAuth }, async (req): Promise<ScanAnalyzeResponse> => {
    const body = scanAnalyzeRequestSchema.parse(req.body);
    const detection = detectSourceLanguage(body.sampleText, body.htmlLang);
    const supported = detection.language !== null;
    return {
      detectedLanguage: detection.language,
      confidence: detection.confidence,
      supported,
      message: supported ? null : "Could not confidently detect English or French. Choose the source language manually.",
    };
  });

  app.post("/api/translate", { preHandler: clientAuth }, async (req) => {
    const body = translateSingleRequestSchema.parse(req.body);
    const res = await c.engine.translateBatch({ sourceLanguage: body.sourceLanguage, targetLanguage: body.targetLanguage, domain: body.domain, items: [{ id: "single", text: body.text, context: body.context }] });
    return { ...res, result: res.results[0], results: undefined };
  });

  app.post("/api/translate/batch", { preHandler: clientAuth }, async (req) => {
    const body = translateBatchRequestSchema.parse(req.body);
    const clientId = getClientId(req);
    const res = await c.engine.translateBatch(body);
    let historyId: string | null = null;
    if (clientId && body.domain) {
      const translated = res.results.filter((r) => r.status === "translated").length;
      const uncertain = res.results.filter((r) => r.status === "uncertain").length;
      const errors = res.results.filter((r) => r.status === "error").length;
      try {
        const rec = await c.repos.history.record({
          clientId,
          domain: body.domain,
          sourceLanguage: res.sourceLanguage,
          targetLanguage: res.targetLanguage,
          translatedCount: translated,
          uncertainCount: uncertain,
          status: errors === 0 ? "completed" : translated > 0 ? "partial" : "failed",
        });
        historyId = rec.id;
      } catch (err) {
        req.log.warn({ err }, "could not record history");
      }
    }
    return { ...res, historyId };
  });

  app.post("/api/corrections", { preHandler: clientAuth }, async (req, reply) => {
    const body = correctionSubmissionSchema.parse(req.body);
    const headerClient = getClientId(req);
    if (headerClient && headerClient !== body.clientId) throw new HttpError(400, "client_mismatch", "clientId does not match X-Douala-Client-Id header.");
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const recent = await c.repos.corrections.countRecent(body.clientId, since);
    if (recent >= 200) throw new HttpError(429, "correction_quota", "Daily correction limit reached for this client.");
    const rec = await c.repos.corrections.create(body);
    return reply.status(201).send(rec);
  });

  app.get("/api/corrections/status", { preHandler: clientAuth }, async (req) => {
    const q = correctionStatusQuerySchema.parse(req.query);
    const ids = (q.ids ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 100);
    const clientId = q.clientId ?? getClientId(req);
    if (ids.length === 0 && !clientId) throw new HttpError(400, "validation_error", "Provide ids or a client id.");
    const corrections = ids.length > 0 ? await c.repos.corrections.getByIds(ids) : await c.repos.corrections.listByClient(clientId!, 100);
    return { corrections };
  });

  app.get("/api/history", { preHandler: clientAuth }, async (req) => {
    const clientId = getClientId(req) ?? z.object({ clientId: z.string().min(8).max(64) }).parse(req.query).clientId;
    const history = await c.repos.history.listByClient(clientId, 50);
    return { history };
  });

  app.get("/api/knowledge/search", { preHandler: clientAuth }, async (req) => {
    const q = knowledgeSearchQuerySchema.parse(req.query);
    const sourceLanguage = q.sourceLanguage ?? detectSourceLanguage(q.q).language ?? "en";
    const refs = await retrieveReferences(c.store, q.q, { sourceLanguage, targetLanguage: q.targetLanguage, limit: q.limit, includeUnverified: q.includeUnverified });
    return { query: q.q, sourceLanguage, references: refs.map((r) => ({ ...toTranslationReference(r), relevance: Number(r.relevance.toFixed(3)), matchType: r.matchType })) };
  });
}
