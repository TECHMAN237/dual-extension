import path from "node:path";
import { InMemoryKnowledgeStore, SupabaseKnowledgeStore, loadSeedSources, loadSeedUiTerms, type KnowledgeStore } from "@douala-ai/linguistic-knowledge";
import { TranslationEngine, createProvider, type EngineLogger, type LlmProvider } from "@douala-ai/translation-engine";
import type { AppConfig } from "./config";
import { createMemoryRepositories } from "./repositories/memory";
import { createSupabaseRepositories } from "./repositories/supabase";
import type { Repositories } from "./repositories/types";

export interface Container {
  config: AppConfig;
  store: KnowledgeStore;
  provider: LlmProvider;
  engine: TranslationEngine;
  repos: Repositories;
  startedAt: number;
}

export interface ContainerOverrides {
  store?: KnowledgeStore;
  provider?: LlmProvider;
  repos?: Repositories;
  logger?: EngineLogger;
}

/**
 * Wire the application dependencies. Tests pass overrides (mock provider,
 * in-memory stores); production reads everything from `config`.
 */
export async function createContainer(config: AppConfig, overrides: ContainerOverrides = {}): Promise<Container> {
  let store = overrides.store;
  let repos = overrides.repos;

  if (!store || !repos) {
    if (config.storage === "supabase") {
      const url = config.env.SUPABASE_URL!;
      const key = config.env.SUPABASE_SERVICE_ROLE_KEY!;
      store ??= new SupabaseKnowledgeStore(url, key);
      repos ??= createSupabaseRepositories(url, key);
    } else {
      if (!store) {
        const memory = new InMemoryKnowledgeStore({
          persistPath: config.env.NODE_ENV === "test" ? undefined : path.resolve(process.cwd(), config.env.LOCAL_KNOWLEDGE_FILE),
          seedSources: loadSeedSources(),
        });
        await memory.load();
        if (config.env.SEED_UI_TERMS && (await memory.countEntries()) === 0) {
          await memory.upsertEntries(loadSeedUiTerms());
        }
        store = memory;
      }
      repos ??= createMemoryRepositories();
    }
  }

  const provider = overrides.provider ?? createProvider(config.engine);
  const usage = repos.usage;
  const engine = new TranslationEngine({
    config: config.engine,
    provider,
    store,
    logger: overrides.logger,
    onUsage: (event) => {
      void usage.record({ clientId: null, ...event }).catch(() => {});
    },
  });

  return { config, store, provider, engine, repos, startedAt: Date.now() };
}
