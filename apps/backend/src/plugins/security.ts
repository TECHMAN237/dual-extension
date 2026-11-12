import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../config";

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function getClientId(req: FastifyRequest): string | null {
  const raw = req.headers["x-douala-client-id"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  return /^[A-Za-z0-9_-]{8,64}$/.test(value) ? value : null;
}

/** Optional shared client token for the extension (not an AI secret). */
export function requireClientToken(config: AppConfig) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const expected = config.env.EXTENSION_ACCESS_TOKEN;
    if (!expected) return;
    const raw = req.headers["x-douala-client-token"];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value || !safeEqual(value, expected)) {
      throw new HttpError(401, "unauthorized", "A valid X-Douala-Client-Token header is required.");
    }
  };
}

/** Admin endpoints require ADMIN_API_TOKEN; when unset outside production, admin is open on localhost only. */
export function requireAdmin(config: AppConfig) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const expected = config.env.ADMIN_API_TOKEN;
    const raw = req.headers["x-admin-token"] ?? req.headers.authorization?.replace(/^Bearer\s+/i, "");
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (expected) {
      if (!value || !safeEqual(value, expected)) throw new HttpError(401, "unauthorized", "Admin token required.");
      return;
    }
    const ip = req.ip;
    const local = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
    if (!local) throw new HttpError(403, "forbidden", "Admin endpoints are only available from localhost until ADMIN_API_TOKEN is configured.");
  };
}

export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook("onSend", async (_req, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header("cache-control", "no-store");
    if (!reply.getHeader("content-security-policy")) {
      reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
    }
  });
}
