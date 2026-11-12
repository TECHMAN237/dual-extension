import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { ProviderConfigError } from "@douala-ai/translation-engine";
import { HttpError } from "./security";

/** Uniform error envelope; never leaks stack traces or secrets. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((req, reply) => {
    void reply.status(404).send({ error: { code: "not_found", message: `Route ${req.method} ${req.url} not found` } });
  });
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      void reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }
    if (err instanceof ZodError) {
      void reply.status(400).send({ error: { code: "validation_error", message: "Invalid request", details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } });
      return;
    }
    if (err instanceof ProviderConfigError) {
      void reply.status(503).send({ error: { code: "provider_not_configured", message: err.message } });
      return;
    }
    const fastifyErr = err as { statusCode?: number; code?: string; message?: string; validation?: unknown };
    if (fastifyErr.statusCode === 429) {
      void reply.status(429).send({ error: { code: "rate_limited", message: "Too many requests. Please slow down." } });
      return;
    }
    if (fastifyErr.statusCode === 413 || fastifyErr.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      void reply.status(413).send({ error: { code: "payload_too_large", message: "Request body too large." } });
      return;
    }
    if (fastifyErr.statusCode === 415 || fastifyErr.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
      void reply.status(415).send({ error: { code: "unsupported_media_type", message: "Content-Type must be application/json." } });
      return;
    }
    if (fastifyErr.statusCode === 400 && fastifyErr.code === "FST_ERR_CTP_EMPTY_JSON_BODY") {
      void reply.status(400).send({ error: { code: "validation_error", message: "Request body must be a JSON object." } });
      return;
    }
    if (fastifyErr.statusCode && fastifyErr.statusCode < 500) {
      void reply.status(fastifyErr.statusCode).send({ error: { code: fastifyErr.code ?? "bad_request", message: fastifyErr.message ?? "Bad request" } });
      return;
    }
    req.log.error({ err }, "unhandled error");
    void reply.status(500).send({ error: { code: "internal_error", message: "Internal server error" } });
  });
}
