import { InMemoryKnowledgeStore, loadSeedSources } from "@douala-ai/linguistic-knowledge";
import type { KnowledgeEntry } from "@douala-ai/shared";
import { MockProvider, type LlmProvider } from "@douala-ai/translation-engine";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";

export function testEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", AI_PROVIDER: "mock", LOG_LEVEL: "silent", RATE_LIMIT_MAX: "1000", ...extra };
}

export function fakeEntry(partial: Partial<KnowledgeEntry> & { sourceText: string; targetText: string | null }): KnowledgeEntry {
  return {
    id: partial.id ?? `id-${partial.sourceText}`,
    sourceLanguage: "en",
    targetLanguage: "dua",
    category: "vocabulary",
    context: null,
    example: null,
    note: null,
    sourceId: "test",
    sourceName: "Test dictionary",
    sourceUrl: "https://example.org/dict",
    reference: "entry 1",
    origin: "verified_source",
    validationStatus: "verified",
    reliability: "academic",
    extractedAt: "2026-01-01T00:00:00.000Z",
    tags: [],
    ...partial,
  };
}

export async function makeApp(options: { env?: Record<string, string>; entries?: KnowledgeEntry[]; provider?: LlmProvider } = {}) {
  const config = loadConfig(testEnv(options.env));
  const store = new InMemoryKnowledgeStore({ seedSources: loadSeedSources(), seedEntries: options.entries ?? [] });
  const provider = "provider" in options ? options.provider : new MockProvider();
  const built = await buildApp(config, { store, provider }, { logger: false });
  return built;
}
