import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { knowledgeIngestRequestSchema, linguisticSourceSchema, validationStatusSchema } from "@douala-ai/shared";
import { ingestUrl } from "@douala-ai/linguistic-knowledge";
import type { Container } from "../container";
import { HttpError, requireAdmin } from "../plugins/security";

/**
 * Administrative / linguistic management API. Protected by ADMIN_API_TOKEN.
 * Used by the minimal admin page served at /admin and by the CLI.
 */
export async function registerAdminRoutes(app: FastifyInstance, c: Container): Promise<void> {
  const admin = requireAdmin(c.config);

  app.get("/api/admin/overview", { preHandler: admin }, async () => {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const [entries, sources, pendingKnowledge, pendingCorrections, usage] = await Promise.all([
      c.store.countEntries(),
      c.store.listSources(),
      c.store.listEntries({ status: "pending", limit: 1 }),
      c.repos.corrections.list({ status: "pending", limit: 1 }),
      c.repos.usage.summary(since),
    ]);
    return {
      provider: c.provider.name,
      model: c.engine.isMock ? null : c.config.engine.model,
      storage: c.store.kind,
      knowledgeEntries: entries,
      sources: sources.length,
      hasPendingKnowledge: pendingKnowledge.length > 0,
      hasPendingCorrections: pendingCorrections.length > 0,
      cacheSize: c.engine.cacheSize,
      usageLast7Days: usage,
    };
  });

  app.get("/api/admin/sources", { preHandler: admin }, async () => ({ sources: await c.store.listSources() }));

  app.put("/api/admin/sources/:id", { preHandler: admin }, async (req) => {
    const { id } = z.object({ id: z.string().min(1).max(100) }).parse(req.params);
    const body = linguisticSourceSchema.parse({ ...(req.body as object), id });
    return { source: await c.store.upsertSource(body) };
  });

  app.get("/api/admin/knowledge", { preHandler: admin }, async (req) => {
    const q = z.object({ status: validationStatusSchema.optional(), sourceId: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(100), offset: z.coerce.number().int().min(0).default(0) }).parse(req.query);
    return { entries: await c.store.listEntries(q) };
  });

  app.post("/api/knowledge/ingest", { preHandler: admin }, async (req, reply) => {
    const body = knowledgeIngestRequestSchema.parse(req.body);
    const source = await c.store.getSource(body.sourceId);
    if (!source) throw new HttpError(404, "source_not_found", `Unknown source ${body.sourceId}. Register it first via PUT /api/admin/sources/:id.`);
    const entries = await c.store.upsertEntries(
      body.entries.map((e) => ({
        ...e,
        context: e.context ?? null,
        example: e.example ?? null,
        note: e.note ?? null,
        reference: e.reference ?? null,
        sourceId: source.id,
        sourceName: source.name,
        sourceUrl: source.url,
        origin: source.type === "manual_entry" ? "verified_source" : "extracted_unverified",
        reliability: source.reliability,
      })),
    );
    c.engine.clearCache();
    return reply.status(201).send({ ingested: entries.length, entries });
  });

  app.post("/api/admin/ingest/url", { preHandler: admin }, async (req) => {
    const body = z
      .object({
        sourceId: z.string().min(1),
        url: z.string().url(),
        sourceLanguage: z.enum(["en", "fr"]),
        format: z.enum(["html", "pdf", "csv", "json", "text"]).optional(),
        dryRun: z.boolean().default(false),
        html: z
          .object({
            strategy: z.enum(["auto", "table", "dl", "lines", "custom"]).optional(),
            entrySelector: z.string().optional(),
            headwordSelector: z.string().optional(),
            glossSelector: z.string().optional(),
            sourceColumn: z.number().int().min(0).optional(),
            targetColumn: z.number().int().min(0).optional(),
          })
          .optional(),
      })
      .parse(req.body);
    const source = await c.store.getSource(body.sourceId);
    if (!source) throw new HttpError(404, "source_not_found", `Unknown source ${body.sourceId}.`);
    const report = await ingestUrl(body.url, { store: c.store, source, sourceLanguage: body.sourceLanguage, format: body.format, html: body.html, dryRun: body.dryRun });
    if (!body.dryRun) c.engine.clearCache();
    return { ...report, entries: report.entries.slice(0, 50), truncated: report.entries.length > 50 };
  });

  app.post("/api/admin/knowledge/:id/review", { preHandler: admin }, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z.object({ status: validationStatusSchema, note: z.string().max(1000).optional() }).parse(req.body);
    const entry = await c.store.updateEntryStatus(id, body.status, body.note);
    if (!entry) throw new HttpError(404, "not_found", "Knowledge entry not found.");
    c.engine.clearCache();
    return { entry };
  });

  app.get("/api/admin/corrections", { preHandler: admin }, async (req) => {
    const q = z.object({ status: z.enum(["pending", "approved", "rejected"]).optional(), limit: z.coerce.number().int().min(1).max(500).default(100), offset: z.coerce.number().int().min(0).default(0) }).parse(req.query);
    return { corrections: await c.repos.corrections.list(q) };
  });

  /**
   * Review a community correction. Approving it creates a `user_correction`
   * knowledge entry with status `verified` so future translations reuse it.
   * Rejections are recorded and never enter the knowledge base.
   */
  app.post("/api/admin/corrections/:id/review", { preHandler: admin }, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z.object({ decision: z.enum(["approved", "rejected"]), note: z.string().max(1000).optional(), reviewer: z.string().max(100).default("admin") }).parse(req.body);
    const rec = await c.repos.corrections.review(id, body.decision, body.note ?? null, body.reviewer);
    if (!rec) throw new HttpError(404, "not_found", "Correction not found.");
    let knowledgeEntryId: string | null = null;
    if (body.decision === "approved") {
      const communitySource = (await c.store.getSource("community-corrections")) ?? (await c.store.upsertSource({
        id: "community-corrections",
        name: "Approved community corrections",
        url: null,
        type: "community",
        reliability: "community",
        languages: ["en", "fr", "dua"],
        accessibility: "public",
        license: "Contributed by users of DOUALA AI; reviewed by project linguists.",
        notes: "Entries created automatically when an administrator approves a user correction.",
        ingestionStatus: "ingested",
        lastIngestedAt: new Date().toISOString(),
      }));
      const [entry] = await c.store.upsertEntries([
        {
          sourceLanguage: rec.sourceLanguage,
          targetLanguage: rec.targetLanguage,
          sourceText: rec.sourceText,
          targetText: rec.proposedTranslation,
          category: rec.sourceText.split(/\s+/).length > 3 ? "translation_pair" : "vocabulary",
          context: rec.context,
          example: null,
          note: rec.explanation,
          sourceId: communitySource.id,
          sourceName: communitySource.name,
          sourceUrl: null,
          reference: `correction ${rec.id}`,
          origin: "user_correction",
          validationStatus: "verified",
          reliability: "community",
          tags: ["community"],
        },
      ]);
      knowledgeEntryId = entry?.id ?? null;
      c.engine.clearCache();
    }
    return { correction: rec, knowledgeEntryId };
  });

  app.get("/api/admin/usage", { preHandler: admin }, async (req) => {
    const q = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }).parse(req.query);
    const since = new Date(Date.now() - q.days * 24 * 3600 * 1000).toISOString();
    return { since, usage: await c.repos.usage.summary(since) };
  });
}
