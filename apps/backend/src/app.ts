import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import type { AppConfig } from "./config";
import { createContainer, type Container, type ContainerOverrides } from "./container";
import { registerErrorHandler } from "./plugins/error-handler";
import { registerSecurityHeaders } from "./plugins/security";
import { registerAdminRoutes } from "./routes/admin";
import { registerPublicRoutes } from "./routes/public";

export interface BuiltApp {
  app: FastifyInstance;
  container: Container;
}

function originMatches(origin: string, patterns: string[]): boolean {
  for (const p of patterns) {
    if (p === "*") return true;
    if (p === origin) return true;
    if (p.endsWith("*") && origin.startsWith(p.slice(0, -1))) return true;
  }
  return false;
}

export async function buildApp(config: AppConfig, overrides: ContainerOverrides = {}, options: { logger?: boolean } = {}): Promise<BuiltApp> {
  const container = await createContainer(config, overrides);
  const app = Fastify({
    logger: options.logger === false ? false : { level: config.env.LOG_LEVEL, redact: ["req.headers.authorization", "req.headers['x-admin-token']", "req.headers['x-douala-client-token']"] },
    bodyLimit: config.env.MAX_BODY_BYTES,
    trustProxy: config.env.NODE_ENV === "production",
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      // Non-browser clients (curl, tests) send no Origin header.
      if (!origin) return cb(null, true);
      cb(null, originMatches(origin, config.corsOrigins));
    },
    methods: ["GET", "POST", "PUT", "OPTIONS"],
    allowedHeaders: ["content-type", "x-douala-client-id", "x-douala-client-token", "x-admin-token", "authorization"],
    maxAge: 600,
  });

  await app.register(rateLimit, {
    max: config.env.RATE_LIMIT_MAX,
    timeWindow: config.env.RATE_LIMIT_WINDOW_MS,
    keyGenerator: (req) => {
      const raw = req.headers["x-douala-client-id"];
      const id = Array.isArray(raw) ? raw[0] : raw;
      return id ? `${req.ip}:${id}` : req.ip;
    },
    allowList: (req) => req.url === "/api/health",
  });

  registerSecurityHeaders(app);
  registerErrorHandler(app);

  await registerPublicRoutes(app, container);
  await registerAdminRoutes(app, container);

  // Minimal admin page (static). The page itself calls the admin API with a token entered by the user.
  const here = path.dirname(fileURLToPath(import.meta.url));
  await app.register(fastifyStatic, { root: path.resolve(here, "admin"), prefix: "/admin/", decorateReply: false });
  app.get("/admin", async (_req, reply) => reply.redirect("/admin/"));
  app.get("/", async () => ({ name: "DOUALA AI backend", docs: "/admin/", health: "/api/health" }));

  return { app, container };
}
