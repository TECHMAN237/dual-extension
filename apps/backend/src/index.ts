import { buildApp } from "./app";
import { ConfigError, describeConfig, loadConfig } from "./config";

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`\n[DOUALA AI] ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
  const { app } = await buildApp(config);
  app.log.info(describeConfig(config), "configuration loaded");
  if (config.engine.provider === "mock") {
    app.log.warn("AI_PROVIDER=mock: translations are placeholders, NOT Douala. Configure AI_PROVIDER/AI_API_KEY for real translations.");
  }
  try {
    await app.listen({ port: config.env.PORT, host: config.env.HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

void main();
