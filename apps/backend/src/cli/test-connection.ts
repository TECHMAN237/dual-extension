/**
 * Verifies that the configured AI provider accepts requests.
 * Usage: pnpm ai:test-connection   (reads apps/backend/.env)
 */
import { InMemoryKnowledgeStore } from "@douala-ai/linguistic-knowledge";
import { TranslationEngine, createProvider } from "@douala-ai/translation-engine";
import { ConfigError, describeConfig, loadConfig } from "../config";

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      // exitCode instead of process.exit(): exiting while HTTP sockets are open
      // crashes Node on Windows (libuv UV_HANDLE_CLOSING assertion).
      process.exitCode = 1;
      return;
    }
    throw err;
  }
  console.log("Configuration:", JSON.stringify(describeConfig(config), null, 2));
  if (config.engine.provider === "mock") {
    console.log("AI_PROVIDER=mock: nothing to test. Set AI_PROVIDER=anthropic, openai or openrouter with AI_API_KEY.");
    return;
  }
  const provider = createProvider(config.engine);
  const engine = new TranslationEngine({ config: config.engine, provider, store: new InMemoryKnowledgeStore() });
  const started = Date.now();
  const res = await engine.translateBatch({ sourceLanguage: "en", targetLanguage: "dua", items: [{ id: "probe", text: "Welcome", context: "heading" }] });
  const r = res.results[0]!;
  console.log(`Provider responded in ${Date.now() - started} ms (model: ${config.engine.fastModel ?? config.engine.model}).`);
  console.log(`Result status: ${r.status}; evidence: ${r.evidence}; translation: ${r.translatedText ?? "(declined – no evidence, which is expected with an empty knowledge base)"}`);
  if (r.note) console.log(`Note: ${r.note}`);
  if (r.status === "error") {
    console.error("Connection test FAILED.");
    process.exitCode = 2;
    return;
  }
  console.log("Connection test OK.");
}

void main();
